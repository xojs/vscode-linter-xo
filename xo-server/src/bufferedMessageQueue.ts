// copied from https://github.com/Microsoft/vscode-eslint/blob/ad394e3eabfa89c78c38904d71d9aebf64b7edfa/server/src/server.ts

import {
	CancellationToken,
	RequestHandler,
	NotificationHandler,
	IConnection,
	RequestType,
	NotificationType,
	ResponseError,
	ErrorCodes
} from 'vscode-languageserver';

interface Request<P, R> {
	method: string;
	params: P;
	documentVersion: number | undefined;
	resolve: (value: R | Thenable<R>) => void | undefined;
	reject: (error: any) => void | undefined;
	token: CancellationToken | undefined;
}

namespace Request {
	export function is(value: any): value is Request<any, any> {
		let candidate: Request<any, any> = value;
		return candidate && !!candidate.token && !!candidate.resolve && !!candidate.reject;
	}
}

interface Notifcation<P> {
	method: string;
	params: P;
	documentVersion: number;
}

type Message<P, R> = Notifcation<P> | Request<P, R>;

interface VersionProvider<P> {
	(params: P): number;
}

namespace Thenable {
	export function is<T>(value: any): value is Thenable<T> {
		let candidate: Thenable<T> = value;
		return candidate && typeof candidate.then === 'function';
	}
}

export default class BufferedMessageQueue {

		private queue: Message<any, any>[];
		private requestHandlers: Map<string, {handler: RequestHandler<any, any, any>, versionProvider?: VersionProvider<any>}>;
		private notificationHandlers: Map<string, {handler: NotificationHandler<any>, versionProvider?: VersionProvider<any>}>;
		private timer: NodeJS.Timer | undefined;

		constructor(private connection: IConnection) {
			this.queue = [];
			this.requestHandlers = new Map();
			this.notificationHandlers = new Map();
		}

		public registerRequest<P, R, E, RO>(type: RequestType<P, R, E, RO>, handler: RequestHandler<P, R, E>, versionProvider?: VersionProvider<P>): void {
			this.connection.onRequest(type, (params, token) => {
				return new Promise<R>((resolve, reject) => {
					this.queue.push({
						method: type.method,
						params: params,
						documentVersion: versionProvider ? versionProvider(params) : undefined,
						resolve: resolve,
						reject: reject,
						token: token
					});
					this.trigger();
				});
			});
			this.requestHandlers.set(type.method, { handler, versionProvider });
		}

		public registerNotification<P, RO>(type: NotificationType<P, RO>, handler: NotificationHandler<P>, versionProvider?: (params: P) => number): void {
			this.connection.onNotification(type, (params) => {
				this.queue.push({
					method: type.method,
					params: params,
					documentVersion: versionProvider ? versionProvider(params) : undefined,
				});
				this.trigger();
			});
			this.notificationHandlers.set(type.method, { handler, versionProvider });
		}

		public addNotificationMessage<P, RO>(type: NotificationType<P, RO>, params: P, version: number) {
			this.queue.push({
				method: type.method,
				params,
				documentVersion: version
			});
			this.trigger();
		}

		public onNotification<P, RO>(type: NotificationType<P, RO>, handler: NotificationHandler<P>, versionProvider?: (params: P) => number): void {
			this.notificationHandlers.set(type.method, { handler, versionProvider });
		}

		private trigger(): void {
			if (this.timer || this.queue.length === 0) {
				return;
			}
			this.timer = setImmediate(() => {
				this.timer = undefined;
				this.processQueue();
			});
		}

		private processQueue(): void {
			let message = this.queue.shift();
			if (!message) {
				return;
			}
			if (Request.is(message)) {
				let requestMessage = message;
				if (requestMessage.token.isCancellationRequested) {
					requestMessage.reject(new ResponseError(ErrorCodes.RequestCancelled, 'Request got cancelled'));
					return;
				}
				let elem = this.requestHandlers.get(requestMessage.method);
				if (elem.versionProvider && requestMessage.documentVersion !== void 0 && requestMessage.documentVersion !== elem.versionProvider(requestMessage.params)) {
					requestMessage.reject(new ResponseError(ErrorCodes.RequestCancelled, 'Request got cancelled'));
					return;
				}
				let result = elem.handler(requestMessage.params, requestMessage.token);
				if (Thenable.is(result)) {
					result.then((value) => {
						requestMessage.resolve(value);
					}, (error) => {
						requestMessage.reject(error);
					});
				} else {
					requestMessage.resolve(result);
				}
			} else {
				let notificationMessage = message;
				let elem = this.notificationHandlers.get(notificationMessage.method);
				if (elem.versionProvider && notificationMessage.documentVersion !== void 0 && notificationMessage.documentVersion !== elem.versionProvider(notificationMessage.params)) {
					return;
				}
				elem.handler(notificationMessage.params);
			}
			this.trigger();
		}
	}
