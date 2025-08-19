import type { Risk, Recommendation, IBuildRecommendationParams } from '../types/types.js';

const computeFeeLamports = (cuPriceMicroLamports: number, cuEstimate: number): number => {
	return Math.round(cuPriceMicroLamports * cuEstimate / 1e6);
}

// базовая эвристика: мягкая зависимость успеха от «загрузки» в мс
const successFromLatencyMs = (latencyMs: number, risk: Risk): number => {
	// 80ms → ~0.9, 500ms → ~0.6
	const base = 0.97 - Math.min(0.5, Math.max(0, (latencyMs - 80) / 1000) * 0.7);
	const bonus = risk === 'aggr' ? 0.08 : risk === 'balanced' ? 0.04 : 0;
	const s = Math.min(0.995, Math.max(0.55, base + bonus));
	return Number(s.toFixed(2));
}

const toSOL = (lamports: number): number => {
	return lamports / 1e9;
}

const buildRecommendation = (params: IBuildRecommendationParams ): Recommendation => {
        const feeLamports = computeFeeLamports(params.cuPriceMicroLamports, params.cuEstimate);
        const feeSOL = toSOL(feeLamports);
        const success = successFromLatencyMs(params.latencyMs, params.risk);
        return {
                cuPriceMicroLamports: params.cuPriceMicroLamports,
                cuEstimate: params.cuEstimate,
                feeLamports,
                feeSOL,
                success,
                recommendedRpc: params.rpc,
                updatedAt: params.timestamp ?? Date.now(),
                notes: params.notes ?? []
        };
}

export {
	computeFeeLamports,
	successFromLatencyMs,
	toSOL,
	buildRecommendation
};