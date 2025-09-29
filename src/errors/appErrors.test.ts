import { describe, expect, it } from "vitest";
import { AppError, RedisError, RpcError, WsError, isAppError } from "./appErrors.js";

describe("AppError hierarchy", () => {
	it("stores kind and cause", () => {
		const rootCause = new Error("root");
		const error = new AppError("unknown", "boom", { cause: rootCause });

		expect(error.kind).toBe("unknown");
		expect(error.message).toBe("boom");
		expect(error.cause).toBe(rootCause);
		expect(isAppError(error)).toBe(true);
	});

	it("provides specializations for subsystems", () => {
		const rpc = new RpcError("rpc failed");
		const redis = new RedisError("redis failed");
		const ws = new WsError("ws failed");

		expect(rpc.kind).toBe("rpc");
		expect(redis.kind).toBe("redis");
		expect(ws.kind).toBe("ws");

		expect(isAppError(rpc)).toBe(true);
		expect(isAppError(redis)).toBe(true);
		expect(isAppError(ws)).toBe(true);
	});
});
