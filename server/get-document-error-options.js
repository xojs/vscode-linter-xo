const path = require('path');
const {URI} = require('vscode-uri');
const readPackageUp = require('read-pkg-up');

/**
 * get the folder error options
 * cache them if needed
 * @param {TextDocument} document
 */
async function getDocumentErrorOptions(document, newOptions) {
	try {
		const {uri: folderUri} = await this.getDocumentFolder(document);

		if (this.errorOptionsCache.has(folderUri)) {
			const errorOptions = {
				...this.errorOptionsCache.get(folderUri),
				...(typeof newOptions === 'undefined' ? {} : newOptions)
			};
			this.errorOptionsCache.set(folderUri, errorOptions);
			return errorOptions;
		}

		const {packageJson: pkg} = await readPackageUp({
			cwd: path.dirname(URI.parse(document.uri).fsPath)
		});

		try {
			if (pkg?.dependencies?.xo || pkg?.devDependencies?.xo) {
				this.errorOptionsCache.set(folderUri, {
					...(this.errorOptionsCache.has(folderUri) ? this.errorOptionsCache.get(folderUri) : {}),
					...(typeof newOptions === 'undefined' ? {} : newOptions),
					showResolutionError: true
				});
			} else if (this.errorOptionsCache.has(folderUri)) this.errorOptionsCache.delete(folderUri);
		} catch (error) {
			if (this.errorOptionsCache.has(folderUri)) this.errorOptionsCache.delete(folderUri);

			this.logError(error);
		}

		return this.errorOptionsCache.get(folderUri);
	} catch (error) {
		this.logError(error);
	}
}

module.exports = getDocumentErrorOptions;
