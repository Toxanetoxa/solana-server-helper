// src/main.ts
import { config } from "./config/config.js";
import { makeClients } from "./infrastructure/rpc/factory.js";
import { RpcAggregator } from "./infrastructure/rpc/aggregator.js";
import { WsGateway } from "./infrastructure/ws/wsGateway.js";

import type { Recommendation, Risk, RpcProvider } from "./types/types.js";
import { computeRecommendation } from "./application/computeRecommendation.js";
import { normalizeEndpoint } from "./infrastructure/rpc/url.js";

import { createRedisClient } from "./infrastructure/cache/redisClient.js";
import { RedisCache } from "./infrastructure/cache/redisCache.js";

// ---------------------------
// Bootstrap
// ---------------------------
function maskEndpoint(url: string): string {
	// скрываем хвост после /solana/ у Ankr
	return url.replace(/(rpc\.ankr\.com\/solana\/).+/, "$1****");
}

console.log("[server] starting...");
console.log("[server] endpoints:", config.endpoints.map(maskEndpoint));

const clients = makeClients(config.endpoints);
const rpcAgg = new RpcAggregator(clients);
const ws = new WsGateway(config.port);

// ---- Redis
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const redisPrefix = process.env.REDIS_PREFIX || "fee:";
const redis = createRedisClient(redisUrl);
await redis.connect();
const cache = new RedisCache<Recommendation>(redis, redisPrefix);

// ---------------------------
// Helpers
// ---------------------------

// Простой get-or-set для RedisCache
async function getOrSet(
	key: string,
	compute: () => Promise<Recommendation>,
	ttlMs: number,
): Promise<Recommendation> {
	const hit = await cache.get(key);
	if (hit) return hit;
	const val = await compute();
	await cache.set(key, val, ttlMs);
	return val;
}

// Адаптер: превращаем агрегатор в RpcProvider, не меняя интерфейсы use-case’ов
const rpcFromAgg: RpcProvider = {
	// берём лучший снапшот по latency
	async healthProbe() {
		const { snapshot } = await rpcAgg.bestSnapshot();
		return snapshot;
	},
	// пытаемся получить µlamports/CU у «лучшего», затем у остальных
	async recentPrioritizationFees() {
		const { provider } = await rpcAgg.bestSnapshot();
		return rpcAgg.recentPrioritizationFeesPrefer(provider);
	},
};

// Базовые CU-оценки (MVP)
const DEFAULT_CU: Record<"transfer" | "swap" | "mint", number> = {
	transfer: 32_500,
	swap: 200_000,
	mint: 400_000,
};

const risks = ["eco", "balanced", "aggr"] as const;
type TxType = "transfer" | "swap" | "mint";
const txType: TxType = "transfer";

// ---------------------------
// Tick loop
// ---------------------------

async function tick() {
	try {
		// один раз снимаем лучший снапшот — для ключа кэша и меток stale/notes
		const { snapshot } = await rpcAgg.bestSnapshot();
		const endpoint = normalizeEndpoint(snapshot.endpoint);

		const entries = await Promise.all(
			risks.map(async (r): Promise<[Risk, Recommendation]> => {
				const key = `reco:${r}:${endpoint}:${txType}`;

				// кэшируем коротко (6–6.5s) — чуть меньше интервала WS, с джиттером
				const reco = await getOrSet(
					key,
					async () =>
						computeRecommendation({
							risk: r,
							rpc: rpcFromAgg, // используем адаптер поверх агрегатора
							cuEstimate: DEFAULT_CU[txType],
						}),
					6000 + Math.floor(Math.random() * 500),
				);

				// пометим stale/notes, если снапшот был «устаревший»
				const enriched: Recommendation = { ...reco };
				if (snapshot.stale) enriched.stale = true;
				if (snapshot.notes?.length) {
					enriched.notes = [...(enriched.notes ?? []), ...snapshot.notes];
				}
				return [r, enriched];
			}),
		);

		const recos = Object.fromEntries(entries) as Record<Risk, Recommendation>;
		ws.broadcast(recos);

		console.log(`[tick] ${endpoint} @ ${new Date().toISOString()}`);
	} catch (e) {
		console.error("[tick error]", e);
	}
}

// Аккуратный цикл
let stopped = false;
(async function loop() {
	while (!stopped) {
		const t0 = Date.now();
		await tick().catch(() => {});
		const delay = Math.max(0, config.wsIntervalMs - (Date.now() - t0));
		await new Promise((r) => setTimeout(r, delay));
	}
})();

// ---------------------------
// Graceful shutdown
// ---------------------------

function onShutdown(sig: string) {
	console.log(`[${sig}] shutting down...`);
	stopped = true;
	try {
		ws.close();
	} catch {
		console.error("[ws] close error");
	}
	redis.quit().catch(() => redis.disconnect());
	console.log("[server] shutdown scheduled.");
	setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGINT", () => onShutdown("SIGINT"));
process.on("SIGTERM", () => onShutdown("SIGTERM"));
