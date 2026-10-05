import * as process from 'node:process';
import * as path from 'node:path';
import {
	type CodeAction,
	createConnection,
	ProposedFeatures,
	TextDocuments,
	RequestType,
	TextDocumentSyncKind,
	ResponseError,
	LSPErrorCodes,
	ErrorCodes,
	CodeActionKind,
	type TextEdit,
	type Connection,
	type InitializeResult,
	type DocumentFormattingParams,
	type CancellationToken,
	type TextDocumentIdentifier,
	type DidChangeConfigurationParams,
	type TextDocumentChangeEvent,
	type DocumentRangeFormattingParams,
} from 'vscode-languageserver/node';
import {TextDocument} from 'vscode-languageserver-textdocument';
import autoBind from 'auto-bind';
import Queue from 'queue';
import type {CodeActionParams} from 'vscode-languageclient';
import {QuickFixCodeActionsBuilder} from './code-actions-builder.ts';
import getDocumentConfig from './get-document-config.ts';
import getDocumentFormatting from './get-document-formatting.ts';
import getDocumentFolder from './get-document-folder.ts';
import getLintResults from './get-lint-results.ts';
import {lintDocument, lintDocuments} from './lint-document.ts';
import {log, logError} from './logger.ts';
import {
	getErrorFingerprint,
	getXoErrorSummary,
	isExpectedLspError,
	toError,
} from './errors.ts';
import resolveXo from './resolve-xo.ts';
import type {
	XoConfig,
	DocumentFix,
	Xo,
	XoFix,
	Linter,
} from './types.ts';

interface ChangeConfigurationParameters extends DidChangeConfigurationParams {
	settings: {xo: XoConfig};
}

class LintServer {
	readonly connection: Connection;
	readonly documents: TextDocuments<TextDocument>;
	readonly queue: Queue;
	log: typeof log;
	logError: typeof logError;
	getDocumentConfig: typeof getDocumentConfig;
	getDocumentFormatting: typeof getDocumentFormatting;
	getDocumentFolder: typeof getDocumentFolder;
	getLintResults: typeof getLintResults;
	lintDocument: typeof lintDocument;
	lintDocuments: typeof lintDocuments;
	resolveXo: typeof resolveXo;
	/**
	* A mapping of folders to the location of their package.json
	*/
	foldersCache: Map<string, Partial<TextDocument>>;
	/**
	* A mapping of document uri strings to configuration options
	*/
	configurationCache: Map<string, XoConfig>;
	/**
	* A mapping of folderPaths to the resolved XO module
	*/
	xoCache: Map<string, Xo>;
	/**
	* A mapping of document uri strings to their last calculated fixes
	*/
	documentFixCache: Map<string, Map<string, XoFix>>;
	/**
	* A mapping of document uri strings to their last calculated suggestions
	*/
	documentSuggestionsCache: Map<string, Map<string, Linter.LintSuggestion[]>>;
	/**
	 * Fingerprints already shown during this server session. Project-wide XO
	 * failures omit document identity so relinting several files stays quiet.
	 */
	shownErrorNotifications: Set<string>;
	/**
	* flag which helps gracefully stopping and shutting down
	*/
	hasReceivedShutdownRequest?: boolean;

