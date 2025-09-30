// src/main.ts
import { config } from "./config/config.js";
import { makeClients } from "./infrastructure/rpc/factory.js";
import { RpcAggregator } from "./infrastructure/rpc/aggregator.js";
import { WsGateway } from "./infrastructure/ws/wsGateway.js";

import type { Recommendation, Risk, RpcProvider } from "./types/types.js";
import { computeRecommendation } from "./application/computeRecommendation.js";
import { buildFallbackRecommendation, shouldUseFallback } from "./application/fallback.js";
import { normalizeEndpoint } from "./infrastructure/rpc/url.js";

import { createRedisClient, type RedisClient } from "./infrastructure/cache/redisClient.js";
import { RedisCache } from "./infrastructure/cache/redisCache.js";
import { AppError, isAppError, RedisError, RpcError, WsError } from "./errors/appErrors.js";

// ---------------------------
// Global state
// ---------------------------
let rpcAgg: RpcAggregator;
let ws: WsGateway | undefined;
let cache: RedisCache<Recommendation>;
let redis: RedisClient | undefined;
let stopped = false;
let shuttingDown = false;
const lastFreshByRisk = new Map<Risk, number>();
const fallbackUsage: Record<"eco" | "balanced" | "aggr", number> = { eco: 0, balanced: 0, aggr: 0 };

// ---------------------------
// Bootstrap helpers
// ---------------------------
function maskEndpoint(url: string): string {
	// скрываем хвост после /solana/ у Ankr
	return url.replace(/(rpc\.ankr\.com\/solana\/).+/, "$1****");
}

function scheduleExit(code: number, delayMs = 500): void {
	const timer = setTimeout(() => process.exit(code), delayMs);
	// чтобы таймер не держал процесс живым, если всё уже завершено

	timer.unref?.();
}

function logFatal(error: unknown): void {
	if (isAppError(error)) {
		console.error(`[fatal/${error.kind}] ${error.message}`);
		if (error.cause) {
			console.error("[fatal/cause]", error.cause);
		}
		return;
	}
	if (error instanceof Error) {
		console.error("[fatal]", error.message);
		console.error(error.stack);
		return;
	}
	console.error("[fatal]", error);
}

async function closeWebSocket(fatal: boolean): Promise<void> {
	if (!ws) return;
	try {
		await ws.close({
			code: fatal ? 1011 : 1001,
			reason: fatal ? "Server terminated by fatal error" : "Server shutdown",
			timeout: 2000,
		});
	} catch (error) {
		console.error("[ws] close error", error);
	}
	ws = undefined;
}

async function disconnectRedis(): Promise<void> {
	if (!redis) return;
	try {
		await redis.quit();
	} catch (error) {
		console.error("[redis] quit error", error);
		try {
			await redis.disconnect();
		} catch (disconnectErr) {
			console.error("[redis] disconnect error", disconnectErr);
		}
	}
	redis = undefined;
}

async function cleanupResources(fatal: boolean): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;
	await Promise.allSettled([closeWebSocket(fatal), disconnectRedis()]);
}

async function handleFatalError(error: unknown): Promise<void> {
	if (stopped) return;
	stopped = true;
	logFatal(error);
	await cleanupResources(true);
	scheduleExit(1, 0);
}

function registerProcessLevelHandlers(): void {
	process.on("uncaughtException", (error) => {
		void handleFatalError(error);
	});

	process.on("unhandledRejection", (reason) => {
		const error =
			reason instanceof Error
				? reason
				: new AppError("unknown", "Unhandled rejection", { cause: reason });
		void handleFatalError(error);
	});
}

// ---------------------------
// Helpers
// ---------------------------
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

const rpcFromAgg: RpcProvider = {
	async healthProbe() {
		const { snapshot } = await rpcAgg.bestSnapshot();
		return snapshot;
	},
	async recentPrioritizationFees() {
		const { provider } = await rpcAgg.bestSnapshot();
		return rpcAgg.recentPrioritizationFeesPrefer(provider);
	},
};

const DEFAULT_CU: Record<"transfer" | "swap" | "mint", number> = {
	transfer: 32_500,
	swap: 200_000,
	mint: 400_000,
};

const risks = ["eco", "balanced", "aggr"] as const;
type TxType = "transfer" | "swap" | "mint";
const txType: TxType = "transfer";

