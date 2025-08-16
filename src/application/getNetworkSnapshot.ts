import type { RpcProvider, NetworkSnapshot } from '../types/types.js';

const getNetworkSnapshot = async (rpc: RpcProvider): Promise<NetworkSnapshot> => {
	return await rpc.healthProbe();
}

export { getNetworkSnapshot };

// This function retrieves the current state of the network by calling the health probe of the provided RPC provider.
// It returns a promise that resolves to a NetworkSnapshot object containing details about the network's latency, endpoint, and other relevant information.