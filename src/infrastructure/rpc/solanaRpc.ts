import { Connection } from "@solana/web3.js";
import type { NetworkSnapshot, RpcProvider } from "../../types/types.js";

class SolanaRpc implements RpcProvider {
	private readonly endpoints: string[];
	private lastBest?: string;

	constructor(endpoints: string[]) {
		if (!endpoints.length) throw new Error("Endpoints array cannot be empty");
		this.endpoints = endpoints.map((s) => s.trim()).filter(Boolean);
	}

	async healthProbe(): Promise<NetworkSnapshot> {
		// пробегаемся по списку последовательно (меньше шанс словить 429)
		let best: { url: string; latency: number } | null = null;
		const notes: string[] = [];

		for (const url of this.endpoints) {
			const conn = new Connection(url, "confirmed");
			const t0 = performance.now();

			try {
				// лёгкий вызов
				await conn.getSlot("confirmed");
				const lat = Math.round(performance.now() - t0);
				if (!best || lat < best.latency) best = { url, latency: lat };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`Error fetching recent prioritization fees from ${url}:`, msg);
				notes.push(`probe fail: ${url}`);
			}
		}

		if (!best) {
			const fallback = this.endpoints[0];

			return {
				endpoint: fallback || "",
				latencyMs: 600,
				notes: ["all probes failed"],
				stale: true,
				at: Date.now(),
				risk: "fail",
			};
		}

		const snap: NetworkSnapshot = {
			endpoint: best.url,
			latencyMs: best.latency,
			at: Date.now(),
		};
		if (this.lastBest && this.lastBest !== best.url) {
			snap.notes = [...(snap.notes ?? []), `rpc switched: ${this.lastBest} -> ${best.url}`];
		}
		this.lastBest = best.url;
		return snap;
	}

	async recentPrioritizationFees(): Promise<number[] | null> {
		// этот метод есть не у всех RPC; если упадёт — вернём null
		for (const url of [this.lastBest, ...this.endpoints].filter(Boolean) as string[]) {
			try {
				const res = await fetch(url, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						jsonrpc: "2.0",
						id: 1,
						method: "getRecentPrioritizationFees",
					}),
				});

				if (!res.ok) continue;

				const json = await res.json();

				const arr: Array<{ priorityFee: number }> = json?.result ?? [];

				if (Array.isArray(arr) && arr.length) {
					return arr.slice(0, 16).map((x) => x.priorityFee);
				}
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`Error fetching recent prioritization fees from ${url}:`, msg);
				// если не удалось получить данные, просто пропускаем этот RPC
				continue;
			}
		}

		return null; // если не удалось получить данные ни с одного RPC
	}
}

export { SolanaRpc };
