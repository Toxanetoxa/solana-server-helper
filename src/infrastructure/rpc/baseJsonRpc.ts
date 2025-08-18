async function postJson<T>(
	url: string,
	body: unknown,
	headers?: Record<string, string>,
	timeoutMs = 1500,
): Promise<{ ok: boolean; status: number; json?: T; text?: string }> {
	const ctrl = new AbortController();
	const t = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json", ...(headers || {}) },
			body: JSON.stringify(body),
			signal: ctrl.signal,
		});
		if (!res.ok) {
			return { ok: false, status: res.status, text: await res.text() };
		}
		const json = (await res.json()) as T;
		return { ok: true, status: res.status, json };
	} catch (e: unknown) {
		    const message = e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
			return { ok: false, status: 0, text: message };
	} finally {
		clearTimeout(t);
	}
}

export { postJson };