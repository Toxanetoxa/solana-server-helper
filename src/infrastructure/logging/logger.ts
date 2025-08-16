export const log = {
	info: (...a: unknown[]) => console.log("[info]", ...a),
	warn: (...a: unknown[]) => console.warn("[warn]", ...a),
	error: (...a: unknown[]) => console.error("[error]", ...a),
};
