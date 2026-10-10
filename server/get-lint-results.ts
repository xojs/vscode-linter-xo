import process from 'node:process';
import {URI} from 'vscode-uri';
import type {TextDocument} from 'vscode-languageserver-textdocument';
import type LintServer from './server.ts';
import type {XoResult, LintTextOptions} from './types.ts';

const legacyDefaultLanguages = new Set([
	'javascript',
	'javascriptreact',
	'typescript',
	'typescriptreact',
]);

const defaultLanguages = new Set([
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
]);

/**
 * Resolves the project and editor options needed to lint one document, then
 * delegates to the workspace's XO installation. Some older XO releases depend
 * on the process working directory, so it is changed only for the lint call and
 * is always restored when configuration loading or linting fails.
 */
async function getLintResults(
	this: LintServer,
	document: TextDocument,
	_contents?: string,
	shouldFix?: boolean,
): Promise<XoResult> {
	// first we resolve all the configs we need
	const [
		{uri: folderUri = ''} = {},
		{
			options = {},
			validate = null,
		},
	] = await Promise.all([
		this.getDocumentFolder(document),
		this.getDocumentConfig(document),
	]);

	// if we can't find a valid folder, then the user
	// has likely opened a JS file from another location
	// so we will just bail out of linting early
	if (folderUri === '') {
		const error = new Error('No valid xo folder could be found for this file. Skipping linting.');
		this.logError(error);
		return {
			cwd: folderUri,
			results: [],
			warningCount: 0,
			errorCount: 0,
			fixableErrorCount: 0,
			fixableWarningCount: 0,
			rulesMeta: {},
		};
	}

	const {xo, version} = await this.resolveXo(document);
	const isLegacyDefaultLanguage = legacyDefaultLanguages.has(document.languageId);
	const isAdditionalDefaultDocument =
		defaultLanguages.has(document.languageId)
		|| /\.(?:vue|svelte|astro|html|md|json|jsonc|json5|css)$/iv.test(URI.parse(document.uri).fsPath);
	const xoMajorVersion = Number(version.split('.', 1)[0]);
	const shouldLint = validate === null
		? isLegacyDefaultLanguage || (isAdditionalDefaultDocument && xoMajorVersion >= 5)
		: validate.includes(document.languageId);

	if (!shouldLint) {
		return {
			cwd: folderUri,
			results: [],
			warningCount: 0,
			errorCount: 0,
			fixableErrorCount: 0,
			fixableWarningCount: 0,
			rulesMeta: {},
		};
	}

	const {fsPath: documentFsPath} = URI.parse(document.uri);
	const {fsPath: folderFsPath} = URI.parse(folderUri);
	const contents = _contents ?? document.getText();

	const lintTextOptions: LintTextOptions = {
		...options,
		// set the options needed for internal xo config resolution
		cwd: folderFsPath,
		filePath: documentFsPath,
		warnIgnored: false,
		fix: shouldFix,
	};

	/**
	 * Changing the current working directory to the folder
	 */
	const cwd = process.cwd();

	process.chdir(lintTextOptions.cwd);

	try {
		return await xo.lintText(contents, lintTextOptions);
	} finally {
		if (cwd !== process.cwd()) {
			process.chdir(cwd);
		}
	}
}

export default getLintResults;
