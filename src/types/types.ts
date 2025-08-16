export type Risk = 'eco' | 'balanced' | 'aggr' | 'fail';

export interface NetworkSnapshot {
	endpoint: string;
	latencyMs: number;           // измеренная задержка лучшего RPC
	tps?: number;
	slotTimeSec?: number;
	notes?: string[];
	stale?: boolean;
	at: number;                  // Date.now()
	risk?: Risk;
}

export interface Recommendation {
	feeLamports: number;         // итог в лампортах
	feeSOL: number;              // feeLamports / 1e9
	success: number;             // 0..1
	recommendedRpc: string;
	updatedAt: number;           // Date.now()
	notes?: string[];
	stale?: boolean;
}
export interface RpcInfo {
	endpoint: string;
	latencyMs: number;           // измеренная задержка лучшего RPC
	tps?: number;
	slotTimeSec?: number;
	notes?: string[];
	stale?: boolean;
	at: number;                  // Date.now()
	risk: Risk;
}

export interface RpcRecommendation {
	feeLamports: number;         // итог в лампортах
	feeSOL: number;              // feeLamports / 1e9
	success: number;             // 0..1
	recommendedRpc: RpcInfo;
	updatedAt: number;           // Date.now()
	notes?: string[];
	stale?: boolean;
}

export interface IComputeRecommendationParams {
	risk: Risk;
	rpc: RpcProvider;
	cuEstimate: number; // по типу транзакции выберем позже
}

export interface IBuildRecommendationParams {
	cuPriceMicroLamports: number; // цена в микролампортах за единицу вычислительной мощности
	cuEstimate: number;           // оценка вычислительных единиц (CU) для транзакции
	latencyMs: number;           // задержка в миллисекундах
	risk: Risk;                  // риск: 'eco', 'balanced', 'aggr'
	rpc: string;                 // RPC endpoint
	notes?: string[];            // дополнительные заметки
	timestamp?: number;          // время обновления, по умолчанию Date.now()
}

// вычисляет итоговую стоимость в лампортах на основе цены и оценки CU
// cuPriceMicroLamports - цена в микролампортах за единицу вычислительной мощности
// cuEstimate - оценка вычислительных единиц (CU) для транзакции
// возвращает стоимость в лампортах
// (1 лампорт = 1e-9 SOL, 1 микролампорта = 1e-6 лампорта)
// пример: cuPriceMicroLamports = 1000 (1 микролампорта = 0.001 лампорта), cuEstimate = 5000
// итог: 1000 * 5000 / 1e6 = 5 лампортов
// итоговая стоимость в SOL: 5 / 1e9 = 5e-9 SOL

export interface RpcProvider {
	healthProbe(): Promise<NetworkSnapshot>;                    // раз в N сек
	recentPrioritizationFees(): Promise<number[] | null>;       // массив µlamports/CU
}

export interface Cache<K, V> {
	get(key: K): Promise<V | undefined>;
	set(key: K, val: V, ttlMs?: number): Promise<void>;
	del(key: K): Promise<void>;
	ttl?(key: K): Promise<number | null>;
}
  
export interface Clock {
	now(): number;
}
  
export interface Broadcaster<T> {
	publish(topic: string, payload: T): void;
	subscribe(topic: string, onMessage: (payload: T) => void): () => void; // unsubscribe
}

export interface RecoComputer {
	compute(
		risk: Risk,
		snapshot: NetworkSnapshot,
		cuEstimate: number,
		cuPriceMicroLm?: number
	): Recommendation;
}