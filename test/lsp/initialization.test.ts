import {describe, test, type TestContext} from 'node:test';
import Server from '../../server/server.ts';

describe('Server.handleInitialize', () => {
	const server = new Server({isTest: true});

	test('Server.handleInitialize is a function', (t: TestContext) => {
		t.assert.strictEqual(typeof server.handleInitialize, 'function');
	});

	test('InitializeResult matches snapshot', async (t: TestContext) => {
		const result = await server.handleInitialize();
		t.assert.deepStrictEqual(result, {
			capabilities: {
				workspace: {workspaceFolders: {supported: true}},
				textDocumentSync: {openClose: true, change: 2},
				documentFormattingProvider: true,
				documentRangeFormattingProvider: true,
				codeActionProvider: {codeActionKinds: ['quickfix', 'source.fixAll', 'source.fixAll.xo']},
			},
		});
	});
});
