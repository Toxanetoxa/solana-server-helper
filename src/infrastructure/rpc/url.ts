function normalizeEndpoint(url: string): string {
	let s = url.trim();
	// убираем кавычки/пробелы + валидируем
	try {
		s = new URL(s).toString();
	} catch {
		throw new Error(`Invalid URL: ${s}`);
	}
	// убираем trailing slash у https://.../
	if (s.endsWith("/")) s = s.slice(0, -1);
	return s;
}

export { normalizeEndpoint };