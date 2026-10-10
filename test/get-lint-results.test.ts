import process from 'node:process';
import path from 'node:path';
import {test, type TestContext} from 'node:test';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {URI} from 'vscode-uri';
import Server from '../server/server.ts';
import type {XoResult} from '../server/types.ts';

const legacyDefaultLanguages = [
	'javascript',
	'javascriptreact',
	'typescript',
	'typescriptreact',
];

const defaultLanguages = [
	...legacyDefaultLanguages,
	'vue',
	'svelte',
	'astro',
	'html',
	'markdown',
	'json',
	'jsonc',
	'json5',
	'css',
];

/**
 * Creates the minimal successful XO report needed by the lint boundary. Keeping
 * the fake report structurally realistic ensures the test exercises version
 * routing without depending on a second installed XO release.
 */
function createEmptyReport(cwd: string): XoResult {
	return {
		cwd,
		results: [],
		warningCount: 0,
		errorCount: 0,
		fixableErrorCount: 0,
		fixableWarningCount: 0,
		rulesMeta: {},
	};
}

/**
 * Covers the compatibility boundary around XO 5's expanded default file set.
 * One server and one fake XO module are reused so each assertion differs only
 * in the resolved version or explicit editor setting being tested.
 */
test('additional default file types require XO 5 unless explicitly validated', async (t: TestContext) => {
	const server = new Server({isTest: true});
	const cwd = process.cwd();
	const documentPath = path.join(cwd, 'example.css');
	const document = TextDocument.create(URI.file(documentPath).toString(), 'css', 1, 'a {}');
	let version = '4.0.0';
	// Null exercises automatic defaults; arrays below verify that explicit settings remain authoritative.
	// eslint-disable-next-line @typescript-eslint/no-restricted-types
	let validate: string[] | null = null;
	const lintText = t.mock.fn(async () => createEmptyReport(cwd));

	t.mock.method(server, 'getDocumentFolder', async () => ({uri: URI.file(cwd).toString()}));
	t.mock.method(server, 'getDocumentConfig', async () => ({validate}));
	t.mock.method(server, 'resolveXo', async () => ({xo: {lintText}, version}));

	t.after(async () => {
		await server.handleShutdown();
		server.connection.dispose();
	});

	await server.getLintResults(document);
	t.assert.strictEqual(lintText.mock.callCount(), 0);

	version = '5.0.0';
	await server.getLintResults(document);
	t.assert.strictEqual(lintText.mock.callCount(), 1);

	validate = legacyDefaultLanguages;
	await server.getLintResults(document);
	t.assert.strictEqual(lintText.mock.callCount(), 1);

	version = '4.0.0';
	validate = defaultLanguages;
	await server.getLintResults(document);
	t.assert.strictEqual(lintText.mock.callCount(), 2);

	validate = ['css'];
	await server.getLintResults(document);
	t.assert.strictEqual(lintText.mock.callCount(), 3);
});
