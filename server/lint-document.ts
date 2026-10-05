import {DiagnosticSeverity} from 'vscode-languageserver/node';
import getRuleUrl from 'eslint-rule-docs';
import type {TextDocument} from 'vscode-languageserver-textdocument';
import * as utils from './utils.ts';
import type LintServer from './server.ts';

/**
 * Lints one current document and replaces its diagnostics and cached code
 * actions as one logical operation. Caches are invalidated before XO runs so a
 * failed configuration reload cannot leave fixes from the previous rule set;
 * failures also clear diagnostics rather than presenting stale results as if
 * they came from the new configuration.
 */
export async function lintDocument(this: LintServer, document: TextDocument): Promise<void> {
	try {
		const currentDocument = this.documents.get(document.uri);

		if (document.version !== currentDocument?.version) {
			return;
		}

		const {overrideSeverity, enable} = await this.getDocumentConfig(document);

		// Clean previously computed code actions before loading the potentially changed config.
		this.documentFixCache.delete(document.uri);
		this.documentSuggestionsCache.delete(document.uri);

		if (!enable) {
			await this.connection.sendDiagnostics({
				uri: document.uri,
				version: document.version,
				diagnostics: [],
			});
			return;
		}

		const {results, rulesMeta} = await this.getLintResults(document);
		const messages = results[0]?.messages;

		if (messages === undefined) {
			await this.connection.sendDiagnostics({
				uri: document.uri,
				version: document.version,
				diagnostics: [],
			});
			return;
		}

		// eslint-disable-next-line complexity
		const diagnostics = messages.map(problem => {
			const diagnostic = utils.makeDiagnostic(problem);

			if (overrideSeverity !== undefined) {
				const mapSeverity = {
					off: diagnostic.severity,
					info: DiagnosticSeverity.Information,
					warn: DiagnosticSeverity.Warning,
					error: DiagnosticSeverity.Error,
				};
				diagnostic.severity = mapSeverity[overrideSeverity] ?? diagnostic.severity;
			}

			if (
				typeof diagnostic.code === 'string'
				&& typeof rulesMeta[diagnostic.code] === 'object'
				&& rulesMeta[diagnostic.code]?.docs?.url !== undefined
			) {
				const href = rulesMeta?.[diagnostic.code].docs?.url;

				if (typeof href === 'string') {
					diagnostic.codeDescription = {
						href,
					};
				}
			} else {
				try {
					const href = getRuleUrl(diagnostic.code?.toString())?.url;
					if (typeof href === 'string') {
						diagnostic.codeDescription = {
							href,
						};
					}
				} catch {}
			}

			/**
			 * record a code action for applying fixes
			 */
			if (problem.fix !== undefined && problem.ruleId !== null && problem.ruleId !== '') {
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
					edit: problem.fix,
				});
			}

			// cache any suggestions for quick fix code actions
			if (problem.suggestions !== undefined && problem.suggestions.length > 0) {
				const {uri} = document;

				let edits = this.documentSuggestionsCache.get(uri);

				if (!edits) {
					edits = new Map();
					this.documentSuggestionsCache.set(uri, edits);
				}

				edits.set(utils.computeKey(diagnostic), problem.suggestions);
			}

			return diagnostic;
		});

		await this.connection.sendDiagnostics({
			uri: document.uri,
			version: document.version,
			diagnostics,
		});
	} catch (error: unknown) {
		this.documentFixCache.delete(document.uri);
		this.documentSuggestionsCache.delete(document.uri);

		try {
			await this.connection.sendDiagnostics({
				uri: document.uri,
				version: document.version,
				diagnostics: [],
			});
		} catch (cleanupError: unknown) {
			if (!this.hasReceivedShutdownRequest) {
				this.logError(cleanupError, `Failed to clear diagnostics for ${document.uri}`);
			}
		}

		this.reportError(error, `XO lint failed for ${document.uri}`, document.uri);
	}
}

/**
 * Enqueues a snapshot of open documents for serial linting after configuration
 * changes. Version checks discard stale snapshots, and lintDocument contains
 * recoverable failures so each returned queue promise completes normally.
 */
export async function lintDocuments(this: LintServer, documents: TextDocument[]): Promise<void> {
	for (const document of documents) {
		// The queue runtime awaits returned promises, although its legacy typings only declare void workers.
		// eslint-disable-next-line @typescript-eslint/strict-void-return
		this.queue.push(async () => {
			if (document.version !== this.documents.get(document.uri)?.version) {
				return;
			}

			await this.lintDocument(document);
		});
	}
}
