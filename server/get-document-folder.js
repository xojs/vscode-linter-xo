const path = require('path');
const {findXoRoot, pathToUri, uriToPath} = require('./utils');

/**
 * get the root folder document from a document
 * caches workspace folders if needed
 *
 * @param {TextDocument} document
 * @returns {TextDocument}
 */
async function getDocumentFolder(document) {
	const documentDirUri = path.dirname(document.uri);
	// check for cached folder
	if (this.foldersCache.has(documentDirUri)) {
		return this.foldersCache.get(documentDirUri);
	}

	const documentPath = uriToPath(document.uri);
	const documentDir = path.dirname(documentPath);
	const {pkgPath} = await findXoRoot(documentDir);

	if (pkgPath) {
		const packageDirUri = pathToUri(path.dirname(pkgPath));
		this.foldersCache.set(documentDirUri, {uri: packageDirUri});
	} else {
		this.foldersCache.set(documentDirUri, {});
	}

	return this.foldersCache.get(documentDirUri);
}

module.exports = getDocumentFolder;
