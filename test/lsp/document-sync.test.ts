import {
	after,
	beforeEach,
	describe,
	test,
	type Mock,
	type TestContext,
} from 'node:test';
import {TextDocument} from 'vscode-languageserver-textdocument';
import type {Connection} from 'vscode-languageserver';
import Server from '../../server/server.ts';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

type DocumentSyncTestServer = Omit<
	Server,
	'lintDocument' | 'documents' | 'connection' | 'log' | 'getDocumentConfig'
> & {
	lintDocument: Mock<Server['lintDocument']>;
	log: Mock<Server['log']>;
	documents: Map<string, TextDocument> & {all?: typeof Map.prototype.values};
	getDocumentConfig: Mock<Server['getDocumentConfig']>;
	connection: Omit<Connection, 'sendDiagnostics'> & {
		sendDiagnostics: Mock<Connection['sendDiagnostics']>;
	};
};

describe('Server documents syncing', () => {
	const documents: Map<string, TextDocument> & {all?: typeof Map.prototype.values} = new Map([
		['uri', TextDocument.create('uri', 'javascript', 1, 'content')],
		['uri/node_modules', TextDocument.create('uri/node_modules', 'javascript', 1, 'content')],
	]);
	documents.all = documents.values;

	// @ts-expect-error The test fixture intentionally replaces readonly server dependencies with mocks.
	const server: DocumentSyncTestServer = new Server({isTest: true});
	Object.defineProperties(server, {
		documents: {value: documents},
		log: {value: noop, writable: true},
	});

	/**
	 * Gives each test fresh context-owned mocks while reusing the suite's LSP
	 * connection, which avoids accumulating stream listeners between tests.
	 */
	beforeEach(context => {
		const t = context as TestContext;
		t.mock.method(server, 'log', noop);
		t.mock.method(server, 'lintDocument', noop);
		t.mock.method(server, 'getDocumentConfig', async () => ({enable: true}));
		t.mock.method(server.connection, 'sendDiagnostics', noop);
	});

	/**
	 * Shuts down the shared queue and connection after every test in this file
	 * has completed so no LSP resources remain active after the suite exits.
	 */
	after(async () => {
		await server.handleShutdown();
		server.connection.dispose();
	});

	test('Server.handleDocumentsOnDidChangeContent is a function', (t: TestContext) => {
		t.assert.strictEqual(typeof server.handleDocumentsOnDidChangeContent, 'function');
	});

	test('Server.handleDocumentsOnDidChangeContent calls lintDocument', async (t: TestContext) => {
		server.handleDocumentsOnDidChangeContent({
			document: TextDocument.create('uri', 'javascript', 1, 'content'),
		});
		await new Promise(resolve => {
			server.queue.once('end', () => {
				resolve(undefined);
			});
		});
		t.assert.strictEqual(server.getDocumentConfig.mock.callCount(), 1);
		t.assert.strictEqual(server.lintDocument.mock.callCount(), 1);
	});

	test('Server.handleDocumentsOnDidChangeContent does not lint document if version is mismatched', async (t: TestContext) => {
		server.handleDocumentsOnDidChangeContent({
			document: TextDocument.create('uri', 'javascript', 2, 'content'),
		});
		await new Promise(resolve => {
			server.queue.once('end', () => {
				resolve(undefined);
			});
		});
		t.assert.strictEqual(server.lintDocument.mock.callCount(), 0);
	});

	test('Server.handleDocumentsOnDidChangeContent does not lint document if document is in node_modules and logs message', async (t: TestContext) => {
		server.handleDocumentsOnDidChangeContent({
			document: TextDocument.create('uri/node_modules', 'javascript', 1, 'content'),
		});
		await new Promise(resolve => {
			server.queue.once('end', () => {
				resolve(undefined);
			});
		});
		t.assert.strictEqual(server.log.mock.callCount(), 1);
		t.assert.strictEqual(server.log.mock.calls[0].arguments[0], 'skipping node_modules file');
		t.assert.strictEqual(server.lintDocument.mock.callCount(), 0);
	});

	test('Server.handleDocumentsOnDidClose sends empty diagnostics for closed file', async (t: TestContext) => {
		await server.handleDocumentsOnDidClose({
			document: TextDocument.create('uri', 'javascript', 1, 'content'),
		});
		t.assert.strictEqual(server.connection.sendDiagnostics.mock.callCount(), 1);
		t.assert.deepStrictEqual(server.connection.sendDiagnostics.mock.calls[0].arguments[0], {
			uri: 'uri',
			diagnostics: [],
		});
	});

	test('Server.handleDocumentOnDidChangeContent does not send diagnostics if xo is disabled', async (t: TestContext) => {
		t.mock.method(server, 'getDocumentConfig', async () => ({enable: false}));
		server.handleDocumentsOnDidChangeContent({
			document: TextDocument.create('uri', 'javascript', 1, 'content'),
		});
		await new Promise(resolve => {
			server.queue.once('end', () => {
				resolve(undefined);
			});
		});
		t.assert.strictEqual(server.getDocumentConfig.mock.callCount(), 1);
		t.assert.strictEqual(server.connection.sendDiagnostics.mock.callCount(), 0);
	});
});
