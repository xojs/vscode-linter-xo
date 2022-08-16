const {DiagnosticSeverity} = require('vscode-languageserver/node');
const getRuleUrl = require('eslint-rule-docs');
const utils = require('./utils');

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

		const {config: {overrideSeverity} = {}} = await this.getDocumentConfig(document);

		const {results, rulesMeta} = await this.getLintResults(document);

		// Clean previously computed code actions.
		this.documentEdits.delete(document.uri);

		if (results?.length === 0 || !results?.[0]?.messages) return;

		const diagnostics = results[0].messages.map((problem) => {
			const diagnostic = utils.makeDiagnostic(problem);
			if (overrideSeverity) {
				const mapSeverity = {
					off: diagnostic.severity,
					info: DiagnosticSeverity.Information,
					warn: DiagnosticSeverity.Warning,
					error: DiagnosticSeverity.Error
				};
				diagnostic.severity = mapSeverity[overrideSeverity] || diagnostic.severity;
			}

			if (
				rulesMeta !== undefined &&
				rulesMeta !== null &&
				typeof rulesMeta === 'object' &&
				rulesMeta[diagnostic.code] !== undefined &&
				rulesMeta[diagnostic.code] !== null &&
				typeof rulesMeta[diagnostic.code] === 'object'
			) {
				diagnostic.codeDescription = {
					href: rulesMeta[diagnostic.code].docs.url
				};
			} else {
				try {
					diagnostic.codeDescription = {
						href: getRuleUrl(diagnostic.code)?.url
					};
				} catch {}
			}

			/**
			 * record a code action for applying fixes
			 */
			if (problem.fix && problem.ruleId) {
				const {uri} = document;

				let edits = this.documentEdits.get(uri);

				if (!edits) {
					edits = new Map();
					this.documentEdits.set(uri, edits);
				}

				edits.set(utils.computeKey(diagnostic), {
					label: `Fix this ${problem.ruleId} problem`,
					documentVersion: document.version,
					ruleId: problem.ruleId,
					edit: problem.fix
				});
			}

			return diagnostic;
		});

		this.connection.sendDiagnostics({
			uri: document.uri,
			version: document.version,
			diagnostics
		});
	} catch (error) {
		const isResolutionErr = error?.message?.includes('Failed to resolve module');
		if (isResolutionErr) error.message += '. Ensure that xo has been installed.';
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
