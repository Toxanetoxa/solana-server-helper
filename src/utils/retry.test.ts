import { describe, expect, it, vi } from "vitest";
import { retryWithBackoff } from "./retry.js";

describe("retryWithBackoff", () => {
	// Проверяем базовые сценарии работы ретраев с экспоненциальным бэкоффом
	it("повторяет попытки до успеха", async () => {
		vi.useFakeTimers();
		const action = vi
			.fn<[], Promise<string>>()
			.mockRejectedValueOnce(new Error("fail"))
			.mockResolvedValue("ok");

		const promise = retryWithBackoff(() => action(), {
			retries: 2,
			initialDelayMs: 10,
			maxDelayMs: 10,
			jitterRatio: 0,
		});
		const assertion = expect(promise).resolves.toBe("ok");
		await vi.runAllTimersAsync();
		await assertion;
		expect(action).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});

	it("бросает ошибку после исчерпания попыток", async () => {
		vi.useFakeTimers();
		const action = vi.fn<[], Promise<string>>().mockRejectedValue(new Error("boom"));

		const promise = retryWithBackoff(() => action(), {
			retries: 1,
			initialDelayMs: 5,
			maxDelayMs: 5,
			jitterRatio: 0,
		});
		const assertion = expect(promise).rejects.toThrow("boom");
		await vi.runAllTimersAsync();
		await assertion;
		expect(action).toHaveBeenCalledTimes(2);
		vi.useRealTimers();
	});
});
