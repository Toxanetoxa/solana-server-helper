import { describe, expect, it } from 'vitest';
import {
  buildRecommendation,
  computeFeeLamports,
  successFromLatencyMs,
  toSOL,
} from './recommendation.js';

describe('computeFeeLamports', () => {
  it('округляет итоговую стоимость до ближайшего лампорта', () => {
    expect(computeFeeLamports(2_500, 32_500)).toBe(81);
    expect(computeFeeLamports(4_200, 200_000)).toBe(840);
  });

  it('возвращает 0 при минимальных значениях', () => {
    expect(computeFeeLamports(1, 1)).toBe(0);
  });
});

describe('successFromLatencyMs', () => {
  it('даёт больший шанс успеха для агрессивного профиля риска', () => {
    // Для латентности 200мс бонусы по риск-профилю не упираются в верхнюю границу 0.995
    const eco = successFromLatencyMs(200, 'eco');
    const balanced = successFromLatencyMs(200, 'balanced');
    const aggr = successFromLatencyMs(200, 'aggr');

    expect(eco).toBeLessThan(balanced);
    expect(balanced).toBeLessThan(aggr);
  });

  it('ограничивает значение в рамках ожидаемого диапазона', () => {
    expect(successFromLatencyMs(10, 'eco')).toBeLessThanOrEqual(0.995);
    expect(successFromLatencyMs(1_000, 'aggr')).toBeGreaterThanOrEqual(0.55);
  });
});

describe('toSOL', () => {
  it('конвертирует лампорты в SOL', () => {
    expect(toSOL(1_000_000_000)).toBe(1);
    expect(toSOL(500_000_000)).toBe(0.5);
  });
});

describe('buildRecommendation', () => {
  it('формирует рекомендацию с производными полями', () => {
    const now = Date.now();

    const recommendation = buildRecommendation({
      cuPriceMicroLamports: 4_200,
      cuEstimate: 200_000,
      latencyMs: 120,
      risk: 'balanced',
      rpc: 'https://rpc.example.org',
      notes: ['rpc switched -> rpc.example.org'],
      timestamp: now,
    });

    expect(recommendation.cuPriceMicroLamports).toBe(4_200);
    expect(recommendation.cuEstimate).toBe(200_000);
    expect(recommendation.feeLamports).toBe(840);
    expect(recommendation.feeSOL).toBeCloseTo(0.00000084);
    expect(recommendation.success).toBeGreaterThan(0.5);
    expect(recommendation.recommendedRpc).toBe('https://rpc.example.org');
    expect(recommendation.updatedAt).toBe(now);
    expect(recommendation.notes).toEqual(['rpc switched -> rpc.example.org']);
  });

  it('подставляет значения по умолчанию для timestamp и notes', () => {
    const recommendation = buildRecommendation({
      cuPriceMicroLamports: 1_000,
      cuEstimate: 5_000,
      latencyMs: 250,
      risk: 'eco',
      rpc: 'https://rpc.example.org',
    });

    expect(recommendation.updatedAt).toBeTypeOf('number');
    expect(recommendation.notes).toEqual([]);
  });
});
