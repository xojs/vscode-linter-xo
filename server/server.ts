import * as process from 'node:process';
import * as path from 'node:path';
import {
	createConnection,
	ProposedFeatures,
	TextDocuments,
	RequestType,
	TextDocumentSyncKind,
	ResponseError,
	LSPErrorCodes,
	CodeActionKind,
	type TextEdit,
	type Connection,
	type InitializeResult,
	type DocumentFormattingParams,
	type CancellationToken,
	type TextDocumentIdentifier,
	type DidChangeConfigurationParams,
	type TextDocumentChangeEvent,
	type CodeAction,
	type DocumentRangeFormattingParams
} from 'vscode-languageserver/node';
import {TextDocument} from 'vscode-languageserver-textdocument';
import autoBind from 'auto-bind';
import Queue from 'queue';
import {type CodeActionParams} from 'vscode-languageclient';
import {QuickFixCodeActionsBuilder} from './code-actions-builder.js';
import getDocumentConfig from './get-document-config.js';
import getDocumentFormatting from './get-document-formatting.js';
import getDocumentFolder from './get-document-folder';
import getLintResults from './get-lint-results.js';
import {lintDocument, lintDocuments} from './lint-document.js';
import {log, logError} from './logger';
import resolveXo from './resolve-xo';
import {type XoConfig, type DocumentFix, type Xo, type XoFix} from './types';

interface ChangeConfigurationParams extends DidChangeConfigurationParams {
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
	/** A mapping of folders to the location of their package.json */
	foldersCache: Map<string, Partial<TextDocument>>;
	/** A mapping of document uri strings to configuration options */
	configurationCache: Map<string, XoConfig>;
	/** A mapping of folderPaths to the resolved XO module */
	xoCache: Map<string, Xo>;
	/** A mapping of document uri strings to their last calculated fixes */
	documentFixCache: Map<string, Map<string, XoFix>>;
	/** Only show resolution errors one time per session */
	hasShownResolutionError: boolean;
	hasReceivedShutdownRequest?: boolean;

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
		 * handle workspace and xo configuration changes
		 */
		this.connection.onDidChangeConfiguration(this.handleDidChangeConfiguration);
		this.connection.onDidChangeWatchedFiles(this.handleDidChangeWatchedFiles);

		/**
		 * handle document formatting requests
		 * - the built in "allFixes" request does not depend on configuration
		 * - the formatting request requires user to enable xo as formatter
		 */
		this.connection.onRequest(
			new RequestType('textDocument/xo/allFixes').method,
			this.handleAllFixesRequest
		);
		this.connection.onDocumentFormatting(this.handleDocumentFormattingRequest);
		this.connection.onDocumentRangeFormatting(this.handleDocumentFormattingRequest);
		this.connection.onCodeAction(this.handleCodeActionRequest);

		/** Caches */
		this.xoCache = new Map();
		this.configurationCache = new Map();
		this.foldersCache = new Map();
		this.documentFixCache = new Map();

		/** Internal state */
		this.hasShownResolutionError = false;
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
	 *
	 */
	isDocumentOpen(document: TextDocument | TextDocumentIdentifier): boolean {
		return Boolean(document?.uri && this.documents.get(document.uri));
	}

	/**
	 * handle connection.onInitialize
	 */
	async handleInitialize(): Promise<InitializeResult> {
		return {
			capabilities: {
				workspace: {
					workspaceFolders: {
						supported: true
					}
				},
				textDocumentSync: {
					openClose: true,
					change: TextDocumentSyncKind.Incremental
				},
				documentFormattingProvider: true,
				documentRangeFormattingProvider: true,
				codeActionProvider: {
					codeActionKinds: [CodeActionKind.QuickFix, CodeActionKind.SourceFixAll]
				}
			}
		};
	}

	/**
	 * Handle connection.onDidChangeConfiguration
	 */
	async handleDidChangeConfiguration(params: ChangeConfigurationParams) {
		// recache each folder config
		this.configurationCache.clear();
		return this.lintDocuments(this.documents.all());
	}

	/**
	 * handle connection.onDidChangeWatchedFiles
	 */
	async handleDidChangeWatchedFiles() {
		await this.connection.sendRequest('workspace/xo/restart');
	}

	/**
	 * Handle custom all fixes request
	 */
	async handleAllFixesRequest(params: {
		textDocument: TextDocumentIdentifier;
	}): Promise<DocumentFix | void> {
		return new Promise((resolve, reject) => {
			this.queue.push(async () => {
				try {
					const documentFix = await this.getDocumentFormatting(params.textDocument.uri);

					if (documentFix === undefined) {
						resolve();
						return;
					}

					resolve(documentFix);
				} catch (error: unknown) {
					if (error instanceof Error) {
						reject(error);
					}
				}
			});
		});
	}

