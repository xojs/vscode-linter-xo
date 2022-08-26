const path = require('node:path');
/**
 * Gets document folder and settings
 * and caches them if needed
 * @param {TextDocument} document
 */
async function getDocumentConfig(document) {
	const folderUri = path.dirname(document.uri);

	if (this.configurationCache.has(folderUri)) return this.configurationCache.get(folderUri);

	const config = await this.connection.workspace.getConfiguration({
		scopeUri: folderUri,
		section: 'xo'
	});

	this.configurationCache.set(folderUri, config);

	return config;
}

module.exports = getDocumentConfig;
