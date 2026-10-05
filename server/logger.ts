import {inspect} from 'node:util';
import {formatErrorChain, toError} from './errors.ts';
import type LintServer from './server.ts';

/**
 * Writes server diagnostics through the LSP console without trusting values to
 * be JSON-serializable. Logging is a recovery path used while connections are
 * closing and plugins are failing, so neither formatting nor transport errors
 * are allowed to escape into the operation being diagnosed.
 */
export function log(this: LintServer, ...messages: unknown[]): void {
	try {
		const output = messages.map(message => {
			if (typeof message === 'string') {
				return message;
			}

			try {
				return inspect(message, {depth: 5});
			} catch {
				return '[Uninspectable value]';
			}
		}).join(' ');

		this.connection.console.log(`[server] ${output}`);
	} catch {}
}

/**
 * Records an unknown thrown value with optional operation context and its full
 * cycle-safe cause chain. Normalization is centralized here so every caller can
 * accept JavaScript's unrestricted thrown values without losing diagnostics.
 */
export function logError(this: LintServer, error: unknown, context?: string): void {
	try {
		this.log([context, formatErrorChain(toError(error))].filter(Boolean).join('\n'));
	} catch {}
}
