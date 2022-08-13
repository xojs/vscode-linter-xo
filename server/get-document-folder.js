const path = require('path');
const {URI} = require('vscode-uri');
const pkgDir = require('pkg-dir');

/**
 * get the root folder document from a document
 * caches workspace folders if needed
 *
 * @param {TextDocument} document
 * @returns {TextDocument}
 */
async function getDocumentFolder(document) {
	// check for cached folder
	if ([...this.foldersCache].some((folder) => document.uri.includes(folder))) {
		return {uri: [...this.foldersCache].find((folder) => document.uri.includes(folder))};
	}

	// we need the workspace folders to determine the root

	const documentPath = URI.parse(document.uri).fsPath;
	const documentDir = path.dirname(documentPath);
	const packageDir = await pkgDir(documentDir);

	const packageDirUri = URI.file(packageDir).toString();

	const folder = {uri: packageDirUri};

	this.foldersCache.add(folder.uri);

	return folder;
}

module.exports = getDocumentFolder;
