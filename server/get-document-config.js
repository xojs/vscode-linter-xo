/**
 * Gets document folder and settings
 * and caches them if needed
 * @param {TextDocument} document
 */
async function getDocumentConfig(document) {
	const folder = await this.getDocumentFolder(document);
	if (!folder) return {};
	if (this.configurationCache.has(folder.uri))
		return {
			folder,
			config: this.configurationCache.get(folder.uri)
		};
	const config = await this.connection.workspace.getConfiguration({
		scopeUri: folder.uri,
		section: 'xo'
	});
	this.configurationCache.set(folder.uri, config);
	return {
		folder,
		config
	};
}

module.exports = getDocumentConfig;
