export type AppErrorKind = "rpc" | "redis" | "ws" | "unknown";

interface AppErrorOptions {
	cause?: unknown;
}

export class AppError extends Error {
	readonly cause?: unknown;
	readonly kind: AppErrorKind;

	constructor(kind: AppErrorKind, message: string, options: AppErrorOptions = {}) {
		super(message);
		this.name = new.target.name;
		this.kind = kind;
		this.cause = options.cause;
		Error.captureStackTrace?.(this, new.target);
	}
}

export class RpcError extends AppError {
	constructor(message: string, options: AppErrorOptions = {}) {
		super("rpc", message, options);
	}
}

export class RedisError extends AppError {
	constructor(message: string, options: AppErrorOptions = {}) {
		super("redis", message, options);
	}
}

export class WsError extends AppError {
	constructor(message: string, options: AppErrorOptions = {}) {
		super("ws", message, options);
	}
}

export function isAppError(error: unknown): error is AppError {
	return error instanceof AppError;
}
