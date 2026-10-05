import {
	describe,
	test,
	type TestContext,
} from 'node:test';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {
	CodeActionKind,
	Diagnostic,
	LSPErrorCodes,
	Position,
	ResponseError,
	CancellationTokenSource,
} from 'vscode-languageserver/node';
import Server from '../../server/server.ts';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

/**
 * Creates a server with one in-memory open document and disposes its stream
 * connection after the current test. Real queue behavior remains intact so
 * request-settlement regressions cannot be hidden by a queue mock.
 */
function createServer(t: TestContext): {
	server: Server;
	document: TextDocument;
	documents: Map<string, TextDocument>;
	notifications: {count: number};
} {
	const document = TextDocument.create('file:///workspace/example.js', 'javascript', 1, 'const x = 1;');
	const documents = new Map([[document.uri, document]]);
	const server = new Server({isTest: true});
	Object.defineProperty(server, 'documents', {value: documents});
	const notifications = {count: 0};
	t.mock.method(server.connection.window, 'showErrorMessage', () => {
		notifications.count++;
	});
	t.mock.method(server, 'log', noop);
	t.after(async () => {
		await server.handleShutdown();
		server.connection.dispose();
	});
	return {
		server,
		document,
		documents,
		notifications,
	};
}

/**
 * Fails quickly when a queued LSP operation accidentally leaves its outer
 * promise unresolved. The short timeout is sufficient because all test work is
 * in-memory and the queue starts synchronously.
 */
async function settles<T>(promise: Promise<T>): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_resolve, reject) => {
			setTimeout(() => {
				reject(new Error('LSP request did not settle'));
			}, 250);
		}),
	]);
}

describe('Server error handling', () => {
	test('clears stale lint state and deduplicates notifications', async (t: TestContext) => {
		const {server, document, notifications} = createServer(t);
		server.documentFixCache.set(document.uri, new Map());
		server.documentSuggestionsCache.set(document.uri, new Map());
		t.mock.method(server, 'getDocumentConfig', async () => ({enable: true}));
		t.mock.method(server, 'getLintResults', async () => {
			throw new Error('Error resolving XO config', {cause: new SyntaxError('Unexpected token')});
		});
		const sendDiagnostics = t.mock.method(server.connection, 'sendDiagnostics', noop);
		const logError = t.mock.method(server, 'logError', noop);

		await server.lintDocument(document);
		await server.lintDocument(document);

		t.assert.strictEqual(server.documentFixCache.has(document.uri), false);
		t.assert.strictEqual(server.documentSuggestionsCache.has(document.uri), false);
		t.assert.strictEqual(sendDiagnostics.mock.callCount(), 2);
		t.assert.deepStrictEqual(sendDiagnostics.mock.calls[0].arguments[0]?.diagnostics, []);
		t.assert.strictEqual(notifications.count, 1);
		t.assert.strictEqual(logError.mock.callCount(), 2);
	});

	test('preserves the original lint failure when diagnostic cleanup fails', async (t: TestContext) => {
		const {server, document} = createServer(t);
		t.mock.method(server, 'getDocumentConfig', async () => ({enable: true}));
		t.mock.method(server, 'getLintResults', async () => {
			// eslint-disable-next-line @typescript-eslint/only-throw-error -- JavaScript plugins may throw any value.
			throw 'plugin failed';
		});
		t.mock.method(server.connection, 'sendDiagnostics', async () => {
			throw new Error('connection closed');
		});
		const logError = t.mock.method(server, 'logError', noop);

		await server.lintDocument(document);

		t.assert.strictEqual(logError.mock.callCount(), 2);
		t.assert.strictEqual(String(logError.mock.calls[1].arguments[0]), 'Error: plugin failed');
	});

	test('formatting settles closed, cancelled, stale, and unknown-error requests', async (t: TestContext) => {
		const {server, document, documents} = createServer(t);
		const parameters = {
			textDocument: {uri: document.uri},
			options: {tabSize: 2, insertSpaces: true},
		};
		const activeCancellation = new CancellationTokenSource();
		const cancelledCancellation = new CancellationTokenSource();
		cancelledCancellation.cancel();
		const activeToken = activeCancellation.token;
		const cancelledToken = cancelledCancellation.token;
		const logError = t.mock.method(server, 'logError', noop);

		documents.delete(document.uri);
		t.assert.deepStrictEqual(
			await settles(server.handleDocumentFormattingRequest(parameters, activeToken)),
			[],
		);
		documents.set(document.uri, document);

		await t.assert.rejects(
			settles(server.handleDocumentFormattingRequest(parameters, cancelledToken)),
			(error: unknown) => error instanceof ResponseError
				&& error.code === LSPErrorCodes.RequestCancelled,
		);
		t.assert.strictEqual(logError.mock.callCount(), 0);

		t.mock.method(server, 'getDocumentConfig', async () => ({enable: true, format: {enable: true}}));
		const formatting = t.mock.method(server, 'getDocumentFormatting', async () => ({
			documentVersion: 2,
			edits: [],
		}));
		await t.assert.rejects(
			settles(server.handleDocumentFormattingRequest(parameters, activeToken)),
			(error: unknown) => error instanceof ResponseError
				&& error.code === LSPErrorCodes.ContentModified,
		);
		t.assert.strictEqual(logError.mock.callCount(), 0);

		formatting.mock.mockImplementation(async () => {
			// eslint-disable-next-line @typescript-eslint/only-throw-error -- JavaScript plugins may throw any value.
			throw {plugin: 'failed'};
		});
		await t.assert.rejects(
			settles(server.handleDocumentFormattingRequest(parameters, activeToken)),
			/XO could not format this document/v,
		);
		t.assert.strictEqual(logError.mock.callCount(), 1);
	});

	test('all-fixes settles unknown thrown values', async (t: TestContext) => {
		const {server, document} = createServer(t);
		t.mock.method(server, 'getDocumentFormatting', async () => {
			// eslint-disable-next-line @typescript-eslint/only-throw-error -- JavaScript plugins may throw any value.
			throw null;
		});

		await t.assert.rejects(
			settles(server.handleAllFixesRequest({textDocument: {uri: document.uri}})),
			/XO could not calculate fixes/v,
		);
	});

	test('code-action calculation reports failure and returns no actions', async (t: TestContext) => {
		const {server, document} = createServer(t);
		t.mock.method(server, 'getDocumentConfig', async () => ({enable: true}));
		t.mock.method(server, 'getDocumentFormatting', async () => {
			throw new Error('plugin failed');
		});
		const range = {start: Position.create(0, 0), end: Position.create(0, 1)};

		const actions = await settles(server.handleCodeActionRequest({
			textDocument: {uri: document.uri},
			range,
			context: {
				diagnostics: [Diagnostic.create(range, 'failure')],
				only: [CodeActionKind.SourceFixAll],
			},
		}));

		t.assert.deepStrictEqual(actions, []);
	});
});