	/**
	 * Handle LSP document formatting request
	 */
	async handleDocumentFormattingRequest(
		params: DocumentFormattingParams | DocumentRangeFormattingParams,
		token: CancellationToken
	): Promise<TextEdit[]> {
		return new Promise((resolve, reject) => {
			const documentFormattingRequestHandler = async () => {
				try {
					if (!this.isDocumentOpen(params.textDocument)) return;

					if (token.isCancellationRequested) {
						reject(new ResponseError(LSPErrorCodes.RequestCancelled, 'Request was cancelled'));
						return;
					}

					const cachedTextDocument = this.documents.get(params.textDocument.uri);

					if (cachedTextDocument === undefined) {
						resolve([]);
						return;
					}

					const config = await this.getDocumentConfig(params.textDocument);

					if (config === undefined || !config?.format?.enable || !config.enable) {
						resolve([]);
						return;
					}

					const {edits, documentVersion} = await this.getDocumentFormatting(
						params.textDocument.uri,
						'range' in params ? params.range : undefined
					);

					if (documentVersion !== cachedTextDocument.version) {
						throw new ResponseError(
							LSPErrorCodes.ContentModified,
							'Document version mismatch detected'
						);
					}

					resolve(edits);
				} catch (error: unknown) {
					if (error instanceof Error) {
						this.logError(error);
						reject(error);
					}
				}
			};

			this.queue.push(documentFormattingRequestHandler);
		});
	}

	/**
	 * handleCodeActionRequest
	 *
	 * Handle LSP code action requests
	 * that happen at the time of an error/warning hover
	 * or code action menu request
	 */
	async handleCodeActionRequest(
		params: CodeActionParams,
		token?: CancellationToken
	): Promise<CodeAction[] | undefined> {
		return new Promise<CodeAction[] | undefined>((resolve, reject) => {
			const codeActionRequestHandler = async () => {
				try {
					const {context} = params;
					if (!context?.diagnostics?.length) {
						resolve(undefined);
						return;
					}

					if (!params?.textDocument?.uri) {
						resolve(undefined);
						return;
					}

					if (token?.isCancellationRequested) {
						reject(new ResponseError(LSPErrorCodes.RequestCancelled, 'Request got cancelled'));
						return;
					}

					const document = this.documents.get(params.textDocument.uri);

					if (!document) {
						resolve(undefined);
						return;
					}

					const config = await this.getDocumentConfig(document);

					if (config === undefined || !config.enable) {
						resolve(undefined);
						return;
					}

					const codeActions: CodeAction[] = [];
					if (
						context.only?.includes(CodeActionKind.SourceFixAll) || // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing
						context.only?.includes(`${CodeActionKind.SourceFixAll}.xo`)
					) {
						const fixes = await this.getDocumentFormatting(params.textDocument.uri);
						const codeAction: CodeAction = {
							title: 'Fix all XO auto-fixable problems',
							kind: CodeActionKind.SourceFixAll,
							edit: {
								changes: {
									[document.uri]: fixes.edits
								}
							}
						};
						codeActions.push(codeAction);
					}

					if (!context.only || context.only?.includes(CodeActionKind.QuickFix)) {
						const codeActionBuilder = new QuickFixCodeActionsBuilder(
							document,
							context.diagnostics,
							this.documentFixCache.get(document.uri)
						);
						codeActions.push(...codeActionBuilder.build());
					}

					resolve(codeActions);
				} catch (error: unknown) {
					if (error instanceof Error) {
						this.logError(error);
						reject(error);
					}
				}
			};

			this.queue.push(codeActionRequestHandler);
		});
	}

	/**
	 * Handle documents.onDidChangeContent
	 * queues document content linting
	 * @param {TextDocumentChangeEvent} event
	 */
	handleDocumentsOnDidChangeContent(event: TextDocumentChangeEvent<TextDocument>) {
		const onDidChangeContentHandler = async () => {
			try {
				if (event.document.version !== this.documents.get(event.document.uri)?.version) return;

				if (event.document.uri.includes('node_modules')) {
					this.log('skipping node_modules file');
					return;
				}

				const config = await this.getDocumentConfig(event.document);
				const {default: debounce} = await import('p-debounce');
				await debounce(this.lintDocument, config.debounce ?? 0)(event.document);
			} catch (error: unknown) {
				if (error instanceof Error) this.logError(error);
			}
		};

		this.queue.push(onDidChangeContentHandler);
	}

	/**
	 * Handle documents.onDidClose
	 * Clears the diagnostics when document is closed and
	 * cleans up cached folders that no longer have open documents
	 */
	async handleDocumentsOnDidClose(event: TextDocumentChangeEvent<TextDocument>): Promise<void> {
		const folders = new Set(
			[...this.documents.all()].map((document) => path.dirname(document.uri))
		);

		this.documentFixCache.delete(event.document.uri);
		for (const folder of this.foldersCache.keys()) {
			if (!folders.has(folder)) {
				this.foldersCache.delete(folder);
				this.xoCache.delete(folder);
				this.configurationCache.delete(folder);
			}
		}

		await this.connection?.sendDiagnostics({
			uri: event.document.uri.toString(),
			diagnostics: []
		});
	}

	async handleShutdown() {
		this.log('XO Server recieved shut down request');
		this.hasReceivedShutdownRequest = true;
		this.queue.end();
		this.connection.dispose();
	}

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
