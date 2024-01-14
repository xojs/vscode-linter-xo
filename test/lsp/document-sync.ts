import {test, describe, mock, type Mock} from 'node:test';
import assert from 'node:assert';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {type Connection} from 'vscode-languageserver';
import Server from '../../server/server.js';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

describe('Server documents syncing', () => {
	let server: Omit<Server, 'lintDocumentDebounced' | 'documents' | 'connection' | 'log'> & {
		lintDocumentDebounced: Mock<Server['lintDocumentDebounced']>;
		log: Mock<Server['log']>;
		documents: Map<string, TextDocument> & {all?: typeof Map.prototype.values};
		connection: Omit<Connection, 'sendDiagnostics'> & {
			sendDiagnostics: Mock<Connection['sendDiagnostics']>;
		};
	};

	test.beforeEach((t) => {
		const documents: Map<string, TextDocument> & {all?: typeof Map.prototype.values} = new Map([
			['uri', TextDocument.create('uri', 'javascript', 1, 'content')],
			['uri/node_modules', TextDocument.create('uri/node_modules', 'javascript', 1, 'content')]
		]);
		documents.all = documents.values;
		// @ts-expect-error readonly headaches
		Server.prototype.documents = documents;
		// @ts-expect-error this is just too hard to type with mock and not worth it
		server = new Server({isTest: true});
		server.documents = documents;
		mock.method(server, 'log', noop);
		mock.method(server, 'lintDocumentDebounced', noop);
		mock.method(server.connection, 'sendDiagnostics', noop);
	});

	test.afterEach(() => {
		// @ts-expect-error this helps cleanup and keep types clean
		server = undefined;
		mock.restoreAll();
	});

	test('Server.handleDocumentsOnDidChangeContent is a function', (t) => {
		assert.equal(typeof server.handleDocumentsOnDidChangeContent, 'function');
	});

	test('Server.handleDocumentsOnDidChangeContent calls lintDocument', async (t) => {
		server.handleDocumentsOnDidChangeContent({
			document: TextDocument.create('uri', 'javascript', 1, 'content')
		});
		await new Promise((resolve) => {
			server.queue.once('end', () => {
				resolve(undefined);
			});
		});
		assert.equal(server.lintDocumentDebounced.mock.callCount(), 1);
	});

	test('Server.handleDocumentsOnDidChangeContent does not lint document if version is mismatched', async (t) => {
		server.handleDocumentsOnDidChangeContent({
			document: TextDocument.create('uri', 'javascript', 2, 'content')
		});
		await new Promise((resolve) => {
			server.queue.once('end', () => {
				resolve(undefined);
			});
		});
		assert.equal(server.lintDocumentDebounced.mock.callCount(), 0);
	});

	test('Server.handleDocumentsOnDidChangeContent does not lint document if document is in node_modules and logs message', async (t) => {
		server.handleDocumentsOnDidChangeContent({
			document: TextDocument.create('uri/node_modules', 'javascript', 1, 'content')
		});
		await new Promise((resolve) => {
			server.queue.once('end', () => {
				resolve(undefined);
			});
		});
		assert.equal(server.log.mock.callCount(), 1);
		assert.equal(server.log.mock.calls[0].arguments[0], 'skipping node_modules file');
		assert.equal(server.lintDocumentDebounced.mock.callCount(), 0);
	});

	test('Server.handleDocumentsOnDidClose sends empty diagnostics for closed file', async (t) => {
		await server.handleDocumentsOnDidClose({
			document: TextDocument.create('uri', 'javascript', 1, 'content')
		});
		assert.equal(server.connection.sendDiagnostics.mock.callCount(), 1);
		assert.deepEqual(server.connection.sendDiagnostics.mock.calls[0].arguments[0], {
			uri: 'uri',
			diagnostics: []
		});
	});
});
