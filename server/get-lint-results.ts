import process from 'node:process';
import {URI} from 'vscode-uri';
import type {TextDocument} from 'vscode-languageserver-textdocument';
import type LintServer from './server';
import type {XoResult, LintTextOptions} from './types';

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

	const lintTextOptions: LintTextOptions = {
		...options
	};

	// if we can't find a valid folder, then the user
	// has likely opened a JS file from another location
	// so we will just bail out of linting early
	if (!folderUri) {
		const error = new Error('No valid xo folder could be found for this file. Skipping linting.');
		this.logError(error);
		return {results: [], warningCount: 0, errorCount: 0, rulesMeta: {}};
	}

	const xo = await this.resolveXo(document);

	const {fsPath: documentFsPath} = URI.parse(document.uri);
	const {fsPath: folderFsPath} = URI.parse(folderUri);
	const contents = _contents ?? document.getText();

	// set the options needed for internal xo config resolution
	lintTextOptions.cwd = folderFsPath;
	lintTextOptions.filename = documentFsPath;
	lintTextOptions.filePath = documentFsPath;
	lintTextOptions.warnIgnored = false;
	lintTextOptions.fix = fix;

	let report;

	const cwd = process.cwd();

	try {
		process.chdir(lintTextOptions.cwd);

		// eslint-disable-next-line @typescript-eslint/await-thenable
		report = await xo.lintText(contents, lintTextOptions);
	} finally {
		if (cwd !== process.cwd()) {
			process.chdir(cwd);
		}
	}

	return report;
}

export default getLintResults;
