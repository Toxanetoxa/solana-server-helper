// TODO: сделать
// import { Connection } from "@solana/web3.js";
// import type { NetworkSnapshot, RpcProvider } from "../../types/types.js";
// import { postJson, type JsonRpcResp } from "./baseJsonRpc.js";

// type FeeEstResp = JsonRpcResp<{ priorityFeeEstimate: number }>;

// export class HeliusSolanaRpc implements RpcProvider {
// 	constructor(private readonly url: string) {}
// 	endpoint(): string {
// 		return this.url;
// 	}

// 	async healthProbe(): Promise<NetworkSnapshot> {
// 		const conn = new Connection(this.url, "confirmed");
// 		const t0 = performance.now();
// 		try {
// 			await conn.getSlot("confirmed");
// 			const lat = Math.max(1, Math.round(performance.now() - t0));
// 			return { endpoint: this.url, latencyMs: lat, at: Date.now() };
// 		} catch (e: any) {
// 			return {
// 				endpoint: this.url,
// 				latencyMs: 600,
// 				at: Date.now(),
// 				stale: true,
// 				notes: [`helius probe fail: ${e?.message ?? e}`],
// 			};
// 		}
// 	}

// 	async recentPrioritizationFees(): Promise<number[] | null> {
// 		// возьмём p75 как ориентир
// 		const body = {
// 			jsonrpc: "2.0",
// 			id: 1,
// 			method: "getPriorityFeeEstimate",
// 			params: [{ transaction: null, options: { type: "probabilistic", percentile: 75 } }],
// 		};
// 		const { ok, json } = await postJson<FeeEstResp>(this.url, body, undefined, 1500);
// 		if (!ok || json?.error || !json?.result) return null;
// 		const perCu = Math.round(json.result.priorityFeeEstimate); // µlamports/CU
// 		return [perCu];
// 	}
// }

