import type LintServer from './server';

/**
 * log a message to the client console
 * in a console.log type of way - primarily used
 * for development and debugging
 */
export function log(this: LintServer, ...messages: unknown[]): void {
	const d = new Date();
	const ts = `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}:${d.getMilliseconds()}`;

	this.connection.console.log(
		// eslint-disable-next-line unicorn/no-array-reduce
		messages.reduce((acc: string, message: unknown) => {
			if (message instanceof Map)
				message = `Map(${JSON.stringify([...message.entries()], null, 2)})`;
			if (typeof message === 'object') message = JSON.stringify(message, null, 2);
			// eslint-disable-next-line unicorn/prefer-spread
			return acc.concat(`${message as string} `);
		}, `[${ts}] `)
	);
}

export function logError(this: LintServer, error: Error): void {
	this.log(error?.message ?? 'Unknown Error');
	this.log(error?.stack);
}
