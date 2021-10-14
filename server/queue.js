const node = require('vscode-languageserver/node');

class Queue {
	constructor(connection) {
		this.connection = connection;
		this.queue = [];
		this.requestHandlers = new Map();
		this.notificationHandlers = new Map();
	}

	registerRequest(type, handler, versionProvider) {
		this.connection.onRequest(
			type,
			async (parameters, token) =>
				new Promise((resolve, reject) => {
					this.queue.push({
						method: type.method,
						params: parameters,
						documentVersion: versionProvider
							? versionProvider(parameters)
							: undefined,
						resolve,
						reject,
						token
					});
					this.trigger();
				})
		);
		this.requestHandlers.set(type.method, {handler, versionProvider});
	}

	registerNotification(type, handler, versionProvider) {
		this.connection.onNotification(type, (parameters) => {
			this.queue.push({
				method: type.method,
				params: parameters,
				documentVersion: versionProvider
					? versionProvider(parameters)
					: undefined
			});
			this.trigger();
		});
		this.notificationHandlers.set(type.method, {handler, versionProvider});
	}

	addNotificationMessage(type, parameters, version, flush) {
		this.queue.push({
			method: type.method,
			params: parameters,
			documentVersion: version,
			flush
		});
		this.trigger();
	}

	onNotification(type, handler, versionProvider) {
		this.notificationHandlers.set(type.method, {handler, versionProvider});
	}

	trigger() {
		if (this.timer || this.queue.length === 0) {
			return;
		}

		this.timer = setImmediate(() => {
			this.timer = undefined;
			this.processQueue();
			this.trigger();
		});
	}

	processQueue() {
		const message = this.queue.shift();

		if (!message) return;

		if (
			message &&
			Boolean(message.token) &&
			Boolean(message.resolve) &&
			Boolean(message.reject)
		) {
			const requestMessage = message;
			if (requestMessage.token.isCancellationRequested) {
				requestMessage.reject(
					new node.ResponseError(
						node.LSPErrorCodes.RequestCancelled,
						'Request got cancelled'
					)
				);
				return;
			}

			const element = this.requestHandlers.get(requestMessage.method);

			if (
				element.versionProvider &&
				(requestMessage === null || requestMessage === undefined
					? undefined
					: requestMessage.documentVersion) !==
					element.versionProvider(requestMessage.params)
			) {
				requestMessage.reject(
					new node.ResponseError(
						node.ErrorCodes.InvalidRequest,
						'Request got cancelled'
					)
				);
				return;
			}

			const result = element.handler(
				requestMessage.params,
				requestMessage.token
			);
			// eslint-disable-next-line promise/prefer-await-to-then
			if (typeof result?.then === 'function') {
				// eslint-disable-next-line promise/prefer-await-to-then
				result.then(
					(value) => {
						requestMessage.resolve(value);
					},
					(error) => {
						requestMessage.reject(error);
					}
				);
			} else {
				requestMessage.resolve(result);
			}
		} else {
			const notificationMessage = message;
			const handler = this.notificationHandlers.get(notificationMessage.method);

			if (handler === undefined) {
				throw new Error(`No handler registered`);
			}

			if (
				handler.versionProvider &&
				(notificationMessage === null || notificationMessage === undefined
					? undefined
					: notificationMessage.documentVersion) !==
					handler.versionProvider(notificationMessage.params)
			)
				return;

			handler.handler(notificationMessage.params);
			if (
				notificationMessage.flush &&
				typeof handler.handler.flush === 'function'
			)
				handler.handler.flush();
		}

		this.trigger();
	}
}

module.exports = Queue;
