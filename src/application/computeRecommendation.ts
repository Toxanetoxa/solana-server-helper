import type { IBuildRecommendationParams, IComputeRecommendationParams, Recommendation } from '../types/types.js';
import { buildRecommendation } from '../domain/recommendation.js';

const computeRecommendation = async (
	params: IComputeRecommendationParams
): Promise<Recommendation> => {
	const snapshot = await params.rpc.healthProbe();

	if (!snapshot || snapshot.stale) {
		throw new Error('Failed to get a valid network snapshot');
	}

	// возьмём P75 цену за CU из последних приоритетных комиссий, если доступны
	let cuPriceMicroLm: number | undefined;

	try {
		const fees = await params.rpc.recentPrioritizationFees(); // µlamports/CU

		if (fees && fees.length) {
			const sorted = [...fees].sort((a, b) => a - b);
			const p = sorted[Math.floor(sorted.length * 0.75)];
			cuPriceMicroLm = p;
		}

	} catch (error) {
		// если не удалось получить приоритетные комиссии, используем значение по умолчанию
		// TODO: возможно, стоит логировать ошибку

		if (error instanceof Error) {
			console.error('Error fetching recent prioritization fees:', error.message);
		} else {
			console.error('Unexpected error fetching recent prioritization fees:', error);
		}
	}

	if (!cuPriceMicroLm) {
		const l = snapshot.latencyMs;
		// 80ms → ~2_500 µlm/CU, 500ms → ~6_500 µlm/CU
		cuPriceMicroLm = Math.round(2500 + Math.max(0, l - 80) * 8.5);
		if (params.risk === "aggr")
			cuPriceMicroLm = Math.round(cuPriceMicroLm * 1.25);
		if (params.risk === "balanced")
			cuPriceMicroLm = Math.round(cuPriceMicroLm * 1.1);
	}
	
	const cuEstimate = params.cuEstimate; // сюда позже подставим по txType

	const buildRecommendationParams: IBuildRecommendationParams = {
		cuPriceMicroLamports: cuPriceMicroLm,
		cuEstimate,
		latencyMs: snapshot.latencyMs,
		risk: params.risk,
		rpc: snapshot.endpoint,
		notes: snapshot.notes ?? [],
		timestamp: Date.now(),
	};

	return buildRecommendation(buildRecommendationParams);

};

export { computeRecommendation };
