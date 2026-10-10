import type {TextDocument, WorkspaceConfiguration} from 'vscode';
import type {DocumentSelector} from 'vscode-languageclient/node';

const defaultLanguages = [
	'javascript',
	'javascriptreact',
	'typescript',
	'typescriptreact',
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
 * Reports whether a document is relevant to the configured validation scope.
 * A null setting selects candidates for the version-dependent defaults; the
 * server resolves XO and makes the final decision. Explicit arrays remain
 * authoritative, including arrays that happen to match a default language set.
 */
export function isValidatedDocument(
	xoConfig: WorkspaceConfiguration,
	textDocument: TextDocument,
): boolean {
	// Null is the persisted sentinel for version-dependent defaults, not an absent JavaScript value.
	// eslint-disable-next-line @typescript-eslint/no-restricted-types
	const configuredLanguages = xoConfig.get<string[] | null>('validate', null);

	return (configuredLanguages ?? defaultLanguages).includes(textDocument.languageId)
		|| (configuredLanguages === null
			&& /\.(?:vue|svelte|astro|html|md|json|jsonc|json5|css)$/iv.test(textDocument.uri.fsPath));
}
