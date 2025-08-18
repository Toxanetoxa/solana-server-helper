import type { NetworkSnapshot, RpcProvider, JsonRpcResp } from "../../types/types.js";
import { postJson } from "./baseJsonRpc.js";

class SolanaPublicRpc implements RpcProvider {
	constructor(private readonly url: string) {}

	async healthProbe(): Promise<NetworkSnapshot> {
		const t0 = performance.now();
		const body = {
			jsonrpc: "2.0",
			id: 1,
			method: "getSlot",
			params: [{ commitment: "confirmed" }],
		};
		const { ok, json, text, status } = await postJson<JsonRpcResp<number>>(
			this.url,
			body,
			undefined,
			1500,
		);

		if (!ok || json?.error) {
			const msg = json?.error?.message || text || `status ${status}`;
			return {
				endpoint: this.url,
				latencyMs: 600,
				at: Date.now(),
				stale: true,
				notes: [`public probe fail: ${msg}`],
			};
		}
		const latency = Math.max(1, Math.round(performance.now() - t0));
		return { endpoint: this.url, latencyMs: latency, at: Date.now() };
	}

	async recentPrioritizationFees(): Promise<number[] | null> {
		const req = { jsonrpc: "2.0", id: 1, method: "getRecentPrioritizationFees" as const };
		const { ok, json } = await postJson<JsonRpcResp<Array<{ priorityFee: number }>>>(
			this.url,
			req,
			undefined,
			1500,
		);
		if (!ok || json?.error) return null;
		const arr = json?.result ?? [];
		if (!Array.isArray(arr) || !arr.length) return null;
		return arr.slice(0, 16).map((x) => x.priorityFee);
	}
}

export { SolanaPublicRpc };