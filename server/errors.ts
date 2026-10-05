import {inspect} from 'node:util';
import {LSPErrorCodes, ResponseError} from 'vscode-languageserver/node';

export type ErrorCategory = 'xo' | 'internal';

/**
 * Converts JavaScript's unrestricted thrown values into an Error at the shared
 * server boundary. Existing errors retain their identity and metadata, while
 * object inspection is deliberately bounded and cycle-safe so reporting a
 * plugin failure cannot become a second failure.
 */
export function toError(value: unknown): Error {
	if (value instanceof Error) {
		return value;
	}

	try {
		if (typeof value === 'string') {
			return new Error(value);
		}

		if (
			typeof value === 'number'
			|| typeof value === 'boolean'
			|| typeof value === 'bigint'
			|| typeof value === 'symbol'
			|| value === undefined
		) {
			return new Error(String(value));
		}

		return new Error(inspect(value, {depth: 5}));
	} catch {
		return new Error('Unknown error');
	}
}

/**
 * Produces output-channel detail for an error and every available cause. Cause
 * identities are tracked because Error.cause is user-controlled and can form a
 * cycle. A native stack already starts with the name and message, so no second
 * copy of that header is added.
 */
export function formatErrorChain(error: Error): string {
	try {
		const sections: string[] = [];
		const visited = new Set<unknown>();
		let current: unknown = error;
		let isCause = false;

		while (current !== undefined && !visited.has(current)) {
			visited.add(current);
			const normalized = toError(current);
			const name = normalized.name === '' ? 'Error' : normalized.name;
			const header = `${name}: ${normalized.message}`;
			const stack = normalized.stack?.trim();
			let detail = header;
			if (stack !== undefined && stack !== '') {
				detail = stack.split('\n', 1)[0] === header ? stack : `${header}\n${stack}`;
			}

			sections.push(`${isCause ? 'Caused by: ' : ''}${detail}`);
			current = normalized.cause;
			isCause = true;
		}

		if (current !== undefined) {
			sections.push('Caused by: [Circular error cause]');
		}

		return sections.join('\n');
	} catch {
		return 'Error: Unable to format error details';
	}
}

/**
 * Recognizes protocol responses that represent normal editor control flow.
 * Classification uses the typed numeric LSP code rather than message text, so
 * unrelated failures containing words such as "cancelled" are not hidden.
 */
export function isExpectedLspError(error: Error): boolean {
	return error instanceof ResponseError
		&& (error.code === LSPErrorCodes.RequestCancelled
			|| error.code === LSPErrorCodes.ContentModified);
}

/**
 * Selects short user-facing text while leaving stacks and nested causes in the
 * output channel. Message inspection is limited to actionable XO distinctions;
 * expected LSP control flow is classified separately by numeric response code.
 */
export function getXoErrorSummary(error: Error): string {
	const messages: string[] = [];
	const visited = new Set<unknown>();
	let current: unknown = error;

	while (current !== undefined && !visited.has(current)) {
		visited.add(current);
		const normalized = toError(current);
		messages.push(normalized.message);
		current = normalized.cause;
	}

	const detail = messages.join(' ');
	if (/\bconfig(?:uration)?\b/iv.test(detail)) {
		return 'XO could not load the configuration for this workspace. See the XO output for details.';
	}

	return /failed to resolve module|cannot find (?:module|package)|linttext method/iv.test(detail)
		? 'XO could not be loaded for this workspace. See the XO output for details.'
		: 'XO could not process this workspace. See the XO output for details.';
}

/**
 * Builds a stable notification key from user-meaningful error information.
 * Document paths are intentionally excluded: one project-wide configuration
 * failure commonly reaches every open document. The known workspace root is
 * retained so independent multi-root failures can each be reported once.
 */
export function getErrorFingerprint(
	category: ErrorCategory,
	workspace: string | undefined,
	error: Error,
): string {
	const messages: string[] = [];
	const visited = new Set<unknown>();
	let current: unknown = error;

	while (current !== undefined && !visited.has(current)) {
		visited.add(current);
		const normalized = toError(current);
		messages.push(`${normalized.name}:${normalized.message}`);
		current = normalized.cause;
	}

	return JSON.stringify([category, workspace ?? '', messages]);
}