async function tick() {
	try {
		const { snapshot } = await rpcAgg.bestSnapshot();
		const endpoint = normalizeEndpoint(snapshot.endpoint);
		const snapshotNotes = snapshot.notes ? [...snapshot.notes] : [];

		const entries = await Promise.all(
			risks.map(async (risk): Promise<[Risk, Recommendation]> => {
				const key = `reco:${risk}:${endpoint}:${txType}`;
				const previousFresh = lastFreshByRisk.get(risk);
				let computeError: unknown;
				let computed: Recommendation | null = null;

				try {
					const result = await getOrSet(
						key,
						async () =>
							computeRecommendation({
								risk,
								rpc: rpcFromAgg,
								cuEstimate: DEFAULT_CU[txType],
							}),
						6000 + Math.floor(Math.random() * 500),
					);
					computed = { ...result };
					lastFreshByRisk.set(risk, Date.now());
				} catch (error) {
					computeError = error;
				}

				const lastFreshAt = lastFreshByRisk.get(risk) ?? previousFresh;
				const decision = shouldUseFallback({
					risk,
					snapshot,
					lastFreshAt,
					now: Date.now(),
					staleThresholdMs: config.fallback.staleThresholdMs,
					computeFailed: Boolean(computeError) || !computed,
				});

				if (decision.useFallback || !computed) {
					const fallbackNotes = [...snapshotNotes];
					if (decision.reason) fallbackNotes.push(decision.reason);
					if (computeError instanceof Error) {
						fallbackNotes.push(`error: ${computeError.message}`);
					} else if (computeError) {
						fallbackNotes.push(`error: ${String(computeError)}`);
					}
					fallbackUsage[risk] += 1;
					console.warn(
						`[fallback] risk=${risk} reason=${decision.reason ?? "unknown"} count=${fallbackUsage[risk]}`,
					);
					console.warn(`[metrics] fallback_total{risk="${risk}"} ${fallbackUsage[risk]}`);
					const fallbackRecommendation = buildFallbackRecommendation({
						risk,
						config: config.fallback,
						cuEstimate: DEFAULT_CU[txType],
						notes: fallbackNotes,
					});
					return [risk, fallbackRecommendation];
				}

				const enriched: Recommendation = { ...computed };
				if (snapshot.stale) enriched.stale = true;
				if (snapshotNotes.length) {
					enriched.notes = [...(enriched.notes ?? []), ...snapshotNotes];
				}
				return [risk, enriched];
			}),
		);

		const recos = Object.fromEntries(entries) as Record<Risk, Recommendation>;
		ws?.broadcast(recos);

		console.log(`[tick] ${endpoint} @ ${new Date().toISOString()}`);
	} catch (error) {
		console.error("[tick error]", error);
	}
}
async function startLoop(): Promise<void> {
	while (!stopped) {
		const t0 = Date.now();
		await tick().catch(() => {});
		const delay = Math.max(0, config.wsIntervalMs - (Date.now() - t0));
		await new Promise((resolve) => setTimeout(resolve, delay));
	}
}

function onShutdown(sig: string) {
	if (stopped) return;
	console.log(`[${sig}] shutting down...`);
	stopped = true;
	void cleanupResources(false).finally(() => {
		console.log("[server] shutdown scheduled.");
		scheduleExit(0);
	});
}

function registerShutdownHandlers(): void {
	process.on("SIGINT", () => onShutdown("SIGINT"));
	process.on("SIGTERM", () => onShutdown("SIGTERM"));
}

async function bootstrap(): Promise<void> {
	console.log("[server] starting...");
	console.log("[server] endpoints:", config.endpoints.map(maskEndpoint));

	const clients = makeClients(config.endpoints);

	try {
		rpcAgg = new RpcAggregator(clients);
	} catch (error) {
		throw error instanceof AppError
			? error
			: new RpcError("Failed to initialize RPC aggregator", { cause: error });
	}

	try {
		ws = new WsGateway(config.port);
	} catch (error) {
		throw error instanceof AppError
			? error
			: new WsError(`Failed to start WebSocket gateway on port ${config.port}`, {
					cause: error,
				});
	}

	const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
	const redisPrefix = process.env.REDIS_PREFIX || "fee:";

	redis = createRedisClient(redisUrl);
	try {
		await redis.connect();
	} catch (error) {
		throw new RedisError(`Failed to connect to Redis at ${redisUrl}`, {
			cause: error,
		});
	}

	cache = new RedisCache<Recommendation>(redis, redisPrefix);

	registerProcessLevelHandlers();
	registerShutdownHandlers();

	await startLoop();
}

void bootstrap().catch((error) => handleFatalError(error));
