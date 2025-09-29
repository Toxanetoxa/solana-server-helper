import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RedisCache } from './redisCache.js';
import type { RedisClient } from './redisClient.js';

type RedisStub = {
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  del: ReturnType<typeof vi.fn>;
  pTTL: ReturnType<typeof vi.fn>;
  scanIterator: ReturnType<typeof vi.fn>;
  unlink: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

const createRedisStub = (): RedisStub => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  pTTL: vi.fn().mockResolvedValue(-2),
  scanIterator: vi.fn().mockReturnValue((async function* () {})()),
  unlink: vi.fn().mockResolvedValue(0),
  quit: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn(),
});

const asyncIteratorFrom = (values: string[]) =>
  (async function* () {
    for (const value of values) {
      yield value;
    }
  })();

describe('RedisCache', () => {
  let stub: RedisStub;
  let cache: RedisCache<unknown>;

  beforeEach(() => {
    stub = createRedisStub();
    cache = new RedisCache(stub as unknown as RedisClient, 'cache');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('декодирует сохранённые JSON-значения', async () => {
    const payload = { foo: 'bar' };
    stub.get.mockResolvedValueOnce(JSON.stringify(payload));

    const value = await cache.get('key');

    expect(value).toEqual(payload);
    expect(stub.get).toHaveBeenCalledWith('cache:key');
  });

  it('возвращает undefined, если значение не удаётся распарсить', async () => {
    stub.get.mockResolvedValueOnce('{invalid JSON');

    const value = await cache.get('key');

    expect(value).toBeUndefined();
  });

  it('записывает значение без TTL', async () => {
    await cache.set('key', { foo: 'bar' });

    expect(stub.set).toHaveBeenCalledWith('cache:key', JSON.stringify({ foo: 'bar' }));
  });

  it('записывает значение с TTL в миллисекундах', async () => {
    await cache.set('key', { foo: 'bar' }, 5000);

    expect(stub.set).toHaveBeenCalledWith('cache:key', JSON.stringify({ foo: 'bar' }), { PX: 5000 });
  });

  it('использует значение из кеша и не вызывает producer повторно', async () => {
    stub.get.mockResolvedValueOnce(JSON.stringify({ value: 42 }));
    const producer = vi.fn().mockResolvedValue({ value: 99 });

    const result = await cache.getOrSet('key', producer, 1000);

    expect(result).toEqual({ value: 42 });
    expect(producer).not.toHaveBeenCalled();
  });

  it('вычисляет значение и кладёт его в кеш при промахе', async () => {
    stub.get.mockResolvedValueOnce(null);
    const producer = vi.fn().mockResolvedValue({ value: 99 });

    const result = await cache.getOrSet('key', producer, 1000);

    expect(result).toEqual({ value: 99 });
    expect(stub.set).toHaveBeenCalledWith('cache:key', JSON.stringify({ value: 99 }), { PX: 1000 });
  });

  it('возвращает TTL в миллисекундах или null при отсутствии', async () => {
    stub.pTTL.mockResolvedValueOnce(4500);
    stub.pTTL.mockResolvedValueOnce(-1);

    await expect(cache.ttl('key')).resolves.toBe(4500);
    await expect(cache.ttl('key')).resolves.toBeNull();
  });

  it('очищает весь namespace через scanIterator и unlink', async () => {
    // Сымитируем два ключа под префиксом, чтобы проверить объединение батча.
    stub.scanIterator.mockReturnValueOnce(asyncIteratorFrom(['cache:key1', 'cache:key2']));
    stub.unlink.mockImplementation(async (_first: string, ...rest: string[]) => 1 + rest.length);

    const removed = await cache.purgeNamespace();

    expect(removed).toBe(2);
    expect(stub.scanIterator).toHaveBeenCalledWith({ MATCH: 'cache:*', COUNT: 100 });
    expect(stub.unlink).toHaveBeenCalledWith('cache:key1', 'cache:key2');
  });

  it('при dispose вызывает quit, а при ошибке — disconnect', async () => {
    await cache.dispose();
    expect(stub.quit).toHaveBeenCalled();
    expect(stub.disconnect).not.toHaveBeenCalled();

    const failingStub = createRedisStub();
    failingStub.quit.mockRejectedValueOnce(new Error('boom'));
    const failingCache = new RedisCache(failingStub as unknown as RedisClient, 'cache');

    await failingCache.dispose();
    expect(failingStub.disconnect).toHaveBeenCalled();
  });
});
