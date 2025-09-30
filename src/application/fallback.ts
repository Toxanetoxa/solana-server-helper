import { buildRecommendation } from "../domain/recommendation.js";
import type { NetworkSnapshot, Recommendation, Risk } from "../types/types.js";

export interface FallbackFeeConfig {
	readonly cuPriceMicroLamports: Record<Risk, number>;
	readonly latencyMs: number;
	readonly rpcLabel: string;
	readonly staleThresholdMs: number;
}

export interface FallbackDecision {
	readonly useFallback: boolean;
	readonly reason?: string;
	readonly staleDurationMs?: number;
}

export interface FallbackDecisionContext {
	risk: Risk;
	snapshot?: NetworkSnapshot | null;
	lastFreshAt?: number | undefined;
	now: number;
	staleThresholdMs: number;
	computeFailed: boolean;
}

export interface BuildFallbackParams {
	risk: Risk;
	config: FallbackFeeConfig;
	cuEstimate: number;
	notes?: string[];
}

export function shouldUseFallback(context: FallbackDecisionContext): FallbackDecision {
	const { computeFailed, snapshot, lastFreshAt, now, staleThresholdMs } = context;

	if (computeFailed) {
		return { useFallback: true, reason: "fallback: compute error" };
	}

	if (snapshot?.stale) {
		const staleDuration = Math.max(0, now - snapshot.at);
		if (staleDuration >= staleThresholdMs) {
			const seconds = Math.round(staleDuration / 1000);
			return {
				useFallback: true,
				reason: `fallback: stale snapshot ${seconds}s`,
				staleDurationMs: staleDuration,
			};
		}
	}

	if (lastFreshAt !== undefined) {
		const inactiveDuration = now - lastFreshAt;
		if (inactiveDuration >= staleThresholdMs) {
			const seconds = Math.round(inactiveDuration / 1000);
			return {
				useFallback: true,
				reason: `fallback: no fresh data ${seconds}s`,
				staleDurationMs: inactiveDuration,
			};
		}
	}

	return { useFallback: false };
}

export function buildFallbackRecommendation(params: BuildFallbackParams): Recommendation {
	const { risk, config, cuEstimate, notes } = params;
	const cuPrice = config.cuPriceMicroLamports[risk];
	const safeNotes = notes ?? [];

	const recommendation = buildRecommendation({
		cuPriceMicroLamports: cuPrice,
		cuEstimate,
		latencyMs: config.latencyMs,
		risk,
		rpc: config.rpcLabel,
		notes: safeNotes,
		timestamp: Date.now(),
	});

	recommendation.stale = true;
	return recommendation;
}