	/**
	 * Creates the LSP connection, serial work queue, caches, and bound handlers
	 * used for one server process. Tests request stream-based transport but retain
	 * the same error and queue behavior as the production IPC connection.
	 */
	constructor({isTest}: {isTest?: boolean} = {}) {
		/**
		 * Bind all imported methods
		 */
		this.getDocumentConfig = getDocumentConfig.bind(this);

		this.getDocumentFormatting = getDocumentFormatting.bind(this);

		this.getDocumentFolder = getDocumentFolder.bind(this);

		this.getLintResults = getLintResults.bind(this);

		this.lintDocument = lintDocument.bind(this);

		this.lintDocuments = lintDocuments.bind(this);

		this.resolveXo = resolveXo.bind(this);

		this.log = log.bind(this);
		this.logError = logError.bind(this);

		/**
		 * Bind all methods
		 */
		autoBind(this);

		/**
		 * Connection
		 */
		this.connection = isTest
			? createConnection(process.stdin, process.stdout)
			: createConnection(ProposedFeatures.all);

		/**
		 * Documents
		 */
		this.documents = new TextDocuments(TextDocument);

		/**
		 * A message queue which allows for async cancellations and
		 * processing notifications and requests in order
		 */
		this.queue = new Queue({concurrency: 1, autostart: true});

		// let id = 0;

		// // get notified when jobs complete
		// this.queue.on('success', (result, job) => {
		// 	this.log('job finished processing:', job.name, job.id);
		// });

		// this.queue.on('error', (error, job) => {
		// 	this.logError(error as Error);
		// });

		// this.queue.on('start', (job) => {
		// 	job.id = id++;
		// 	this.log('job started processing:', job.name, job.id);
		// });

		/**
		 * setup documents listeners
		 */
		this.documents.onDidChangeContent(this.handleDocumentsOnDidChangeContent);
		this.documents.onDidClose(this.handleDocumentsOnDidClose);

		/**
		 * setup connection lifecycle listeners
		 */
		this.connection.onInitialize(this.handleInitialize);
		this.connection.onShutdown(this.handleShutdown);
		this.connection.onExit(this.exit);

		/**
		 * handle xo configuration changes
		 */
		this.connection.onDidChangeConfiguration(this.handleDidChangeConfiguration);

		/**
		 * handle document formatting requests
		 * - the built in "allFixes" request does not depend on configuration
		 * - the formatting request requires user to enable xo as formatter
		 */
		this.connection.onRequest(
			new RequestType('textDocument/xo/allFixes').method,
			this.handleAllFixesRequest,
		);
		this.connection.onDocumentFormatting(this.handleDocumentFormattingRequest);
		this.connection.onDocumentRangeFormatting(this.handleDocumentFormattingRequest);
		this.connection.onCodeAction(this.handleCodeActionRequest);

		/**
		* Caches
		*/
		this.xoCache = new Map();
		this.configurationCache = new Map();
		this.foldersCache = new Map();
		this.documentFixCache = new Map();
		this.documentSuggestionsCache = new Map();

		/**
		* Internal state
		*/
		this.shownErrorNotifications = new Set();
	}

	/**
	 * listen
	 *
	 * Start the language server connection and document event listeners
	 */
	listen() {
		this.connection.listen();
		// Listen for text document create, change
		this.documents.listen(this.connection);
		this.log(`XO Language Server Starting in Node ${process.version}`);
	}

	/**
	* check if document is open
	*/
	isDocumentOpen(document: TextDocument | TextDocumentIdentifier): boolean {
		return document.uri !== '' && this.documents.get(document.uri) !== undefined;
	}

	/**
	 * handle connection.onInitialize
	 */
	async handleInitialize(): Promise<InitializeResult> {
		return {
			capabilities: {
				workspace: {
					workspaceFolders: {
						supported: true,
					},
				},
				textDocumentSync: {
					openClose: true,
					change: TextDocumentSyncKind.Incremental,
				},
				documentFormattingProvider: true,
				documentRangeFormattingProvider: true,
				codeActionProvider: {
					codeActionKinds: [
						CodeActionKind.QuickFix,
						CodeActionKind.SourceFixAll,
						`${CodeActionKind.SourceFixAll}.xo`,
					],
				},
			},
		};
	}

	/**
	 * Invalidates editor settings and resolved XO modules before relinting every
	 * open document. Notification fingerprints are also reset because an
	 * in-process settings change may have corrected, then reintroduced, a failure.
	 */
	async handleDidChangeConfiguration(_parameters: ChangeConfigurationParameters) {
		this.configurationCache.clear();
		this.xoCache.clear();
		this.documentFixCache.clear();
		this.documentSuggestionsCache.clear();
		this.shownErrorNotifications.clear();
		return this.lintDocuments(this.documents.all());
	}

	/**
	 * Logs complete failure details and, for background work, emits at most one
	 * concise notification for the same workspace error. Expected LSP races are
	 * protocol control flow and bypass reporting. Explicit requests can leave the
	 * user-facing message to their protocol/client boundary, avoiding two popups.
	 */
	reportError(
		errorValue: unknown,
		context: string,
		documentUri?: string,
		shouldNotify = true,
	): Error {
		const error = toError(errorValue);
		if (isExpectedLspError(error)) {
			return error;
		}

		this.logError(error, context);
		if (!shouldNotify || this.hasReceivedShutdownRequest) {
			return error;
		}

		const workspace = documentUri === undefined
			? undefined
			: this.foldersCache.get(path.dirname(documentUri))?.uri;
		const fingerprint = getErrorFingerprint('xo', workspace, error);
		if (this.shownErrorNotifications.has(fingerprint)) {
			return error;
		}

		this.shownErrorNotifications.add(fingerprint);
		try {
			this.connection.window.showErrorMessage(getXoErrorSummary(error));
		} catch {}

		return error;
	}

