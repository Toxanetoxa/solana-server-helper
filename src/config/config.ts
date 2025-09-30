import "dotenv/config";
import { normalizeEndpoint } from "../infrastructure/rpc/url.js";

function envUrl(v?: string): string | undefined {
	if (!v) return undefined;
	// убираем кавычки/пробелы/переводы строк
	const s = v.replace(/^['"]|['"]$/g, "").trim();
	try {
		const u = new URL(s); // валидируем
		return u.toString();
	} catch {
		return undefined;
	}
}

const envRPCUrls = [process.env.RPC_SOLANA, process.env.RPC_ANKR];

const endpoints = envRPCUrls
	.map((url) => envUrl(url))
	.filter((x): x is string => Boolean(x))
	.map((url) => normalizeEndpoint(url));

// дефолты для ретраев health опросов
const rpcProbeBackoff = {
	retries: Number.parseInt(process.env.RPC_HEALTH_RETRIES ?? "2", 10),
	initialDelayMs: Number.parseInt(process.env.RPC_HEALTH_BACKOFF_INITIAL_MS ?? "100", 10),
	maxDelayMs: Number.parseInt(process.env.RPC_HEALTH_BACKOFF_MAX_MS ?? "1500", 10),
};

// дефолты для ретраев получения комиссий
const rpcFeeBackoff = {
	retries: Number.parseInt(process.env.RPC_FEES_RETRIES ?? "2", 10),
	initialDelayMs: Number.parseInt(process.env.RPC_FEES_BACKOFF_INITIAL_MS ?? "100", 10),
	maxDelayMs: Number.parseInt(process.env.RPC_FEES_BACKOFF_MAX_MS ?? "1500", 10),
};

if (endpoints.length === 0) {
	// Лог для дебага: какие значения реально пришли
	console.error("[config] RPC_SOLANA:", process.env.RPC_SOLANA);
	console.error("[config] RPC_ANKR:", process.env.RPC_ANKR);
	throw new Error(
		"No RPC endpoints configured. Set RPC_SOLANA and/or RPC_ANKR in .env or docker-compose environment.",
	);
}

export const config = {
	port: Number.parseInt(process.env.PORT || "8787", 10),
	wsIntervalMs: Number.parseInt(process.env.WS_BROADCAST_INTERVAL_MS || "8000", 10),
	endpoints,
	minDwellMs: Number.parseInt(process.env.RPC_MIN_DWELL_MS ?? "60000", 10), // минимум 60с держим текущий RPC
	minGainMs: Number.parseInt(process.env.RPC_MIN_GAIN_MS ?? "10", 10), // переключаемся, если новый лучше минимум на 10мс
	minGainPct: Number.parseFloat(process.env.RPC_MIN_GAIN_PCT ?? "0.10"), // …или лучше на 10% от текущей латентности
	rpcProbeBackoff,
	rpcFeeBackoff,
};
