/**
 * get the folder error options
 * cache them if needed
 * @param {TextDocument} document
 */
async function getDocumentErrorOptions(document, newOptions) {
	const {uri: folderUri} = await this.getDocumentFolder(document);

	if (!folderUri && this.errorOptionsCache.has(folderUri)) {
		this.errorOptionsCache.delete(folderUri);
		return;
	}

	if (this.errorOptionsCache.has(folderUri)) {
		const errorOptions = {
			...this.errorOptionsCache.get(folderUri),
			...(typeof newOptions === 'undefined' ? {} : newOptions)
		};
		this.errorOptionsCache.set(folderUri, errorOptions);
		return errorOptions;
	}

	this.errorOptionsCache.set(folderUri, {
		...(this.errorOptionsCache.has(folderUri) ? this.errorOptionsCache.get(folderUri) : {}),
		...(typeof newOptions === 'undefined' ? {} : newOptions),
		showResolutionError: true
	});

	return this.errorOptionsCache.get(folderUri);
}

module.exports = getDocumentErrorOptions;
