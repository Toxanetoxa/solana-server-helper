import { afterAll, describe, expect, it } from "vitest";

const previousSolana = process.env.RPC_SOLANA;
const previousAnkr = process.env.RPC_ANKR;

process.env.RPC_SOLANA ??= "https://rpc.test/example";

const { RpcAggregator } = await import("./aggregator.js");
const { RpcError } = await import("../../errors/appErrors.js");

describe("RpcAggregator", () => {
	afterAll(() => {
		if (previousSolana === undefined) delete process.env.RPC_SOLANA;
		else process.env.RPC_SOLANA = previousSolana;
		if (previousAnkr === undefined) delete process.env.RPC_ANKR;
		else process.env.RPC_ANKR = previousAnkr;
	});

	it("throws RpcError when instantiated without clients", () => {
		expect(() => new RpcAggregator([])).toThrowError(RpcError);
		expect(() => new RpcAggregator([])).toThrowError(/No RPC clients configured/);
	});
});
