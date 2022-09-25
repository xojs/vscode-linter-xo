import path from 'node:path';
import {TextDocument} from 'vscode-languageserver-textdocument';
import type LintServer from './server';
import {findXoRoot, pathToUri, uriToPath} from './utils';

/**
 * get the root folder document from a document
 * caches workspace folders if needed
 */
async function getDocumentFolder(this: LintServer, document: TextDocument) {
	const documentDirUri = path.dirname(document.uri);
	// check for cached folder
	if (this.foldersCache.has(documentDirUri)) {
		return this.foldersCache.get(documentDirUri);
	}

	const documentPath = uriToPath(document.uri);
	const documentDir = path.dirname(documentPath);
	const {pkgPath} = (await findXoRoot(documentDir)) ?? {};

	if (pkgPath) {
		const packageDirUri = pathToUri(path.dirname(pkgPath));
		this.foldersCache.set(documentDirUri, {uri: packageDirUri});
	} else {
		this.foldersCache.set(documentDirUri, {});
	}

	return this.foldersCache.get(documentDirUri);
}

export default getDocumentFolder;
