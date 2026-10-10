import assert from 'node:assert/strict';
import {test} from 'node:test';
import type {TextDocument, WorkspaceConfiguration} from 'vscode';
import {isValidatedDocument} from '../client/language-validation.ts';

/**
 * Verifies that status-bar relevance follows the same version boundary as the
 * server while preserving explicit validation arrays. These lightweight
 * configuration and document shapes cover only the VS Code properties consumed
 * by the validation boundary.
 */
test('document validation uses the resolved XO version only for automatic defaults', () => {
	const automaticConfig = {
		get: () => null,
	} as unknown as WorkspaceConfiguration;
	const explicitConfig = {
		get: () => ['json'],
	} as unknown as WorkspaceConfiguration;
	const jsonDocument = {
		languageId: 'json',
		uri: {fsPath: '/workspace/package.json'},
	} as unknown as TextDocument;
	const javascriptDocument = {
		languageId: 'javascript',
		uri: {fsPath: '/workspace/index.js'},
	} as unknown as TextDocument;

	assert.strictEqual(isValidatedDocument(automaticConfig, jsonDocument, '4.0.0'), false);
	assert.strictEqual(isValidatedDocument(automaticConfig, jsonDocument, '5.0.0'), true);
	assert.strictEqual(isValidatedDocument(automaticConfig, javascriptDocument, '4.0.0'), true);
	assert.strictEqual(isValidatedDocument(explicitConfig, jsonDocument, '4.0.0'), true);
});
