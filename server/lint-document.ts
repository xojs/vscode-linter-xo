import {DiagnosticSeverity} from 'vscode-languageserver/node';
import getRuleUrl from 'eslint-rule-docs';
import type {TextDocument} from 'vscode-languageserver-textdocument';
import isObject from 'lodash/isObject';
import isString from 'lodash/isString';
import * as utils from './utils';
import type LintServer from './server';

/**
 * lintDocument
 *
 * first lints and sends diagnostics for a single file
 */
export async function lintDocument(this: LintServer, document: TextDocument): Promise<void> {
	try {
		const currentDocument = this.documents.get(document.uri);

		if (!currentDocument) return;

		if (document.version !== currentDocument.version) return;

		const {overrideSeverity} = await this.getDocumentConfig(document);

		const {results, rulesMeta} = await this.getLintResults(document);

		// Clean previously computed code actions.
		this.documentFixCache.delete(document.uri);

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
				diagnostic.severity = mapSeverity[overrideSeverity] ?? diagnostic.severity;
			}

			if (
				isObject(rulesMeta) &&
				isString(diagnostic.code) &&
				isObject(rulesMeta[diagnostic.code]) &&
				rulesMeta?.[diagnostic.code]?.docs?.url
			) {
				const href = rulesMeta?.[diagnostic.code].docs?.url;

				if (typeof href === 'string')
					diagnostic.codeDescription = {
						href
					};
			} else {
				try {
					const href = getRuleUrl(diagnostic.code?.toString())?.url;
					if (typeof href === 'string')
						diagnostic.codeDescription = {
							href
						};
				} catch {}
			}

			/**
			 * record a code action for applying fixes
			 */
			if (problem.fix && problem.ruleId) {
				const {uri} = document;

				let edits = this.documentFixCache.get(uri);

				if (!edits) {
					edits = new Map();
					this.documentFixCache.set(uri, edits);
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

		await this.connection.sendDiagnostics({
			uri: document.uri,
			version: document.version,
			diagnostics
		});
	} catch (error: unknown) {
		if (error instanceof Error) {
			if (error.message?.includes('Failed to resolve module')) {
				error.message += '. Ensure that xo has been installed.';
			}

			this.connection.window.showErrorMessage(error?.message ? error.message : 'Unknown Error');
			this.logError(error);
		}
	}
}

/**
 * helper to lint and sends diagnostics for multiple files
 */
export async function lintDocuments(this: LintServer, documents: TextDocument[]): Promise<void> {
	for (const document of documents) {
		this.queue.push(async () => {
			if (document.version !== this.documents.get(document.uri)?.version) return;

			await this.lintDocument(document);
		});
	}
}
