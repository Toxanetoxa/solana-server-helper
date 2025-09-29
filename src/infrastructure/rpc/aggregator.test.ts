import { describe, expect, it } from "vitest";
import { RpcAggregator } from "./aggregator.js";
import { RpcError } from "../../errors/appErrors.js";

describe("RpcAggregator", () => {
	it("throws RpcError when instantiated without clients", () => {
		expect(() => new RpcAggregator([])).toThrowError(RpcError);
		expect(() => new RpcAggregator([])).toThrowError(/No RPC clients configured/);
	});
});