	/**
	 * Serializes the custom fix-all calculation with lint work and guarantees the
	 * request settles for every JavaScript thrown value. The formatting helper
	 * always returns a DocumentFix, including its intentional empty result.
	 */
	async handleAllFixesRequest(parameters: {
		textDocument: TextDocumentIdentifier;
	}): Promise<DocumentFix> {
		return new Promise((resolve, reject) => {
			// The queue runtime awaits returned promises, although its legacy typings only declare void workers.
			// eslint-disable-next-line @typescript-eslint/strict-void-return
			this.queue.push(async () => {
				try {
					resolve(await this.getDocumentFormatting(parameters.textDocument.uri));
				} catch (error: unknown) {
					this.reportError(
						error,
						`XO fix-all failed for ${parameters.textDocument.uri}`,
						parameters.textDocument.uri,
						false,
					);
					reject(new ResponseError(
						ErrorCodes.InternalError,
						'XO could not calculate fixes. See the XO output for details.',
					));
				}
			});
		});
	}

	/**
	 * Serializes formatting with lint work, returning ordinary empty edits for a
	 * document that closed before execution. Typed cancellation and content races
	 * pass through without alarming logs; actual XO failures are logged in full
	 * and reduced to a stable protocol message for the client.
	 */
	async handleDocumentFormattingRequest(
		parameters: DocumentFormattingParams | DocumentRangeFormattingParams,
		token: CancellationToken,
	): Promise<TextEdit[]> {
		return new Promise((resolve, reject) => {
			// The queue runtime awaits returned promises, although its legacy typings only declare void workers.
			// eslint-disable-next-line @typescript-eslint/strict-void-return
			this.queue.push(async () => {
				try {
					if (!this.isDocumentOpen(parameters.textDocument)) {
						resolve([]);
						return;
					}

					if (token.isCancellationRequested) {
						throw new ResponseError(LSPErrorCodes.RequestCancelled, 'Request was cancelled');
					}

					const cachedTextDocument = this.documents.get(parameters.textDocument.uri);
					if (cachedTextDocument === undefined) {
						resolve([]);
						return;
					}

					const config = await this.getDocumentConfig(parameters.textDocument);
					if (config === undefined || !config?.format?.enable || !config.enable) {
						resolve([]);
						return;
					}

					const {edits, documentVersion} = await this.getDocumentFormatting(
						parameters.textDocument.uri,
						'range' in parameters ? parameters.range : undefined,
					);

					if (documentVersion !== cachedTextDocument.version) {
						throw new ResponseError(
							LSPErrorCodes.ContentModified,
							'Document version mismatch detected',
						);
					}

					resolve(edits);
				} catch (error: unknown) {
					const normalized = toError(error);
					if (isExpectedLspError(normalized)) {
						reject(normalized);
						return;
					}

					this.reportError(
						normalized,
						`XO formatting failed for ${parameters.textDocument.uri}`,
						parameters.textDocument.uri,
						false,
					);
					reject(new ResponseError(
						ErrorCodes.InternalError,
						'XO could not format this document. See the XO output for details.',
					));
				}
			});
		});
	}

