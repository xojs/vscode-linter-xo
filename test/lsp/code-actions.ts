import {test, describe, mock, type Mock} from 'node:test';
import assert from 'node:assert';
import {setTimeout} from 'node:timers';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {
	Position,
	Diagnostic,
	type CodeActionParams,
	type Range,
	type TextDocumentIdentifier
} from 'vscode-languageserver';
import Server from '../../server/server.js';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

describe('Server code actions', async () => {
	let server: Omit<Server, 'documents' | 'log'> & {
		log: Mock<Server['log']>;
		getDocumentFormatting: Mock<Server['getDocumentFormatting']>;
		documents: Map<string, TextDocument> & {all?: typeof Map.prototype.values};
	};

	test.beforeEach((t) => {
		const documents: Map<string, TextDocument> & {all?: typeof Map.prototype.values} = new Map([
			['uri', TextDocument.create('uri', 'javascript', 1, 'content')],
			['uri/node_modules', TextDocument.create('uri/node_modules', 'javascript', 1, 'content')]
		]);
		documents.all = documents.values;
		// @ts-expect-error readonly
		Server.prototype.documents = documents;
		// @ts-expect-error painfully difficult to type, but the declaration is correct
		server = new Server({isTest: true});
		server.documents = documents;
		mock.method(server, 'log', noop);
		mock.method(server, 'getDocumentFormatting', noop);
	});

	test.afterEach(async () => {
		await server.handleShutdown();
		// @ts-expect-error this helps cleanup and keep types clean
		server = undefined;
		mock.restoreAll();
	});

	test('Server.handleCodeActionRequest is a function', (t) => {
		assert.equal(typeof server.handleCodeActionRequest, 'function');
	});

	test('Server.handleCodeActionRequest returns an empty array if no code actions are available', async (t) => {
		const textDocument: TextDocumentIdentifier = {uri: 'uri'};
		const range: Range = {start: Position.create(0, 0), end: Position.create(0, 0)};
		const mockCodeActionParams: CodeActionParams = {
			textDocument,
			range,
			context: {diagnostics: [Diagnostic.create(range, 'test message', 1, 'test', 'test')]}
		};
		const codeActions = await server.handleCodeActionRequest(mockCodeActionParams);
		assert.deepEqual(codeActions, []);
	});

	test('codeActionKind source.fixAll calls getDocumentFormatting for the document', async (t) => {
		const textDocument: TextDocumentIdentifier = {uri: 'uri'};
		const range: Range = {start: Position.create(0, 0), end: Position.create(0, 0)};
		const mockCodeActionParams: CodeActionParams = {
			textDocument,
			range,
			context: {
				diagnostics: [Diagnostic.create(range, 'test message', 1, 'test', 'test')],
				only: ['source.fixAll']
			}
		};
		const codeActions = await server.handleCodeActionRequest(mockCodeActionParams);

		assert.deepEqual(codeActions, [
			{title: 'Fix all XO auto-fixable problems', kind: 'source.fixAll', edit: {changes: {uri: []}}}
		]);
		assert.equal(server.getDocumentFormatting.mock.callCount(), 1);
		assert.deepEqual(server.getDocumentFormatting.mock.calls[0].arguments, ['uri']);
	});
});
