// src/infrastructure/rpc/factory.ts
import { AnkrSolanaRpc } from "./ankrSolanaRpc.js";
import { SolanaPublicRpc } from "./solanaPublicRpc.js";
// import { HeliusSolanaRpc } from "./heliusSolanaRpc.js";
import type { RpcProvider } from "../../types/types.js";

export function makeClient(url: string): RpcProvider {
	const u = url.toLowerCase();
	// if (u.includes("helius-rpc.com")) return new HeliusSolanaRpc(url);
	if (u.includes("rpc.ankr.com/solana")) return new AnkrSolanaRpc(url);
	return new SolanaPublicRpc(url);
}

export function makeClients(endpoints: string[]): RpcProvider[] {
	return endpoints.map(makeClient);
}
