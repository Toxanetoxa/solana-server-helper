export interface RetryOptions<T> {
	retries?: number;
	initialDelayMs?: number;
	maxDelayMs?: number;
	factor?: number;
	jitterRatio?: number;
	validate?: (value: T) => boolean;
	shouldRetry?: (error: unknown) => boolean;
	onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
}

export async function retryWithBackoff<T>(
	action: (attempt: number) => Promise<T>,
	options: RetryOptions<T> = {},
): Promise<T> {
	const {
		retries = 2,
		initialDelayMs = 100,
		maxDelayMs = 1000,
		factor = 2,
		jitterRatio = 0.2,
		validate,
		shouldRetry,
		onRetry,
	} = options;

	// количество попыток и текущая задержка между ними
	let attempt = 0;
	let delay = Math.max(0, initialDelayMs);
	let lastError: unknown;

	while (attempt <= retries) {
		try {
			// выполняем действие; если оно прошло, возвращаем
			const result = await action(attempt);
			if (!validate || validate(result)) {
				return result;
			}
			lastError = new Error("retry validation failed");
		} catch (error) {
			lastError = error;
			if (attempt >= retries) break;
			if (shouldRetry && !shouldRetry(error)) {
				throw error;
			}
			const waitMs = Math.min(maxDelayMs, delay);
			onRetry?.(error, attempt + 1, waitMs);
			await wait(waitMs, jitterRatio);
			attempt += 1;
			delay = Math.min(maxDelayMs, Math.max(initialDelayMs, delay * factor));
			continue;
		}

		if (attempt >= retries) break;
		const waitMs = Math.min(maxDelayMs, delay);
		onRetry?.(lastError, attempt + 1, waitMs);
		await wait(waitMs, jitterRatio);
		attempt += 1;
		delay = Math.min(maxDelayMs, Math.max(initialDelayMs, delay * factor));
	}

	throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function wait(delayMs: number, jitterRatio: number): Promise<void> {
	const jitter = delayMs * jitterRatio * Math.random();
	const total = delayMs + jitter;
	await new Promise((resolve) => setTimeout(resolve, total));
}
