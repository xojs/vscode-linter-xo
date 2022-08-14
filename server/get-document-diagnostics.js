const {DiagnosticSeverity} = require('vscode-languageserver/node');
const getRuleUrl = require('eslint-rule-docs');
const utils = require('./utils');

/**
 *
 * @param {import('vscode-languageserver-textdocument').TextDocument} document
 * @returns {import('vscode-languageserver/node').Diagnostic}
 */
async function getDocumentDiagnostics(document) {
	const {config: {overrideSeverity} = {}} = await this.getDocumentConfig(document);

	const {results, rulesMeta} = await this.getLintResults(document);

	// Clean previously computed code actions.
	this.codeActions.delete(document.uri);

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

			let edits = this.codeActions.get(uri);

			if (!edits) {
				edits = new Map();
				this.codeActions.set(uri, edits);
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

	return diagnostics;
}

module.exports = getDocumentDiagnostics;
