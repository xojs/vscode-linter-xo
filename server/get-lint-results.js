const process = require('node:process');
const isSANB = require('is-string-and-not-blank');
const {URI} = require('vscode-uri');

async function getLintResults(document, {contents} = {}) {
	// first we resolve all the configs we need
	const [{uri: folderUri} = {}, {options} = {}] = await Promise.all([
		this.getDocumentFolder(document),
		this.getDocumentConfig(document)
	]);

	// if we can't find a valid folder, then the user
	// has likely opened a JS file from another location
	// so we will just bail out of linting early
	if (!folderUri) {
		const error = new Error('No valid xo folder could be found for this file. Skipping linting.');
		this.logError(error);
		return [];
	}

	const xo = await this.resolveXO(document);

	const {fsPath: documentFsPath} = URI.parse(document.uri);
	const {fsPath: folderFsPath} = URI.parse(folderUri);
	contents = isSANB(contents) ? contents : document.getText();

	// set the options needed for internal xo config resolution
	options.cwd = folderFsPath;
	options.filename = documentFsPath;
	options.filePath = documentFsPath;

	let report;

	const cwd = process.cwd();

	try {
		process.chdir(options.cwd);
		report = await xo.lintText(contents, options);
	} finally {
		if (cwd !== process.cwd()) {
			process.chdir(cwd);
		}
	}

	return report;
}

module.exports = getLintResults;