	/**
	 * Calculates background code actions without allowing XO failures to become
	 * repetitive VS Code request popups. Closed documents and calculation errors
	 * produce no actions, while cancellation remains a typed protocol response.
	 * Every path settles before the serial queue advances.
	 */
	async handleCodeActionRequest(
		parameters: CodeActionParams,
		token?: CancellationToken,
	): Promise<CodeAction[] | undefined> {
		return new Promise<CodeAction[] | undefined>((resolve, reject) => {
			// The queue runtime awaits returned promises, although its legacy typings only declare void workers.
			// eslint-disable-next-line @typescript-eslint/strict-void-return
			this.queue.push(async () => {
				try {
					const {context} = parameters;
					if (context.diagnostics.length === 0 || parameters.textDocument.uri === '') {
						resolve(undefined);
						return;
					}

					if (token?.isCancellationRequested) {
						throw new ResponseError(LSPErrorCodes.RequestCancelled, 'Request got cancelled');
					}

					const document = this.documents.get(parameters.textDocument.uri);
					if (!document) {
						resolve(undefined);
						return;
					}

					const config = await this.getDocumentConfig(document);
					if (!config?.enable) {
						resolve(undefined);
						return;
					}

					const codeActions: CodeAction[] = [];
					const isFixAll = context.only?.includes(CodeActionKind.SourceFixAll);
					const isFixAllXo = context.only?.includes(`${CodeActionKind.SourceFixAll}.xo`);
					// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
					if (isFixAll || isFixAllXo) {
						const fixes = await this.getDocumentFormatting(parameters.textDocument.uri);
						codeActions.push({
							title: 'Fix all XO auto-fixable problems',
							kind: isFixAllXo ? `${CodeActionKind.SourceFixAll}.xo` : CodeActionKind.SourceFixAll,
							edit: {changes: {[document.uri]: fixes.edits}},
						});
					}

					if (context.only === undefined || context.only.includes(CodeActionKind.QuickFix)) {
						const codeActionBuilder = new QuickFixCodeActionsBuilder(
							document,
							context.diagnostics,
							this.documentFixCache.get(document.uri),
							this.documentSuggestionsCache.get(document.uri),
						);
						codeActions.push(...codeActionBuilder.build());
					}

					resolve(codeActions);
				} catch (error: unknown) {
					const normalized = toError(error);
					if (isExpectedLspError(normalized)) {
						reject(normalized);
						return;
					}

					this.reportError(
						normalized,
						`XO code-action calculation failed for ${parameters.textDocument.uri}`,
						parameters.textDocument.uri,
					);
					resolve([]);
				}
			});
		});
	}

	/**
	 * Queues current document changes for linting after the configured debounce.
	 * The queue observes the returned promise directly, while this boundary
	 * contains setup failures so an unusual thrown value cannot emit an unhandled
	 * rejection or stop later document work.
	 *
	 * @param event - The document change event whose current contents should be linted.
	 */
	handleDocumentsOnDidChangeContent(event: TextDocumentChangeEvent<TextDocument>) {
		// The queue runtime awaits returned promises, although its legacy typings only declare void workers.
		// eslint-disable-next-line @typescript-eslint/strict-void-return
		this.queue.push(async () => {
			try {
				if (event.document.version !== this.documents.get(event.document.uri)?.version) {
					return;
				}

				if (event.document.uri.includes('node_modules')) {
					this.log('skipping node_modules file');
					return;
				}

				const config = await this.getDocumentConfig(event.document);
				const {default: debounce} = await import('p-debounce');
				const debouncedFunc = debounce(this.lintDocument, config.debounce ?? 0).bind(this);
				await debouncedFunc(event.document);
			} catch (error: unknown) {
				this.reportError(
					error,
					`XO document-change handling failed for ${event.document.uri}`,
					event.document.uri,
				);
			}
		});
	}

	/**
	 * Handle documents.onDidClose
	 * Clears the diagnostics when document is closed and
	 * cleans up cached folders that no longer have open documents
	 */
	async handleDocumentsOnDidClose(event: TextDocumentChangeEvent<TextDocument>): Promise<void> {
		const folders = new Set(
			[...this.documents.all()].map(document => path.dirname(document.uri)),
		);

		this.documentFixCache.delete(event.document.uri);
		for (const folder of this.foldersCache.keys()) {
			if (folders.has(folder)) {
				continue;
			}

			this.foldersCache.delete(folder);
			this.xoCache.delete(folder);
			this.configurationCache.delete(folder);
		}

		await this.connection?.sendDiagnostics({
			uri: event.document.uri,
			diagnostics: [],
		});
	}

	/**
	 * Acknowledges the LSP shutdown request without waiting for queued lint work.
	 * The language client allows only two seconds for shutdown, while a valid XO
	 * lint can take longer; queued diagnostics are disposable because the client
	 * clears them and reopens documents after the replacement server starts.
	 */
	async handleShutdown() {
		this.log('XO Server received shutdown request');
		this.hasReceivedShutdownRequest = true;
		this.queue.end();
	}

	/**
	 * exit
	 *
	 * Handle server exit notification according to LSP spec
	 * https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/#exit
	 */
	async exit() {
		if (this.hasReceivedShutdownRequest) {
			this.log('XO Server exiting');
			// eslint-disable-next-line unicorn/no-process-exit
			process.exit(0);
		} else {
			this.log('XO Server exiting with error');
		}
	}
}

export default LintServer;
