import process from 'node:process';
import path from 'node:path';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {describe, test, type TestContext} from 'node:test';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {CodeActionKind, type CancellationToken} from 'vscode-languageserver';
import {URI} from 'vscode-uri';
import Server from '../../server/server.ts';

// eslint-disable-next-line @typescript-eslint/no-empty-function
const noop = () => {};

describe('Server lint flow', () => {
	/**
	 * Exercises the server's primary workflow against a real temporary XO
	 * workspace. This intentionally crosses workspace discovery, XO resolution,
	 * linting, diagnostic caching, code actions, and formatting so those pieces
	 * cannot drift apart while their isolated tests continue to pass.
	 */
	test('lints, offers fixes, formats, and clears diagnostics', async (t: TestContext) => {
		const originalWorkingDirectory = process.cwd();
		const workspacePath = await mkdtemp(path.join(originalWorkingDirectory, '.test-workspace-'));
		const documentPath = path.join(workspacePath, 'example.js');
		const originalText = 'console.log("test");\n';
		// This deliberately represents XO's single-quote correction.
		// eslint-disable-next-line @stylistic/quotes
		const fixedText = "console.log('test');\n";

		await Promise.all([
			writeFile(
				path.join(workspacePath, 'package.json'),
				JSON.stringify({private: true, devDependencies: {xo: '*'}}),
			),
			writeFile(
				path.join(workspacePath, 'xo.config.mjs'),
				// The fixture config needs nested single-quoted JavaScript strings.
				// eslint-disable-next-line @stylistic/quotes
				"export default [{rules: {'@stylistic/quotes': ['error', 'single']}}];\n",
			),
			writeFile(documentPath, originalText),
		]);

		const uri = URI.file(documentPath).toString();
		const document = TextDocument.create(uri, 'javascript', 1, originalText);
		const documents: Map<string, TextDocument> & {all?: typeof Map.prototype.values} = new Map([
			[uri, document],
		]);
		documents.all = documents.values;

		const server = new Server({isTest: true});
		Object.defineProperty(server, 'documents', {value: documents});
		server.configurationCache.set(uri, {
			enable: true,
			format: {enable: true},
			path: path.join(originalWorkingDirectory, 'node_modules/xo/dist/index.js'),
		});
		t.mock.method(server, 'log', noop);
		t.mock.method(server, 'logError', noop);
		const sendDiagnostics = t.mock.method(server.connection, 'sendDiagnostics', noop);

		/**
		 * Restores process-wide state and removes the temporary workspace even when
		 * an assertion fails, preventing this integration test from affecting later
		 * files or leaving generated fixtures in the repository.
		 */
		t.after(async () => {
			process.chdir(originalWorkingDirectory);
			await server.handleShutdown();
			server.connection.dispose();
			await rm(workspacePath, {recursive: true, force: true});
		});

		await server.lintDocument(document);

		t.assert.strictEqual(sendDiagnostics.mock.callCount(), 1);
		const diagnostic = sendDiagnostics.mock.calls[0].arguments[0]!.diagnostics.find(
			diagnostic => diagnostic.code === '@stylistic/quotes',
		);
		t.assert.ok(diagnostic);
		t.assert.strictEqual(diagnostic.source, 'XO');
		t.assert.strictEqual(
			diagnostic.codeDescription?.href,
			'https://eslint.style/rules/quotes',
		);

		const codeActions = await server.handleCodeActionRequest({
			textDocument: {uri},
			range: diagnostic.range,
			context: {diagnostics: [diagnostic], only: [CodeActionKind.QuickFix]},
		});
		const fixAction = codeActions?.find(action => action.title === 'Fix @stylistic/quotes with XO');
		// This deliberately asserts the single-quoted replacement text.
		// eslint-disable-next-line @stylistic/quotes
		t.assert.strictEqual(fixAction?.edit?.changes?.[uri]?.[0].newText, "'test'");

		const edits = await server.handleDocumentFormattingRequest(
			{
				textDocument: {uri},
				options: {tabSize: 2, insertSpaces: true},
			},
			{isCancellationRequested: false} as CancellationToken,
		);
		t.assert.strictEqual(TextDocument.applyEdits(document, edits), fixedText);

		const fixedDocument = TextDocument.create(uri, 'javascript', 2, fixedText);
		documents.set(uri, fixedDocument);
		await server.lintDocument(fixedDocument);

		t.assert.strictEqual(sendDiagnostics.mock.callCount(), 2);
		t.assert.deepStrictEqual(sendDiagnostics.mock.calls[1].arguments[0]!, {
			uri,
			version: 2,
			diagnostics: [],
		});
	});

	/**
	 * Documents the process-level ESM cache that currently requires the extension
	 * to replace its server after a JavaScript XO config changes. This assertion
	 * should be inverted when linting moves behind a replaceable worker or XO
	 * exposes reliable configuration invalidation.
	 */
	test('documents stale ESM configuration in a reused XO process', async (t: TestContext) => {
		const workspacePath = await mkdtemp(path.join(process.cwd(), '.test-config-cache-'));
		const configPath = path.join(workspacePath, 'xo.config.mjs');
		const filePath = path.join(workspacePath, 'example.js');
		const code = 'console.log(\'test\');\n';
		const {default: xo} = await import('xo');

		t.after(async () => {
			await rm(workspacePath, {recursive: true, force: true});
		});

		await Promise.all([
			writeFile(path.join(workspacePath, 'package.json'), JSON.stringify({type: 'module'})),
			writeFile(configPath, 'export default [{rules: {\'no-console\': \'off\'}}];\n'),
			writeFile(filePath, code),
		]);

		const options = {cwd: workspacePath, filePath, warnIgnored: false};
		const first = await xo.lintText(code, options);

		await writeFile(configPath, 'export default [{rules: {\'no-console\': \'error\'}}];\n');
		const second = await xo.lintText(code, options);

		t.assert.ok(first.results[0]?.messages.every(message => message.ruleId !== 'no-console'));
		t.assert.ok(second.results[0]?.messages.every(message => message.ruleId !== 'no-console'));
	});
});
