import { WebSocketServer, type WebSocket } from "ws";
import type { Recommendation, Risk } from "../../types/types.js";

type ClientState = { ws: WebSocket; risk: Risk; lastSentAt?: number };

class WsGateway {
	private wss: WebSocketServer;
	private clients = new Set<ClientState>();
	private closing = false;

	constructor(readonly port: number) {
		this.wss = new WebSocketServer({ port });
		this.wss.on("connection", (ws) => this.handle(ws));
		console.log(`[ws] listening on :${port}`);
	}

	private handle(ws: WebSocket) {
		const state: ClientState = { ws, risk: "balanced" };
		this.clients.add(state);

		ws.on("message", (raw) => {
			try {
				const msg = JSON.parse(raw.toString());
				if (msg?.type === "set_mode") {
					const r = String(msg?.risk);
					if (r === "eco" || r === "balanced" || r === "aggr") state.risk = r;
				}
			} catch {
				/* ignore */
			}
		});

		ws.on("close", () => this.clients.delete(state));
		ws.on("error", () => this.clients.delete(state));
	}

	broadcast(recos: Record<Risk, Recommendation>) {
		const payloads: Partial<Record<Risk, string>> = {};
		const enc = (r: Risk) =>
			(payloads[r] ??= JSON.stringify({
				mode: r,
				cuPrice: recos[r].cuPriceMicroLamports,
				cuEstimate: recos[r].cuEstimate,
				priorityFeeLamports: recos[r].feeLamports,
				successScore: recos[r].success,
				recommendedRpc: recos[r].recommendedRpc,
				updatedAt: new Date(recos[r].updatedAt).toISOString(),
				notes: recos[r].notes,
			}));
		for (const c of this.clients) {
			if (c.ws.readyState !== c.ws.OPEN) continue;
			try {
				c.ws.send(enc(c.risk));
				c.lastSentAt = Date.now();
			} catch (error) {
				console.error("[ws] send error:", error);
			}
		}
	}

	/**
	 * Закрывает все соединения и сам сервер.
	 * @param options.code   — код закрытия (по умолчанию 1001 — Going Away)
	 * @param options.reason — причина закрытия
	 * @param options.timeout — сколько ждать до форс-термината (мс)
	 */
	async close(options: { code?: number; reason?: string; timeout?: number } = {}): Promise<void> {
		const { code = 1001, reason = "Server shutdown", timeout = 2000 } = options;
		if (this.closing) return;
		this.closing = true;

		// 1) Попросим всех клиентов закрыться
		const waitSocketClose = (ws: WebSocket) =>
			new Promise<void>((resolve) => {
				if (ws.readyState === ws.CLOSED) return resolve();

				const timer = setTimeout(() => {
					// если не успели закрыться — форс-килим
					try {
						ws.terminate();
					} catch {
						// если не удалось форс-терминатить — просто игнорируем
						console.error("[ws] terminate error:", ws);
					}
					resolve();
				}, timeout);

				const done = () => {
					clearTimeout(timer);
					resolve();
				};
				ws.once("close", done);
				ws.once("error", done);
			});

		for (const c of this.clients) {
			try {
				c.ws.close(code, reason);
			} catch {
				// если не удалось закрыть — просто игнорируем
				console.error("[ws] close error:", c.ws);
			}
		}

		// 2) Ждём закрытия (или форсим по таймауту)
		await Promise.allSettled([...this.clients].map(({ ws }) => waitSocketClose(ws)));

		// 3) Закрываем сам сервер (перестаёт принимать новые коннекты)
		await new Promise<void>((resolve, reject) => {
			this.wss.close((err?: Error) => (err ? reject(err) : resolve()));
		});

		this.clients.clear();
	}
}

export { WsGateway };
