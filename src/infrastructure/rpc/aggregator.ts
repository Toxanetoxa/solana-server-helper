import type { NetworkSnapshot, RpcProvider } from "../../types/types.js";
import { normalizeEndpoint } from "./url.js";
import { config } from "../../config/config.js";
import { RpcError } from "../../errors/appErrors.js";

export class RpcAggregator {
	private readonly first: RpcProvider;
	private lastBest?: {
		provider: RpcProvider;
		endpoint: string;
		latency: number;
		switchedAt: number;
	};

	// пороги (можно вынести в конфиг)
	private readonly minDwellMs = config.minDwellMs;
	private readonly minGainMs = config.minGainMs;
	private readonly minGainPct = config.minGainPct;

	constructor(private readonly clients: RpcProvider[]) {
		if (!clients.length) throw new RpcError("No RPC clients configured");
		this.first = clients[0]!;
	}

	private isBetter(newLat: number, oldLat: number): boolean {
		const gainMs = oldLat - newLat;
		const gainPct = gainMs / Math.max(oldLat, 1);
		return gainMs >= this.minGainMs || gainPct >= this.minGainPct;
	}

	async bestSnapshot(): Promise<{ snapshot: NetworkSnapshot; provider: RpcProvider }> {
		let best: { snapshot: NetworkSnapshot; provider: RpcProvider } | null = null;

		for (const c of this.clients) {
			try {
				const snap = await c.healthProbe();
				// нормализуем endpoint, чтобы не плодить варианты с /
				snap.endpoint = normalizeEndpoint(snap.endpoint);
				if (!best || snap.latencyMs < best.snapshot.latencyMs) {
					best = { snapshot: snap, provider: c };
				}
			} catch {
				/* ignore */
			}
		}

		if (!best) {
			const fallbackSnap: NetworkSnapshot = {
				endpoint: "(unknown)",
				latencyMs: 600,
				at: Date.now(),
				stale: true,
				notes: ["all probes failed"],
			};
			return { snapshot: fallbackSnap, provider: this.first };
		}

		// sticky-логика: если у нас уже был лучший и время удержания не вышло,
		// переключаемся только при существенном выигрыше
		if (this.lastBest) {
			const dwellOk = Date.now() - this.lastBest.switchedAt >= this.minDwellMs;
			const better = this.isBetter(best.snapshot.latencyMs, this.lastBest.latency);
			if (!dwellOk && !better) {
				// держим прежний RPC
				return {
					snapshot: {
						endpoint: this.lastBest.endpoint,
						latencyMs: this.lastBest.latency,
						at: best.snapshot.at,
						notes: [...(best.snapshot.notes ?? []), "sticky: dwell"],
					},
					provider: this.lastBest.provider,
				};
			}
		}

		// запоминаем нового лучшего и метим переключение
		if (
			!this.lastBest ||
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
		} else {
			// если тот же, обновим latency
			this.lastBest.latency = best.snapshot.latencyMs;
		}

		return best;
	}

	async recentPrioritizationFeesPrefer(preferred?: RpcProvider): Promise<number[] | null> {
		const order = preferred
			? [preferred, ...this.clients.filter((c) => c !== preferred)]
			: [...this.clients];

		for (const c of order) {
			try {
				const fees = await c.recentPrioritizationFees();
				if (fees && fees.length) return fees;
			} catch {
				/* ignore */
			}
		}
		return null;
	}
}
