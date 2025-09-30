import type { NetworkSnapshot, RpcProvider } from "../../types/types.js";
import { normalizeEndpoint } from "./url.js";
import { config } from "../../config/config.js";
import { RpcError } from "../../errors/appErrors.js";
import { retryWithBackoff } from "../../utils/retry.js";

type CircuitState = { failures: number; openedAt?: number };

export class RpcAggregator {
	private readonly first: RpcProvider;
	private lastBest?: {
		provider: RpcProvider;
		endpoint: string;
		latency: number;
		switchedAt: number;
	};

	private readonly minDwellMs = config.minDwellMs;
	private readonly minGainMs = config.minGainMs;
	private readonly minGainPct = config.minGainPct;
	// параметры backoff берём из конфига, чтобы управлять ими через env
	private readonly probeBackoff = config.rpcProbeBackoff;
	private readonly feeBackoff = config.rpcFeeBackoff;
	private readonly circuitThreshold = config.rpcCircuit.failureThreshold;
	private readonly circuitCooldownMs = config.rpcCircuit.cooldownMs;
	private readonly circuitState = new Map<RpcProvider, CircuitState>();
	private readonly endpointLabels = new Map<RpcProvider, string>();

	constructor(private readonly clients: RpcProvider[]) {
		if (!clients.length) throw new RpcError("No RPC clients configured");
		this.first = clients[0]!;
		clients.forEach((provider, index) => {
			const endpoint = config.endpoints[index];
			if (endpoint) this.endpointLabels.set(provider, endpoint);
		});
	}

	private isBetter(newLat: number, oldLat: number): boolean {
		const gainMs = oldLat - newLat;
		const gainPct = gainMs / Math.max(oldLat, 1);
		return gainMs >= this.minGainMs || gainPct >= this.minGainPct;
	}

	async bestSnapshot(): Promise<{ snapshot: NetworkSnapshot; provider: RpcProvider }> {
		let best: { snapshot: NetworkSnapshot; provider: RpcProvider } | null = null;
		const circuitNotes: string[] = [];

		for (const provider of this.clients) {
			const remainingMs = this.getCircuitRemainingMs(provider);
			if (remainingMs !== null) {
				circuitNotes.push(this.formatCircuitNote(provider, remainingMs));
				continue;
			}

			try {
				// health probe может редко флапать, поэтому даём несколько попыток с backoff
				const snap = await retryWithBackoff(() => provider.healthProbe(), {
					retries: this.probeBackoff.retries,
					initialDelayMs: this.probeBackoff.initialDelayMs,
					maxDelayMs: this.probeBackoff.maxDelayMs,
				});
				snap.endpoint = normalizeEndpoint(snap.endpoint);
				this.rememberEndpoint(provider, snap.endpoint);
				this.recordSuccess(provider);
				if (!best || snap.latencyMs < best.snapshot.latencyMs) {
					best = { snapshot: snap, provider };
				}
			} catch {
				this.recordFailure(provider, circuitNotes);
			}
		}

		if (!best) {
			const fallbackSnap: NetworkSnapshot = {
				endpoint: "(unknown)",
				latencyMs: 600,
				at: Date.now(),
				stale: true,
				notes: ["all probes failed", ...circuitNotes],
			};
			return { snapshot: fallbackSnap, provider: this.first };
		}

		let chosen = best;

		// sticky-логика: если у нас уже был лучший и время удержания не вышло,
		// переключаемся только при существенном выигрыше
		if (this.lastBest) {
			const dwellOk = Date.now() - this.lastBest.switchedAt >= this.minDwellMs;
			const better = this.isBetter(best.snapshot.latencyMs, this.lastBest.latency);
			if (!dwellOk && !better) {
				// держим прежний RPC
				const stickySnapshot: NetworkSnapshot = {
					endpoint: this.lastBest.endpoint,
					latencyMs: this.lastBest.latency,
					at: best.snapshot.at,
					notes: [...(best.snapshot.notes ?? []), "sticky: dwell"],
				};
				chosen = { snapshot: stickySnapshot, provider: this.lastBest.provider };
			} else if (
				this.lastBest.provider !== best.provider ||
				this.lastBest.endpoint !== best.snapshot.endpoint
			) {
				this.lastBest = {
					provider: best.provider,
					endpoint: best.snapshot.endpoint,
					latency: best.snapshot.latencyMs,
					switchedAt: Date.now(),
				};
				best.snapshot.notes = [
					...(best.snapshot.notes ?? []),
					`rpc switched -> ${best.snapshot.endpoint}`,
				];
				chosen = best;
			} else {
				// если тот же, обновим latency
				this.lastBest.latency = best.snapshot.latencyMs;
				chosen = best;
			}
		} else {
			this.lastBest = {
				provider: best.provider,
				endpoint: best.snapshot.endpoint,
				latency: best.snapshot.latencyMs,
				switchedAt: Date.now(),
			};
		}

		if (circuitNotes.length) {
			chosen.snapshot.notes = [...(chosen.snapshot.notes ?? []), ...circuitNotes];
		}

		return chosen;
	}

