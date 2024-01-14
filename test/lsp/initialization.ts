import {describe, test} from 'node:test';
import assert from 'node:assert';
import Server from '../../server/server.js';

describe('Server.handleInitialize', async () => {
	const server = new Server({isTest: true});

	await test('Server.handleInitialize is a function', (t) => {
		assert.equal(typeof server.handleInitialize, 'function');
	});

	await test('InitializeResult matches snapshot', async (t) => {
		const result = await server.handleInitialize();
		assert.deepEqual(result, {
			capabilities: {
				workspace: {workspaceFolders: {supported: true}},
				textDocumentSync: {openClose: true, change: 2},
				documentFormattingProvider: true,
				documentRangeFormattingProvider: true,
				codeActionProvider: {codeActionKinds: ['quickfix', 'source.fixAll']}
			}
		});
	});
});
