import type { Cache } from "../../types/types.js";
import type { RedisClient } from "./redisClient.js";

type JsonValue = unknown;

function encode(val: unknown): string {
	return JSON.stringify(val, (_k, v) => (typeof v === "bigint" ? `${v}n` : v));
}
function decode<T = unknown>(raw: string | null): T | undefined {
	if (raw == null) return undefined;
	try {
		return JSON.parse(raw) as T;
	} catch {
		return undefined;
	}
}

/**
 * Redis-backed Cache<K,V>.
 * Ограничение: ключи в Redis — строки, поэтому K = string.
 */
export class RedisCache<V> implements Cache<string, V> {
	constructor(
		private readonly client: RedisClient,
		private readonly prefix = "cache:",
	) {
		this.prefix = prefix.endsWith(":") ? prefix : `${prefix}:`;
	}

	private k(key: string): string {
		return this.prefix + key;
	}

	async get(key: string): Promise<V | undefined> {
		const raw = await this.client.get(this.k(key));
		return decode<V>(raw);
	}

	async set(key: string, val: V, ttlMs?: number): Promise<void> {
		const k = this.k(key);
		const v = encode(val as JsonValue);

		if (ttlMs && ttlMs > 0) {
			// PX — TTL в миллисекундах
			await this.client.set(k, v, { PX: ttlMs });
		} else {
			await this.client.set(k, v);
		}
	}

	async del(key: string): Promise<void> {
		await this.client.del(this.k(key));
	}

	async ttl(key: string): Promise<number | null> {
		const t = await this.client.pTTL(this.k(key)); // в мс, -1 нет TTL, -2 нет ключа
		if (t < 0) return null;
		return t;
	}

	// Чистим namespace
	async purgeNamespace(): Promise<number> {
		const match = this.k("*");
		type Key = Parameters<RedisClient["unlink"]>[0];
		type NonEmpty = [Key, ...Key[]];

		let total = 0;
		let batch: Key[] = [];
		const unlinkRest = this.client.unlink as (first: Key, ...rest: Key[]) => Promise<number>;

		for await (const key of this.client.scanIterator({ MATCH: match, COUNT: 100 })) {
			batch.push(key as Key);
			if (batch.length >= 500) {
				const [first, ...rest] = batch as NonEmpty;
				total += await unlinkRest(first, ...rest);
				batch = [];
			}
		}
		if (batch.length) {
			const [first, ...rest] = batch as NonEmpty;
			total += await unlinkRest(first, ...rest);
		}
		return total;
	}

	async getOrSet<T extends V>(
		key: string,
		producer: () => Promise<T>,
		ttlMs?: number,
	): Promise<T> {
		const cached = await this.get(key);
		if (cached !== undefined) return cached as T;
		const val = await producer();
		await this.set(key, val, ttlMs);
		return val;
	}

	async dispose(): Promise<void> {
		try {
			await this.client.quit();
		} catch {
			this.client.disconnect();
		}
	}
}
