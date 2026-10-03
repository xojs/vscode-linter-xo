import {
	test,
	describe,
	type Mock,
	type TestContext,
} from 'node:test';
import {setTimeout} from 'node:timers/promises';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {
	Position,
	Diagnostic,
	CodeActionKind,
	type CodeActionParams,
	type Range,
	type TextDocumentIdentifier,
	// type Connection
} from 'vscode-languageserver';
import Server from '../../server/server.ts';
// eslint-disable-next-line node-test/no-import-test-files -- This shared helper contains no tests for the Node runner to execute.
import {
	getCodeActionParameters,
	getIgnoreSameLineCodeAction,
	getIgnoreNextLineCodeAction,
	getIgnoreFileCodeAction,
	getTextDocument,
} from '../stubs.ts';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

describe('Server code actions', () => {
	let server: Omit<Server, 'documents' | 'log'> & {
		log: Mock<Server['log']>;
		getDocumentFormatting: Mock<Server['getDocumentFormatting']>;
		documents: Map<string, TextDocument> & {all?: typeof Map.prototype.values};
		getDocumentConfig: Mock<Server['getDocumentConfig']>;
	};

	/**
	 * Creates a fresh server and context-owned mocks for one code-action test.
	 * Keeping the mocks on the test context ensures Node restores them only after
	 * the test and its cleanup hook have completed.
	 */
	function setupTest(t: TestContext) {
		const documents: Map<string, TextDocument> & {all?: typeof Map.prototype.values} = new Map([
			['uri', TextDocument.create('uri', 'javascript', 1, 'content')],
			['uri/node_modules', TextDocument.create('uri/node_modules', 'javascript', 1, 'content')],
		]);
		documents.all = documents.values;
		// @ts-expect-error readonly
		Server.prototype.documents = documents;
		// @ts-expect-error painfully difficult to type, but the declaration is correct
		server = new Server({isTest: true});
		server.documents = documents;
		t.mock.method(server, 'log', noop);
		t.mock.method(server, 'getDocumentFormatting');
		t.mock.method(server, 'getDocumentConfig', async () => ({enable: true}));
		t.after(async () => {
			await server.handleShutdown();
			// @ts-expect-error this helps cleanup and keep types clean
			server = undefined;
		});
	}

	test('Server.handleCodeActionRequest is a function', (t: TestContext) => {
		setupTest(t);
		t.assert.strictEqual(typeof server.handleCodeActionRequest, 'function');
	});

	test('Server.handleCodeActionRequest returns an empty array if no code actions are available', async (t: TestContext) => {
		setupTest(t);
		const textDocument: TextDocumentIdentifier = {uri: 'uri'};
		const range: Range = {start: Position.create(0, 0), end: Position.create(0, 0)};
		const mockCodeActionParameters: CodeActionParams = {
			textDocument,
			range,
			context: {diagnostics: [Diagnostic.create(range, 'test message', 1, 'test', 'test')]},
		};
		const codeActions = await server.handleCodeActionRequest(mockCodeActionParameters);
		t.assert.strictEqual(server.getDocumentConfig.mock.callCount(), 1);
		t.assert.deepStrictEqual(codeActions, []);
	});

	test('codeActionKind source.fixAll calls getDocumentFormatting for the document', async (t: TestContext) => {
		setupTest(t);
		const textDocument: TextDocumentIdentifier = {uri: 'uri'};
		const range: Range = {start: Position.create(0, 0), end: Position.create(0, 0)};
		const mockCodeActionParameters: CodeActionParams = {
			textDocument,
			range,
			context: {
				diagnostics: [Diagnostic.create(range, 'test message', 1, 'test', 'test')],
				only: ['source.fixAll'],
			},
		};
		const codeActions = await server.handleCodeActionRequest(mockCodeActionParameters);
		t.assert.strictEqual(server.getDocumentConfig.mock.callCount(), 1);
		t.assert.deepStrictEqual(codeActions, [
			{
				title: 'Fix all XO auto-fixable problems',
				kind: 'source.fixAll',
				edit: {changes: {uri: []}},
			},
		]);
		t.assert.strictEqual(server.getDocumentConfig.mock.callCount(), 1);
		t.assert.strictEqual(server.getDocumentFormatting.mock.callCount(), 1);
		t.assert.deepStrictEqual(server.getDocumentFormatting.mock.calls[0].arguments, ['uri']);
	});

	test('codeActionKind source.fixAll.xo calls getDocumentFormatting for the document', async (t: TestContext) => {
		setupTest(t);
		const textDocument: TextDocumentIdentifier = {uri: 'uri'};
		const range: Range = {start: Position.create(0, 0), end: Position.create(0, 0)};
		const mockCodeActionParameters: CodeActionParams = {
			textDocument,
			range,
			context: {
				diagnostics: [Diagnostic.create(range, 'test message', 1, 'test', 'test')],
				only: ['source.fixAll.xo'],
			},
		};
		const codeActions = await server.handleCodeActionRequest(mockCodeActionParameters);
		t.assert.strictEqual(server.getDocumentConfig.mock.callCount(), 1);
		t.assert.deepStrictEqual(codeActions, [
			{
				title: 'Fix all XO auto-fixable problems',
				kind: 'source.fixAll.xo',
				edit: {changes: {uri: []}},
			},
		]);
		t.assert.strictEqual(server.getDocumentConfig.mock.callCount(), 1);
		t.assert.strictEqual(server.getDocumentFormatting.mock.callCount(), 1);
		t.assert.deepStrictEqual(server.getDocumentFormatting.mock.calls[0].arguments, ['uri']);
	});

	test('codeActionKind only source.quickfix does not call getDocumentFormatting for the document', async (t: TestContext) => {
		setupTest(t);
		const textDocument: TextDocumentIdentifier = {uri: 'uri'};
		const range: Range = {start: Position.create(0, 0), end: Position.create(0, 0)};
		const mockCodeActionParameters: CodeActionParams = {
			textDocument,
			range,
			context: {
				diagnostics: [Diagnostic.create(range, 'test message', 1, 'test', 'test')],
				only: ['source.quickfix'],
			},
		};
		const codeActions = await server.handleCodeActionRequest(mockCodeActionParameters);
		t.assert.strictEqual(server.getDocumentConfig.mock.callCount(), 1);
		t.assert.deepStrictEqual(codeActions, []);
		t.assert.strictEqual(server.getDocumentFormatting.mock.callCount(), 0);
	});

	test('codeAction without "only" does not call getDocumentFormatting for the document', async (t: TestContext) => {
		setupTest(t);
		const textDocument: TextDocumentIdentifier = {uri: 'uri'};
		const range: Range = {start: Position.create(0, 0), end: Position.create(0, 0)};
		const mockCodeActionParameters: CodeActionParams = {
			textDocument,
			range,
			context: {
				diagnostics: [Diagnostic.create(range, 'test message', 1, 'test', 'test')],
			},
		};
		const codeActions = await server.handleCodeActionRequest(mockCodeActionParameters);
		t.assert.strictEqual(server.getDocumentConfig.mock.callCount(), 1);
		t.assert.deepStrictEqual(codeActions, []);
		t.assert.strictEqual(server.getDocumentFormatting.mock.callCount(), 0);
	});

	test('codeAction without "only" produces quickfix code actions', async (t: TestContext) => {
		setupTest(t);
		const codeActions = await server.handleCodeActionRequest(getCodeActionParameters());

		t.assert.deepStrictEqual(codeActions, [
			getIgnoreSameLineCodeAction(),
			getIgnoreNextLineCodeAction(),
			getIgnoreFileCodeAction(),
		]);
	});

	test('codeAction with only quickfix produces quickfix code actions', async (t: TestContext) => {
		setupTest(t);
		const parameters = getCodeActionParameters();
		parameters.context.only = [CodeActionKind.QuickFix];
		const codeActions = await server.handleCodeActionRequest(parameters);

		t.assert.deepStrictEqual(codeActions, [
			getIgnoreSameLineCodeAction(),
			getIgnoreNextLineCodeAction(),
			getIgnoreFileCodeAction(),
		]);
	});

	test('codeAction with only quickfix returns no actions when XO is disabled', async (t: TestContext) => {
		setupTest(t);
		const parameters = getCodeActionParameters();
		parameters.context.only = [CodeActionKind.QuickFix];
		t.mock.method(server, 'getDocumentConfig', async () => ({enable: false}));
		const codeActions = await server.handleCodeActionRequest(parameters);

		t.assert.strictEqual(codeActions, undefined);
	});
});
