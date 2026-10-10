import type {TextDocument, WorkspaceConfiguration} from 'vscode';
import type {DocumentSelector} from 'vscode-languageclient/node';

const legacyDefaultLanguages = new Set([
	'javascript',
	'javascriptreact',
	'typescript',
	'typescriptreact',
]);

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
 * Builds the VS Code language-client selector for the configured languages.
 * XO 5's additional defaults use a file glob because formats such as JSON5 do
 * not have a stable built-in VS Code language identifier. The server decides
 * whether the resolved XO installation is new enough to lint these candidates.
 */
export function getDocumentSelector(xoConfig: WorkspaceConfiguration): DocumentSelector {
	// Null is the persisted sentinel for version-dependent defaults, not an absent JavaScript value.
	// eslint-disable-next-line @typescript-eslint/no-restricted-types
	const configuredLanguages = xoConfig.get<string[] | null>('validate', null);
	const documentSelector: DocumentSelector = (configuredLanguages ?? defaultLanguages).flatMap(language => [
		{language, scheme: 'file'},
		{language, scheme: 'untitled'},
	]);

	if (configuredLanguages === null) {
		documentSelector.push({
			scheme: 'file',
			pattern: '**/*.{vue,svelte,astro,html,md,json,jsonc,json5,css}',
		});
	}

	return documentSelector;
}

/**
 * Reports whether the resolved XO installation will validate a document. Null
 * selects version-dependent defaults, while explicit arrays remain authoritative
 * even when they happen to match a default language set. Unknown and custom XO
 * versions conservatively receive only the legacy defaults.
 */
export function isValidatedDocument(
	xoConfig: WorkspaceConfiguration,
	textDocument: TextDocument,
	xoVersion?: string,
): boolean {
	// Null is the persisted sentinel for version-dependent defaults, not an absent JavaScript value.
	// eslint-disable-next-line @typescript-eslint/no-restricted-types
	const configuredLanguages = xoConfig.get<string[] | null>('validate', null);

	if (configuredLanguages !== null) {
		return configuredLanguages.includes(textDocument.languageId);
	}

	if (legacyDefaultLanguages.has(textDocument.languageId)) {
		return true;
	}

	const xoMajorVersion = Number(xoVersion?.split('.', 1)[0]);
	return xoMajorVersion >= 5
		&& (defaultLanguages.includes(textDocument.languageId)
			|| /\.(?:vue|svelte|astro|html|md|json|jsonc|json5|css)$/iv.test(textDocument.uri.fsPath));
}
