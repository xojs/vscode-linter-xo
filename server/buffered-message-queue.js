const node = require('vscode-languageserver/node');

const Request = {
	is(value) {
		const candidate = value;
		return (
			candidate &&
			Boolean(candidate.token) &&
			Boolean(candidate.resolve) &&
			Boolean(candidate.reject)
		);
	}
};

const Thenable = {
	is(value) {
		const candidate = value;
		return (
			typeof (candidate === null || candidate === undefined
				? undefined
				: // eslint-disable-next-line promise/prefer-await-to-then
				  candidate.then) === 'function'
		);
	}
};

class BufferedMessageQueue {
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

	addNotificationMessage(type, parameters, version) {
		this.queue.push({
			method: type.method,
			params: parameters,
			documentVersion: version
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

		if (Request.is(message)) {
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
			if (Thenable.is(result)) {
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
			const element = this.notificationHandlers.get(notificationMessage.method);

			if (element === undefined) {
				throw new Error(`No handler registered`);
			}

			if (
				element.versionProvider &&
				(notificationMessage === null || notificationMessage === undefined
					? undefined
					: notificationMessage.documentVersion) !==
					element.versionProvider(notificationMessage.params)
			)
				return;

			element.handler(notificationMessage.params);
		}

		this.trigger();
	}
}

module.exports = BufferedMessageQueue;
