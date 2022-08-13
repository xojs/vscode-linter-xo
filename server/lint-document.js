/**
 * lintDocument first
 * lints and sends diagnostics for a single file
 * @param {TextDocument} document
 */
async function lintDocument(document) {
	try {
		const currentDocument = this.documents.get(document.uri);

		if (!currentDocument) return;

		if (document.version !== currentDocument.version) {
			return null;
		}

		const diagnostics = await this.getDocumentDiagnostics(document);

		// this.log('document.uri', document.uri);
		// this.log('diagnostics', diagnostics);

		this.connection.sendDiagnostics({
			uri: document.uri,
			version: document.version,
			diagnostics
		});
	} catch (error) {
		/**
		 * only show resolution errors if package.json has xo listed
		 * as a dependency. Only show the error 1 time per folder.
		 */
		const isResolutionErr = error?.message?.includes('Failed to resolve module');

		if (isResolutionErr) {
			const errorOptions = await this.getDocumentErrorOptions(document);

			if (errorOptions?.showResolutionError && !errorOptions?.hasShownResolutionError) {
				error.message += '. Ensure that xo is installed.';
				this.connection.window.showErrorMessage(error?.message ? error.message : 'Unknown Error');
				this.getDocumentErrorOptions(document, {
					hasShownResolutionError: true
				});
			}
		}

		if (!isResolutionErr)
			this.connection.window.showErrorMessage(error?.message ? error.message : 'Unknown Error');

		this.logError(error);
	}
}

/**
 * helper to lint and sends diagnostics for multiple files
 */
async function lintDocuments(documents) {
	for (const document of documents) {
		this.queue.push(async () => {
			if (document.version !== this.documents.get(document.uri).version) return;

			await this.lintDocument(document);
		});
	}
}

module.exports = {lintDocument, lintDocuments};
