import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { computeRecommendation } from './computeRecommendation.js';
import type { NetworkSnapshot, RpcProvider } from '../types/types.js';

describe('computeRecommendation', () => {
  const baseSnapshot: NetworkSnapshot = {
    endpoint: 'https://rpc.example.org',
    latencyMs: 120,
    at: Date.now(),
    notes: ['latency ok'],
  };

  let rpc: RpcProvider;
  let healthProbeMock: ReturnType<typeof vi.fn<[], Promise<NetworkSnapshot>>>;
  let feesMock: ReturnType<typeof vi.fn<[], Promise<number[] | null>>>;

  beforeEach(() => {
    healthProbeMock = vi.fn<[], Promise<NetworkSnapshot>>().mockResolvedValue({ ...baseSnapshot });
    feesMock = vi.fn<[], Promise<number[] | null>>();

    rpc = {
      healthProbe: healthProbeMock,
      recentPrioritizationFees: feesMock,
    } as RpcProvider;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('использует P75 приоритетных комиссий, если они доступны', async () => {
    const fees = [2_000, 1_000, 4_000, 3_000];
    feesMock.mockResolvedValue(fees);

    const result = await computeRecommendation({
      risk: 'eco',
      rpc,
      cuEstimate: 200_000,
    });

    expect(result.cuPriceMicroLamports).toBe(4_000); // P75 из fees
    expect(result.feeLamports).toBe(800);
    expect(result.recommendedRpc).toBe(baseSnapshot.endpoint);
    expect(result.notes).toContain('latency ok');
  });

  it('fallback-логика строит цену по latency, если fees нет', async () => {
    feesMock.mockResolvedValue(null);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await computeRecommendation({
      risk: 'balanced',
      rpc,
      cuEstimate: 32_500,
    });

    // Латентность 120мс → базовая цена: 2500 + (40 * 8.5) = 2840; balanced даёт +10%.
    expect(result.cuPriceMicroLamports).toBe(3_124);
    expect(result.feeLamports).toBe(Math.round(3_124 * 32_500 / 1e6));
    expect(result.success).toBeGreaterThan(0.5);

    consoleSpy.mockRestore();
  });

  it('бросает ошибку, если снапшот помечен как stale', async () => {
    healthProbeMock.mockResolvedValue({
      ...baseSnapshot,
      stale: true,
    });

    await expect(
      computeRecommendation({
        risk: 'eco',
        rpc,
        cuEstimate: 10_000,
      }),
    ).rejects.toThrow('Failed to get a valid network snapshot');
  });
});
