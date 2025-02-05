import {test, describe, mock, type Mock} from 'node:test';
import {setTimeout} from 'node:timers/promises';
import assert from 'node:assert';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {
	Position,
	Diagnostic,
	CodeActionKind,
	type CodeActionParams,
	type Range,
	type TextDocumentIdentifier
	// type Connection
} from 'vscode-languageserver';
import Server from '../../server/server.js';
import {
	getCodeActionParams,
	getIgnoreSameLineCodeAction,
	getIgnoreNextLineCodeAction,
	getIgnoreFileCodeAction,
	getTextDocument
} from '../stubs.js';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

describe('Server code actions', async () => {
	let server: Omit<Server, 'documents' | 'log'> & {
		log: Mock<Server['log']>;
		getDocumentFormatting: Mock<Server['getDocumentFormatting']>;
		documents: Map<string, TextDocument> & {all?: typeof Map.prototype.values};
		getDocumentConfig: Mock<Server['getDocumentConfig']>;
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
		mock.method(server, 'getDocumentFormatting');
		mock.method(server, 'getDocumentConfig', async () => ({enable: true}));
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

	await test('Server.handleCodeActionRequest returns an empty array if no code actions are available', async (t) => {
		const textDocument: TextDocumentIdentifier = {uri: 'uri'};
		const range: Range = {start: Position.create(0, 0), end: Position.create(0, 0)};
		const mockCodeActionParams: CodeActionParams = {
			textDocument,
			range,
			context: {diagnostics: [Diagnostic.create(range, 'test message', 1, 'test', 'test')]}
		};
		const codeActions = await server.handleCodeActionRequest(mockCodeActionParams);
		assert.equal(server.getDocumentConfig.mock.callCount(), 1);
		assert.deepEqual(codeActions, []);
	});

	await test('codeActionKind source.fixAll calls getDocumentFormatting for the document', async (t) => {
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
		assert.equal(server.getDocumentConfig.mock.callCount(), 1);
		assert.deepEqual(codeActions, [
			{
				title: 'Fix all XO auto-fixable problems',
				kind: 'source.fixAll',
				edit: {changes: {uri: []}}
			}
		]);
		assert.equal(server.getDocumentConfig.mock.callCount(), 1);
		assert.equal(server.getDocumentFormatting.mock.callCount(), 1);
		assert.deepEqual(server.getDocumentFormatting.mock.calls[0].arguments, ['uri']);
	});

	await test('codeActionKind source.fixAll.xo calls getDocumentFormatting for the document', async (t) => {
		const textDocument: TextDocumentIdentifier = {uri: 'uri'};
		const range: Range = {start: Position.create(0, 0), end: Position.create(0, 0)};
		const mockCodeActionParams: CodeActionParams = {
			textDocument,
			range,
			context: {
				diagnostics: [Diagnostic.create(range, 'test message', 1, 'test', 'test')],
				only: ['source.fixAll.xo']
			}
		};
		const codeActions = await server.handleCodeActionRequest(mockCodeActionParams);
		assert.equal(server.getDocumentConfig.mock.callCount(), 1);
		assert.deepEqual(codeActions, [
			{
				title: 'Fix all XO auto-fixable problems',
				kind: 'source.fixAll',
				edit: {changes: {uri: []}}
			}
		]);
		assert.equal(server.getDocumentConfig.mock.callCount(), 1);
		assert.equal(server.getDocumentFormatting.mock.callCount(), 1);
		assert.deepEqual(server.getDocumentFormatting.mock.calls[0].arguments, ['uri']);
	});

	await test('codeActionKind only source.quickfix does not call getDocumentFormatting for the document', async (t) => {
		const textDocument: TextDocumentIdentifier = {uri: 'uri'};
		const range: Range = {start: Position.create(0, 0), end: Position.create(0, 0)};
		const mockCodeActionParams: CodeActionParams = {
			textDocument,
			range,
			context: {
				diagnostics: [Diagnostic.create(range, 'test message', 1, 'test', 'test')],
				only: ['source.quickfix']
			}
		};
		const codeActions = await server.handleCodeActionRequest(mockCodeActionParams);
		assert.equal(server.getDocumentConfig.mock.callCount(), 1);
		assert.deepEqual(codeActions, []);
		assert.equal(server.getDocumentFormatting.mock.callCount(), 0);
	});

	await test('codeAction without "only" does not call getDocumentFormatting for the document', async (t) => {
		const textDocument: TextDocumentIdentifier = {uri: 'uri'};
		const range: Range = {start: Position.create(0, 0), end: Position.create(0, 0)};
		const mockCodeActionParams: CodeActionParams = {
			textDocument,
			range,
			context: {
				diagnostics: [Diagnostic.create(range, 'test message', 1, 'test', 'test')]
			}
		};
		const codeActions = await server.handleCodeActionRequest(mockCodeActionParams);
		assert.equal(server.getDocumentConfig.mock.callCount(), 1);
		assert.deepEqual(codeActions, []);
		assert.equal(server.getDocumentFormatting.mock.callCount(), 0);
	});

	await test('codeAction without "only" produces quickfix code actions', async (t) => {
		const codeActions = await server.handleCodeActionRequest(getCodeActionParams());

		assert.deepStrictEqual(codeActions, [
			getIgnoreSameLineCodeAction(),
			getIgnoreNextLineCodeAction(),
			getIgnoreFileCodeAction()
		]);
	});

	await test('codeAction with only quickfix produces quickfix code actions', async (t) => {
		const params = getCodeActionParams();
		params.context.only = [CodeActionKind.QuickFix];
		const codeActions = await server.handleCodeActionRequest(params);

		assert.deepStrictEqual(codeActions, [
			getIgnoreSameLineCodeAction(),
			getIgnoreNextLineCodeAction(),
			getIgnoreFileCodeAction()
		]);
	});

	await test('codeAction with only quickfix produces quickfix code actions', async (t) => {
		const params = getCodeActionParams();
		params.context.only = [CodeActionKind.QuickFix];
		mock.method(server, 'getDocumentConfig', async () => ({enable: false}));
		const codeActions = await server.handleCodeActionRequest(params);

		assert.deepStrictEqual(codeActions, undefined);
	});
});
