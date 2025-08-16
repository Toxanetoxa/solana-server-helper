import { createClient } from "redis";

type RedisClient = ReturnType<typeof createClient>;

const createRedisClient = (url: string): RedisClient => {
	const client = createClient({ url });
	client.on("error", (e) => console.error("[redis] error:", e));
	return client;
}

export { createRedisClient, RedisClient };
