import { afterAll, describe, expect, it } from "vitest";

const previousSolana = process.env.RPC_SOLANA;
const previousAnkr = process.env.RPC_ANKR;
const previousHealthInitial = process.env.RPC_HEALTH_BACKOFF_INITIAL_MS;
const previousHealthMax = process.env.RPC_HEALTH_BACKOFF_MAX_MS;
const previousFeesInitial = process.env.RPC_FEES_BACKOFF_INITIAL_MS;
const previousFeesMax = process.env.RPC_FEES_BACKOFF_MAX_MS;
const previousHealthRetries = process.env.RPC_HEALTH_RETRIES;
const previousFeesRetries = process.env.RPC_FEES_RETRIES;
const previousCircuitThreshold = process.env.RPC_CIRCUIT_FAILURE_THRESHOLD;
const previousCircuitCooldown = process.env.RPC_CIRCUIT_COOLDOWN_MS;

process.env.RPC_SOLANA ??= "https://rpc.test/example";
process.env.RPC_ANKR ??= "https://rpc.test/backup";
process.env.RPC_HEALTH_BACKOFF_INITIAL_MS = "0";
process.env.RPC_HEALTH_BACKOFF_MAX_MS = "0";
process.env.RPC_HEALTH_RETRIES = "1";
process.env.RPC_FEES_BACKOFF_INITIAL_MS = "0";
process.env.RPC_FEES_BACKOFF_MAX_MS = "0";
process.env.RPC_FEES_RETRIES = "1";
process.env.RPC_CIRCUIT_FAILURE_THRESHOLD = "2";
process.env.RPC_CIRCUIT_COOLDOWN_MS = "50";

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
		if (previousHealthRetries === undefined) delete process.env.RPC_HEALTH_RETRIES;
		else process.env.RPC_HEALTH_RETRIES = previousHealthRetries;
		if (previousFeesInitial === undefined) delete process.env.RPC_FEES_BACKOFF_INITIAL_MS;
		else process.env.RPC_FEES_BACKOFF_INITIAL_MS = previousFeesInitial;
		if (previousFeesMax === undefined) delete process.env.RPC_FEES_BACKOFF_MAX_MS;
		else process.env.RPC_FEES_BACKOFF_MAX_MS = previousFeesMax;
		if (previousFeesRetries === undefined) delete process.env.RPC_FEES_RETRIES;
		else process.env.RPC_FEES_RETRIES = previousFeesRetries;
		if (previousCircuitThreshold === undefined)
			delete process.env.RPC_CIRCUIT_FAILURE_THRESHOLD;
		else process.env.RPC_CIRCUIT_FAILURE_THRESHOLD = previousCircuitThreshold;
		if (previousCircuitCooldown === undefined) delete process.env.RPC_CIRCUIT_COOLDOWN_MS;
		else process.env.RPC_CIRCUIT_COOLDOWN_MS = previousCircuitCooldown;
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

	it("не опрашивает RPC с открытым circuit", async () => {
		let attempts = 0;
		const badProvider = {
			async healthProbe() {
				attempts += 1;
				throw new Error("boom");
			},
			async recentPrioritizationFees() {
				return [500];
			},
		};
		const goodProvider = {
			async healthProbe() {
				return {
					endpoint: "https://rpc.test/backup",
					latencyMs: 15,
					at: Date.now(),
				};
			},
			async recentPrioritizationFees() {
				return [2_000];
			},
		};

		const aggregator = new RpcAggregator([badProvider, goodProvider]);
		await aggregator.bestSnapshot();
		await aggregator.bestSnapshot();
		const attemptsBeforeCircuitSkip = attempts;
		const third = await aggregator.bestSnapshot();

		expect(attemptsBeforeCircuitSkip).toBeGreaterThan(0);
		expect(attempts).toBe(attemptsBeforeCircuitSkip);
		const circuitNotePresent = third.snapshot.notes?.some((note) =>
			note.startsWith("circuit open -> https://rpc.test/example"),
		);
		expect(circuitNotePresent ?? false).toBe(true);
	});

	it("снова пробует RPC после истечения cool-down", async () => {
		let attempts = 0;
		const flakyProvider = {
			async healthProbe() {
				attempts += 1;
				if (attempts <= 4) {
					throw new Error("boom");
				}
				return {
					endpoint: "https://rpc.test/example",
					latencyMs: 33,
					at: Date.now(),
				};
			},
			async recentPrioritizationFees() {
				return [1_500];
			},
		};

		const aggregator = new RpcAggregator([flakyProvider]);
		await aggregator.bestSnapshot();
		await aggregator.bestSnapshot();
		await aggregator.bestSnapshot();
		const attemptsBeforeCooldown = attempts;
		expect(attemptsBeforeCooldown).toBeGreaterThan(0);

		await new Promise((resolve) => setTimeout(resolve, 60));
		const result = await aggregator.bestSnapshot();

		expect(attempts).toBe(attemptsBeforeCooldown + 1);
		expect(result.snapshot.latencyMs).toBe(33);
	});
});
