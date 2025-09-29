/* eslint-disable @typescript-eslint/consistent-type-imports */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { RedisCache } from '../cache/redisCache.js';
import type { RedisClient } from '../cache/redisClient.js';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

process.env.RPC_SOLANA = 'https://rpc.test/fast';
process.env.RPC_ANKR = 'https://rpc.test/slow';

const fastUrl = 'https://rpc.test/fast';
const slowUrl = 'https://rpc.test/slow';

const baseHandlers = [
  http.post(fastUrl, async ({ request }) => {
    const raw = await request.json();
    const body = (raw ?? {}) as { method?: string; id?: number };
    if (body.method === 'getSlot') {
      await delay(5);
      return HttpResponse.json({ jsonrpc: '2.0', id: body.id, result: 123 });
    }
    if (body.method === 'getRecentPrioritizationFees') {
      return HttpResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        result: [
          { priorityFee: 1_200 },
          { priorityFee: 1_400 },
          { priorityFee: 1_800 },
        ],
      });
    }
    return new HttpResponse(null, { status: 404 });
  }),
  http.post(slowUrl, async ({ request }) => {
    const raw = await request.json();
    const body = (raw ?? {}) as { method?: string; id?: number };
    if (body.method === 'getSlot') {
      await delay(25);
      return HttpResponse.json({ jsonrpc: '2.0', id: body.id, result: 456 });
    }
    if (body.method === 'getRecentPrioritizationFees') {
      return HttpResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        result: [
          { priorityFee: 3_200 },
          { priorityFee: 3_400 },
          { priorityFee: 3_600 },
        ],
      });
    }
    return new HttpResponse(null, { status: 404 });
  }),
];

const server = setupServer(...baseHandlers);

let RpcAggregator: typeof import('./aggregator.js')['RpcAggregator'];
let makeClients: typeof import('./factory.js')['makeClients'];

type StoreEntry = {
  value: string;
  expiresAt?: number;
};

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, "\\$&");
  const regex = escaped.replace(/\*/g, ".*");
  return new RegExp(`^${regex}$`);
}

function createRedisClientMock(): RedisClient {
  const store = new Map<string, StoreEntry>();

  function purgeIfExpired(key: string): void {
    const entry = store.get(key);
    if (!entry) return;
    if (entry.expiresAt && entry.expiresAt <= Date.now()) store.delete(key);
  }

  const client: Partial<Record<keyof RedisClient, unknown>> = {
    async get(key: string) {
      purgeIfExpired(key);
      const entry = store.get(key);
      return entry ? entry.value : null;
    },
    async set(key: string, value: string, options?: { PX?: number }) {
      const expiresAt = options?.PX ? Date.now() + options.PX : undefined;
      store.set(key, { value, expiresAt });
      return 'OK';
    },
    async del(key: string) {
      return store.delete(key) ? 1 : 0;
    },
    async pTTL(key: string) {
      purgeIfExpired(key);
      const entry = store.get(key);
      if (!entry) return -2;
      if (!entry.expiresAt) return -1;
      return Math.max(0, entry.expiresAt - Date.now());
    },
    scanIterator({ MATCH, COUNT = 10 }: { MATCH: string; COUNT?: number }) {
      const regex = wildcardToRegExp(MATCH);
      const keys = Array.from(store.keys()).filter((key) => {
        purgeIfExpired(key);
        return regex.test(key) && store.has(key);
      });
      const chunk = COUNT;
      let index = 0;
      return (async function* () {
        while (index < keys.length) {
          const batch = keys.slice(index, index + chunk);
          index += batch.length;
          for (const key of batch) {
            yield key;
          }
        }
      })();
    },
    async unlink(...keys: string[]) {
      let removed = 0;
      for (const key of keys) {
        purgeIfExpired(key);
        if (store.delete(key)) removed += 1;
      }
      return removed;
    },
    async quit() {
      return undefined;
    },
    disconnect() {
      store.clear();
    },
  };

  return client as unknown as RedisClient;
}

beforeAll(async () => {
  server.listen({ onUnhandledRequest: 'error' });
  ({ RpcAggregator } = await import('./aggregator.js'));
  ({ makeClients } = await import('./factory.js'));
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
  delete process.env.RPC_SOLANA;
  delete process.env.RPC_ANKR;
});

describe('RpcAggregator (integration)', () => {
  it('выбирает RPC с минимальной задержкой и возвращает её снапшот', async () => {
    const clients = makeClients([slowUrl, fastUrl]);
    const aggregator = new RpcAggregator(clients);

    const { snapshot, provider } = await aggregator.bestSnapshot();

    expect(snapshot.endpoint).toBe(fastUrl);
    expect(snapshot.latencyMs).toBeLessThan(20);

    const fees = await aggregator.recentPrioritizationFeesPrefer(provider);
    expect(fees).toEqual([1_200, 1_400, 1_800]);
  });

  it('фолбечит на другие RPC, если предпочитаемый не вернул fees', async () => {
    server.use(
      http.post(fastUrl, async ({ request }) => {
        const raw = await request.json();
        const body = (raw ?? {}) as { method?: string; id?: number };
        if (body.method === 'getSlot') {
          await delay(5);
          return HttpResponse.json({ jsonrpc: '2.0', id: body.id, result: 123 });
        }
        if (body.method === 'getRecentPrioritizationFees') {
          return HttpResponse.json({ jsonrpc: '2.0', id: body.id, result: [] });
        }
        return new HttpResponse(null, { status: 404 });
      }),
    );

    const clients = makeClients([fastUrl, slowUrl]);
    const aggregator = new RpcAggregator(clients);

    const { provider } = await aggregator.bestSnapshot();
    const fees = await aggregator.recentPrioritizationFeesPrefer(provider);

    expect(fees).toEqual([3_200, 3_400, 3_600]);
  });

  it('кэширует результат bestSnapshot в Redis mock', async () => {
    const redisClient = createRedisClientMock();
    const cache = new RedisCache<{ endpoint: string }>(redisClient, 'agg');
    const aggregator = new RpcAggregator(makeClients([slowUrl, fastUrl]));

    const compute = async () => {
      const { snapshot } = await aggregator.bestSnapshot();
      return { endpoint: snapshot.endpoint };
    };

    const first = await cache.getOrSet('best', compute, 3_000);
    expect(first.endpoint).toBe(fastUrl);

    const second = await cache.getOrSet('best', async () => ({ endpoint: slowUrl }));
    expect(second.endpoint).toBe(fastUrl);

    await cache.dispose();
  });
});
