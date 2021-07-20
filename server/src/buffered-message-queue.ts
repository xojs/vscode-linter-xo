/*!
 * Copied from https://github.com/microsoft/vscode-eslint/blob/release/2.1.10/server/src/eslintServer.ts
 * The original code is licensed under the MIT License.
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * https://github.com/microsoft/vscode-eslint/blob/release/2.1.10/License.txt
 */

import {
	CancellationToken,
	RequestHandler,
	NotificationHandler,
	Connection,
	RequestType,
	NotificationType,
	ResponseError,
	LSPErrorCodes,
} from 'vscode-languageserver';

interface Request<P, R> {
	method: string;
	params: P;
	documentVersion: number | undefined;
	resolve: (value: R | Promise<R>) => void | undefined;
	reject: (error: any) => void | undefined;
	token: CancellationToken;
}

namespace Request {
	export function is(value: any): value is Request<any, any> {
		const candidate: Request<any, any> = value;
		// eslint-disable-next-line
		return candidate && candidate.token !== undefined && candidate.resolve !== undefined && candidate.reject !== undefined;
	}
}

interface Notification<P> {
	method: string;
	params: P;
	documentVersion: number | undefined;
}

type Message<P, R> = Notification<P> | Request<P, R>;

interface VersionProvider<P> {
	// eslint-disable-next-line
	(params: P): number | undefined;
}

namespace Thenable {
	export function is<T>(value: any): value is Thenable<T> {
		const candidate: Thenable<T> = value;
		// eslint-disable-next-line
		return candidate && typeof candidate.then === 'function';
	}
}

export default class BufferedMessageQueue {
	private readonly queue: Array<Message<any, any>>;
	// eslint-disable-next-line
	private readonly requestHandlers: Map<string, {handler: RequestHandler<any, any, any>, versionProvider?: VersionProvider<any>}>;
	// eslint-disable-next-line
	private readonly notificationHandlers: Map<string, {handler: NotificationHandler<any>, versionProvider?: VersionProvider<any>}>;
	private timer: NodeJS.Immediate | undefined;

	constructor(private readonly connection: Connection) {
		this.queue = [];
		this.requestHandlers = new Map();
		this.notificationHandlers = new Map();
	}

	public registerRequest<P, R, E>(type: RequestType<P, R, E>, handler: RequestHandler<P, R, E>, versionProvider?: VersionProvider<P>): void {
		this.connection.onRequest(type, async (params, token) => new Promise<R>((resolve, reject) => {
			this.queue.push({
				method: type.method,
				params,
				documentVersion: versionProvider ? versionProvider(params) : undefined,
				resolve,
				reject,
				token,
			});
			this.trigger();
		}));
		this.requestHandlers.set(type.method, {handler, versionProvider});
	}

	public registerNotification<P>(type: NotificationType<P>, handler: NotificationHandler<P>, versionProvider?: (params: P) => number): void {
		this.connection.onNotification(type, params => {
			this.queue.push({
				method: type.method,
				params,
				documentVersion: versionProvider ? versionProvider(params) : undefined,
			});
			this.trigger();
		});
		this.notificationHandlers.set(type.method, {handler, versionProvider});
	}

	public addNotificationMessage<P>(type: NotificationType<P>, params: P, version: number) {
		this.queue.push({
			method: type.method,
			params,
			documentVersion: version,
		});
		this.trigger();
	}

	public onNotification<P>(type: NotificationType<P>, handler: NotificationHandler<P>, versionProvider?: (params: P) => number): void {
		this.notificationHandlers.set(type.method, {handler, versionProvider});
	}

	private trigger(): void {
		if (this.timer || this.queue.length === 0) {
			return;
		}

		this.timer = setImmediate(() => {
			this.timer = undefined;
			this.processQueue();
			this.trigger();
		});
	}

	private processQueue(): void {
		const message = this.queue.shift();
		if (!message) {
			return;
		}

		if (Request.is(message)) {
			const requestMessage = message;
			if (requestMessage.token.isCancellationRequested) {
				requestMessage.reject(new ResponseError(LSPErrorCodes.RequestCancelled, 'Request got cancelled'));
				return;
			}

			const elem = this.requestHandlers.get(requestMessage.method);
			if (elem === undefined) {
				throw new Error('No handler registered');
			}

			if (elem.versionProvider && requestMessage.documentVersion !== undefined && requestMessage.documentVersion !== elem.versionProvider(requestMessage.params)) {
				requestMessage.reject(new ResponseError(LSPErrorCodes.RequestCancelled, 'Request got cancelled'));
				return;
			}

			const result = elem.handler(requestMessage.params, requestMessage.token);
			if (Thenable.is(result)) {
				result.then(value => {
					requestMessage.resolve(value);
				}, error => {
					requestMessage.reject(error);
				});
			} else {
				requestMessage.resolve(result);
			}
		} else {
			const notificationMessage = message;
			const elem = this.notificationHandlers.get(notificationMessage.method);
			if (elem === undefined) {
				throw new Error('No handler registered');
			}

			if (elem.versionProvider && notificationMessage.documentVersion !== undefined && notificationMessage.documentVersion !== elem.versionProvider(notificationMessage.params)) {
				return;
			}

			elem.handler(notificationMessage.params);
		}
	}
}
