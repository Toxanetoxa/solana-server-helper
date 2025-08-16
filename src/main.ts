import { config } from "./config/config.js";
import { SolanaRpc } from "./infrastructure/rpc/solanaRpc.js";
import { WsGateway } from "./infrastructure/ws/wsGateway.js";
import type { Recommendation, Risk } from "./types/types.js";
import { computeRecommendation } from "./application/computeRecommendation.js";
import { createRedisClient } from "./infrastructure/cache/redisClient.js";
import { RedisCache } from "./infrastructure/cache/redisCache.js";

// Инициализация компонентов
console.log("[server] starting...");

const rpc = new SolanaRpc(config.endpoints);
const ws = new WsGateway(config.port);

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const redisPrefix = process.env.REDIS_PREFIX || "fee:";

const redis = createRedisClient(redisUrl);
await redis.connect();

const cache = new RedisCache<Recommendation>(redis, redisPrefix);

// базовые CU-оценки для MVP
const DEFAULT_CU: Record<"transfer" | "swap" | "mint", number> = {
	transfer: 32_500,
	swap: 200_000,
	mint: 400_000,
};

const risks = ["eco", "balanced", "aggr"] as const; // satisfies Risk[]
type TxType = "transfer" | "swap" | "mint";
const txType: TxType = "transfer";

async function tick() {
	try {
		const snapshot = await rpc.healthProbe();
		const endpoint = snapshot.endpoint;

		const entries = await Promise.all(
			risks.map(async (r): Promise<[Risk, Recommendation]> => {
				const key = `reco:${r}:${endpoint}:${txType}`;

				const base = await cache.getOrSet(
					key,
					async () => {
						const reco = await computeRecommendation({
							risk: r,
							rpc,
							cuEstimate: DEFAULT_CU[txType],
							// endpoint, // если computeRecommendation это поддерживает — лучше явно передать
						});
						return reco;
					},
					6_000 + Math.floor(Math.random() * 500),
				);

				const enriched: Recommendation = { ...base };
				if (snapshot.stale) enriched.stale = true;
				if (snapshot.notes?.length)
					enriched.notes = [...(enriched.notes ?? []), ...snapshot.notes];

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

// запуск + аккуратный цикл
let stopped = false;
(async function loop() {
	while (!stopped) {
		const t0 = Date.now();
		await tick().catch(() => {});
		const delay = Math.max(0, config.wsIntervalMs - (Date.now() - t0));
		await new Promise((r) => setTimeout(r, delay));
	}
})();

function onShutdown(sig: string) {
	console.log(`[${sig}] shutting down...`);
	stopped = true;
	try {
		ws.close();
	} catch {
		console.error("[ws] close error");
	}
	redis.quit().catch(() => redis.disconnect());
	// ждем 500 мс, чтобы дать время на закрытие соединений
	console.log("[server] shutdown complete.");
	// форс-выход через 500 мс, если не успеем
	// это нужно, чтобы избежать зависания в случае проблем с закрытием соединений
	// например, если Redis не отвечает или WebSocket не закрывается
	
	setTimeout(() => process.exit(0), 500).unref();
}

process.on("SIGINT", () => onShutdown("SIGINT"));
process.on("SIGTERM", () => onShutdown("SIGTERM"));