import { afterAll, describe, expect, it } from "vitest";

const previousSolana = process.env.RPC_SOLANA;
const previousAnkr = process.env.RPC_ANKR;
const previousHealthInitial = process.env.RPC_HEALTH_BACKOFF_INITIAL_MS;
const previousHealthMax = process.env.RPC_HEALTH_BACKOFF_MAX_MS;
const previousFeesInitial = process.env.RPC_FEES_BACKOFF_INITIAL_MS;
const previousFeesMax = process.env.RPC_FEES_BACKOFF_MAX_MS;

process.env.RPC_SOLANA ??= "https://rpc.test/example";
process.env.RPC_HEALTH_BACKOFF_INITIAL_MS = "0";
process.env.RPC_HEALTH_BACKOFF_MAX_MS = "0";
process.env.RPC_FEES_BACKOFF_INITIAL_MS = "0";
process.env.RPC_FEES_BACKOFF_MAX_MS = "0";

const { RpcAggregator } = await import("./aggregator.js");
const { RpcError } = await import("../../errors/appErrors.js");

describe("RpcAggregator", () => {
	// После тестов возвращаем значения env, чтобы не ломать другие сценарии
	afterAll(() => {
		if (previousSolana === undefined) delete process.env.RPC_SOLANA;
		else process.env.RPC_SOLANA = previousSolana;
		if (previousAnkr === undefined) delete process.env.RPC_ANKR;
		else process.env.RPC_ANKR = previousAnkr;
		if (previousHealthInitial === undefined) delete process.env.RPC_HEALTH_BACKOFF_INITIAL_MS;
		else process.env.RPC_HEALTH_BACKOFF_INITIAL_MS = previousHealthInitial;
		if (previousHealthMax === undefined) delete process.env.RPC_HEALTH_BACKOFF_MAX_MS;
		else process.env.RPC_HEALTH_BACKOFF_MAX_MS = previousHealthMax;
		if (previousFeesInitial === undefined) delete process.env.RPC_FEES_BACKOFF_INITIAL_MS;
		else process.env.RPC_FEES_BACKOFF_INITIAL_MS = previousFeesInitial;
		if (previousFeesMax === undefined) delete process.env.RPC_FEES_BACKOFF_MAX_MS;
		else process.env.RPC_FEES_BACKOFF_MAX_MS = previousFeesMax;
	});

	it("бросает RpcError при создании без клиентов", () => {
		expect(() => new RpcAggregator([])).toThrowError(RpcError);
		expect(() => new RpcAggregator([])).toThrowError(/No RPC clients configured/);
	});
	it("повторяет health probe до успеха", async () => {
		let attempts = 0;
		const stubProvider = {
			// имитируем задержки в RPC-провайдере
			async healthProbe() {
				attempts += 1;
				if (attempts < 2) {
					throw new Error("health попытка");
				}
				return {
					endpoint: "https://rpc.test/example",
					latencyMs: 42,
					at: Date.now(),
				};
			},
			async recentPrioritizationFees() {
				return [1_000];
			},
		};

		const aggregator = new RpcAggregator([stubProvider]);
		const { snapshot } = await aggregator.bestSnapshot();

		expect(attempts).toBe(2);
		expect(snapshot.latencyMs).toBe(42);
	});

	it("повторяет получение приоритетных комиссий", async () => {
		let attempts = 0;
		const stubProvider = {
			// имитируем задержки в RPC-провайдере
			async healthProbe() {
				return {
					endpoint: "https://rpc.test/example",
					latencyMs: 21,
					at: Date.now(),
				};
			},
			async recentPrioritizationFees() {
				attempts += 1;
				if (attempts < 2) {
					throw new Error("fees попытка");
				}
				return [2_000];
			},
		};

		const aggregator = new RpcAggregator([stubProvider]);
		const fees = await aggregator.recentPrioritizationFeesPrefer(stubProvider);

		expect(attempts).toBe(2);
		expect(fees).toEqual([2_000]);
	});
});
