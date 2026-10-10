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
 * Determines whether validation still uses the extension's packaged defaults.
 * This distinction lets older XO versions ignore the formats introduced by XO
 * 5 without overriding a user's customized `xo.validate` list.
 */
function isUsingDefaultLanguages(languages: string[]): boolean {
	return languages.length === defaultLanguages.length
		&& defaultLanguages.every(language => languages.includes(language));
}

/**
 * Builds the VS Code language-client selector for the configured languages.
 * XO 5's additional defaults use a file glob because formats such as JSON5 do
 * not have a stable built-in VS Code language identifier. The server decides
 * whether the resolved XO installation is new enough to lint these candidates.
 */
export function getDocumentSelector(xoConfig: WorkspaceConfiguration): DocumentSelector {
	const languages = xoConfig.get<string[]>('validate', defaultLanguages);
	const documentSelector: DocumentSelector = languages.flatMap(language => [
		{language, scheme: 'file'},
		{language, scheme: 'untitled'},
	]);

	if (isUsingDefaultLanguages(languages)) {
		documentSelector.push({
			scheme: 'file',
			pattern: '**/*.{vue,svelte,astro,html,md,json,jsonc,json5,css}',
		});
	}

	return documentSelector;
}

/**
 * Reports whether a document is relevant to the configured validation scope.
 * Additional XO 5 file extensions are treated as candidates when the user has
 * kept the defaults; the server performs the final installed-version check.
 */
export function isValidatedDocument(
	xoConfig: WorkspaceConfiguration,
	textDocument: TextDocument,
): boolean {
	const languages = xoConfig.get<string[]>('validate', defaultLanguages);

	return languages.includes(textDocument.languageId)
		|| (isUsingDefaultLanguages(languages)
			&& /\.(?:vue|svelte|astro|html|md|json|jsonc|json5|css)$/iv.test(textDocument.uri.fsPath));
}
