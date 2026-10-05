import {describe, test, type TestContext} from 'node:test';
import {LSPErrorCodes, ResponseError} from 'vscode-languageserver/node';
import {
	formatErrorChain,
	getErrorFingerprint,
	isExpectedLspError,
	toError,
} from '../server/errors.ts';

describe('Server error boundary', () => {
	test('preserves Error objects', (t: TestContext) => {
		const error = new Error('failure');
		t.assert.strictEqual(toError(error), error);
	});

	test('normalizes primitive and object throws', (t: TestContext) => {
		t.assert.strictEqual(toError('failure').message, 'failure');
		t.assert.match(toError({reason: 'failure'}).message, /reason.*failure/v);
	});

	test('formats circular objects and nested causes safely', (t: TestContext) => {
		const thrown: {self?: unknown} = {};
		thrown.self = thrown;
		t.assert.match(toError(thrown).message, /Circular/v);

		const underlying = new SyntaxError('Unexpected token');
		const wrapped = new Error('Error resolving XO config', {cause: underlying});
		const output = formatErrorChain(wrapped);
		t.assert.match(output, /Error resolving XO config/v);
		t.assert.match(output, /Caused by: SyntaxError: Unexpected token/v);
	});

	test('terminates circular cause chains', (t: TestContext) => {
		const first = new Error('first');
		const second = new Error('second', {cause: first});
		Object.defineProperty(first, 'cause', {value: second});
		t.assert.match(formatErrorChain(first), /Circular error cause/v);
	});

	test('recognizes only typed expected LSP responses', (t: TestContext) => {
		t.assert.ok(isExpectedLspError(
			new ResponseError(LSPErrorCodes.RequestCancelled, 'cancelled'),
		));
		t.assert.ok(isExpectedLspError(
			new ResponseError(LSPErrorCodes.ContentModified, 'modified'),
		));
		t.assert.ok(!isExpectedLspError(new Error('request cancelled')));
	});

	test('creates stable, meaningfully distinct fingerprints', (t: TestContext) => {
		const first = getErrorFingerprint('xo', 'root', new Error('failure'));
		const repeated = getErrorFingerprint('xo', 'root', new Error('failure'));
		const otherRoot = getErrorFingerprint('xo', 'other', new Error('failure'));
		const otherFailure = getErrorFingerprint('xo', 'root', new Error('different'));

		t.assert.strictEqual(first, repeated);
		t.assert.notStrictEqual(first, otherRoot);
		t.assert.notStrictEqual(first, otherFailure);
	});
});
