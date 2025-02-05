import process from 'node:process';
import {URI} from 'vscode-uri';
import {type TextDocument} from 'vscode-languageserver-textdocument';
import type LintServer from './server';
import {type XoResult, type LintTextOptions} from './types';

async function getLintResults(
	this: LintServer,
	document: TextDocument,
	_contents?: string,
	fix?: boolean
): Promise<XoResult> {
	// first we resolve all the configs we need
	const [{uri: folderUri = ''} = {}, {options = {}}] = await Promise.all([
		this.getDocumentFolder(document),
		this.getDocumentConfig(document)
	]);

	// if we can't find a valid folder, then the user
	// has likely opened a JS file from another location
	// so we will just bail out of linting early
	if (!folderUri) {
		const error = new Error('No valid xo folder could be found for this file. Skipping linting.');
		this.logError(error);
		return {
			cwd: folderUri,
			results: [],
			warningCount: 0,
			errorCount: 0,
			fixableErrorCount: 0,
			fixableWarningCount: 0,
			rulesMeta: {}
		};
	}

	const xo = await this.resolveXo(document);

	const {fsPath: documentFsPath} = URI.parse(document.uri);
	const {fsPath: folderFsPath} = URI.parse(folderUri);
	const contents = _contents ?? document.getText();

	const lintTextOptions: LintTextOptions = {
		...options,
		// set the options needed for internal xo config resolution
		cwd: folderFsPath,
		filePath: documentFsPath,
		warnIgnored: false,
		fix
	};

	/**
	 * Changing the current working directory to the folder
	 */
	const cwd = process.cwd();

	process.chdir(lintTextOptions.cwd);

	const report = await xo.lintText(contents, lintTextOptions);

	if (cwd !== process.cwd()) {
		process.chdir(cwd);
	}

	return report;
}

export default getLintResults;
