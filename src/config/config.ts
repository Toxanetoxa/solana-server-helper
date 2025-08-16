import "dotenv/config";

const config = {
	port: parseInt(process.env.PORT || "8787", 10),
	wsIntervalMs: parseInt(process.env.WS_BROADCAST_INTERVAL_MS || "8000", 10),
	endpoints: (process.env.RPC_ENDPOINTS || "https://api.mainnet-beta.solana.com")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean),
};

export { config }