	async recentPrioritizationFeesPrefer(preferred?: RpcProvider): Promise<number[] | null> {
		const order = preferred
			? [preferred, ...this.clients.filter((c) => c !== preferred)]
			: [...this.clients];

		for (const provider of order) {
			const remainingMs = this.getCircuitRemainingMs(provider);
			if (remainingMs !== null) continue;

			try {
				// повторно запрашиваем комиссии, так как RPC иногда отдаёт пустые массивы
				const fees = await retryWithBackoff(
					async () => {
						const result = await provider.recentPrioritizationFees();
						if (!result || result.length === 0) {
							// пустой ответ считаем сбоем и просим retry попробовать ещё раз/другой RPC
							throw new Error("Empty prioritization fees");
						}
						return result;
					},
					{
						retries: this.feeBackoff.retries,
						initialDelayMs: this.feeBackoff.initialDelayMs,
						maxDelayMs: this.feeBackoff.maxDelayMs,
					},
				);
				this.recordSuccess(provider);
				return fees;
			} catch {
				this.recordFailure(provider);
			}
		}
		return null;
	}

	private rememberEndpoint(provider: RpcProvider, endpoint: string): void {
		this.endpointLabels.set(provider, endpoint);
	}

	private recordSuccess(provider: RpcProvider): void {
		this.circuitState.set(provider, { failures: 0 });
	}

	private recordFailure(provider: RpcProvider, notes: string[] = []): void {
		const state = this.circuitState.get(provider) ?? { failures: 0 };
		state.failures += 1;
		if (state.failures >= this.circuitThreshold) {
			const firstOpen = state.openedAt === undefined;
			state.openedAt = Date.now();
			if (firstOpen) {
				notes.push(this.formatCircuitNote(provider));
			}
		}
		this.circuitState.set(provider, state);
	}

	private getCircuitRemainingMs(provider: RpcProvider): number | null {
		const state = this.circuitState.get(provider);
		if (!state || state.openedAt === undefined) return null;
		const elapsed = Date.now() - state.openedAt;
		if (elapsed >= this.circuitCooldownMs) {
			this.circuitState.set(provider, { failures: 0 });
			return null;
		}
		return Math.max(0, this.circuitCooldownMs - elapsed);
	}

	private formatCircuitNote(provider: RpcProvider, remainingMs?: number): string {
		const endpoint = this.endpointLabels.get(provider) ?? "(unknown)";
		if (remainingMs === undefined) return `circuit open -> ${endpoint}`;
		const remainingSeconds = Math.ceil(remainingMs / 1000);
		return remainingSeconds > 0
			? `circuit open -> ${endpoint} (${remainingSeconds}s left)`
			: `circuit open -> ${endpoint}`;
	}
}
