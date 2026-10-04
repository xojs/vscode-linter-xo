import {test, describe, type TestContext} from 'node:test';
import Server from '../server/server.ts';
import {makeDiagnostic} from '../server/utils.ts';

describe('Server', () => {
	test('Server is a function', (t: TestContext) => {
		t.assert.strictEqual(typeof Server, 'function');
	});

	test('Server can instantiate', (t: TestContext) => {
		const server = new Server({isTest: true});
		t.assert.strictEqual(typeof server, 'object');
	});

	/**
	 * Protects the LSP boundary from zero-based locations emitted by synthetic
	 * ESLint messages and rules such as eslint-comments/require-description.
	 */
	test('diagnostic locations never become negative', (t: TestContext) => {
		const diagnostic = makeDiagnostic({
			ruleId: null,
			severity: 1,
			message: 'Synthetic ESLint message',
			line: 0,
			column: 0,
			endLine: 0,
			endColumn: 0,
		});

		t.assert.deepStrictEqual(diagnostic.range, {
			start: {line: 0, character: 0},
			end: {line: 0, character: 0},
		});
	});
});
