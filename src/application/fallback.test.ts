import { describe, expect, it } from "vitest";
import type { NetworkSnapshot } from "../types/types.js";
import {
	buildFallbackRecommendation,
	shouldUseFallback,
	type FallbackFeeConfig,
} from "./fallback.js";

describe("fallback utilities", () => {
	const config: FallbackFeeConfig = {
		cuPriceMicroLamports: {
			eco: 3_000,
			balanced: 4_000,
			aggr: 5_000,
			fail: 4_000,
		},
		latencyMs: 500,
		rpcLabel: "(fallback)",
		staleThresholdMs: 40_000,
	};

	it("trigger fallback when compute fails", () => {
		const decision = shouldUseFallback({
			risk: "eco",
			computeFailed: true,
			snapshot: undefined,
			lastFreshAt: undefined,
			now: Date.now(),
			staleThresholdMs: config.staleThresholdMs,
		});

		expect(decision.useFallback).toBe(true);
		expect(decision.reason).toContain("compute error");
	});

	it("trigger fallback when snapshot stale too long", () => {
		const now = Date.now();
		const snapshot: NetworkSnapshot = {
			endpoint: "https://rpc.test",
			latencyMs: 100,
			at: now - 60_000,
			stale: true,
		};

		const decision = shouldUseFallback({
			risk: "balanced",
			computeFailed: false,
			snapshot,
			lastFreshAt: now - 10_000,
			now,
			staleThresholdMs: 30_000,
		});

		expect(decision.useFallback).toBe(true);
		expect(decision.reason).toContain("stale snapshot");
	});

	it("builds fallback recommendation with notes", () => {
		const recommendation = buildFallbackRecommendation({
			risk: "aggr",
			config,
			cuEstimate: 32_500,
			notes: ["fallback triggered"],
		});

		expect(recommendation.cuPriceMicroLamports).toBe(5_000);
		expect(recommendation.recommendedRpc).toBe("(fallback)");
		expect(recommendation.stale).toBe(true);
		expect(recommendation.notes?.includes("fallback triggered")).toBe(true);
	});
});
