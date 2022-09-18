const path = require('node:path');

/**
 * @typedef {import('vscode-languageserver-textdocument').TextDocument} TextDocument
 * @typedef {import('./server.js').LintServer} LintServer
 */

/**
 * Gets document config
 * and caches it if needed
 *
 * @this {LintServer}
 * @param {TextDocument} document
 * @returns {Promise<any>} config
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
