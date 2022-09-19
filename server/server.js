const process = require('process');
const path = require('path');
const {
	createConnection,
	ProposedFeatures,
	TextDocuments,
	RequestType,
	TextDocumentSyncKind,
	ResponseError,
	LSPErrorCodes,
	TextEdit,
	Range
} = require('vscode-languageserver/node');
const {TextDocument} = require('vscode-languageserver-textdocument');
const autoBind = require('auto-bind');
const debounce = require('lodash.debounce');
const Queue = require('queue');
const utils = require('./utils');
const CodeActionsBuilder = require('./code-actions-builder');
const getDocumentConfig = require('./get-document-config');
const getDocumentFixes = require('./get-document-fixes');
const getDocumentFolder = require('./get-document-folder');
const getLintResults = require('./get-lint-results');
const {lintDocument, lintDocuments} = require('./lint-document');
const {log, logError} = require('./logger');
const resolveXO = require('./resolve-xo');

const DEFAULT_DEBOUNCE = 0;

class LintServer {
	constructor() {
		/**
		 * Bind all imported methods
		 */
		/** @type {import('./get-document-config')} */
		this.getDocumentConfig = getDocumentConfig.bind(this);

		/** @type {import('./get-document-fixes')} */
		this.getDocumentFixes = getDocumentFixes.bind(this);

		/** @type {import('./get-document-folder')} */
		this.getDocumentFolder = getDocumentFolder.bind(this);

		/** @type {import('./get-lint-results')} */
		this.getLintResults = getLintResults.bind(this);

		/** @type {import('./lint-document').lintDocument} */
		this.lintDocument = lintDocument.bind(this);

		/** @type {import('./lint-document').lintDocuments} */
		this.lintDocuments = lintDocuments.bind(this);

		/** @type {import('./lint-document').lintDocuments} */
		this.lintDocumentDebounced = debounce(this.lintDocument, DEFAULT_DEBOUNCE, {
			maxWait: 350
		});

		/** @type {import('./resolve-xo')} */
		this.resolveXO = resolveXO.bind(this);

		/** @type {import('./logger').log} */
		this.log = log.bind(this);

		/** @type {import('./logger').logError} */
		this.logError = logError.bind(this);

		/**
		 * Bind all methods
		 */
		autoBind(this);

		/**
		 * Connection
		 * @type {import('vscode-languageserver/node').Connection}
		 */
		this.connection = createConnection(ProposedFeatures.all);

		/**
		 * Documents
		 * @type {TextDocuments}
		 */
		this.documents = new TextDocuments(TextDocument);

		/**
		 * A message queue which allows for async cancellations and
		 * processing notifications and requests in order
		 *
		 * @type {Queue}
		 */
		this.queue = new Queue({concurrency: 1, autostart: true});

		/**
		 * setup documents listeners
		 */
		this.documents.onDidChangeContent(this.handleDocumentsOnDidChangeContent);
		this.documents.onDidClose(this.handleDocumentsOnDidClose);

		/**
		 * setup connection listeners
		 */
		this.connection.onInitialize(this.handleInitialize);

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
			new RequestType('textDocument/xo/allFixes'),
			this.handleAllFixesRequest
		);
		this.connection.onDocumentFormatting(this.handleDocumentFormattingRequest);
		this.connection.onCodeAction(this.handleCodeActionRequest);

		/**
		 * A mapping of folderPaths to the resolved XO module
		 * @type {Map<string, XO>}
		 */
		this.xoCache = new Map();

		/**
		 * A mapping of folderPaths to configuration options
		 * @type {Map<string, any>}
		 */
		this.configurationCache = new Map();

		/**
		 * A mapping of folders to the location of their package.json
		 * @type {Map<string, string>}
		 */
		this.foldersCache = new Map();

		/**
		 * A mapping of document uri strings to their last calculated fixes
		 * @type {Map<string, TextEdit[]>}
		 */
		this.documentEdits = new Map();

		this.hasShownResolutionError = false;
		this.currentDebounce = DEFAULT_DEBOUNCE;
	}

	listen() {
		// Listen for text document create, change
		this.documents.listen(this.connection);
		this.connection.listen();
		this.connection.console.info(`XO Server Starting in Node ${process.version}`);
	}

	/**
	 * check if document is open
	 *
	 * @param {TextDocument} document
	 * @returns {boolean} is `true` if document is currently open in the editor, `false` otherwise
	 */
	isDocumentOpen(document) {
		return document?.uri && this.documents.get(document.uri);
	}

	/**
	 * handle connection.onInitialize
	 *
	 * @returns {import('vscode-languageserver/node').InitializeParams}
	 */
	async handleInitialize() {
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
				codeActionProvider: true
			}
		};
	}

	/**
	 * Handle connection.onDidChangeConfiguration
	 *
	 * @type {import('vscode-languageserver/node').NotificationHandler}
	 * @param {import('vscode-languageserver/node').DidChangeConfigurationParams} params
	 */
	async handleDidChangeConfiguration(params) {
		if (
			Number.isInteger(Number(params?.settings?.xo?.debounce)) &&
			Number(params?.settings?.xo?.debounce) !== this.currentDebounce
		) {
			this.currentDebounce = params.settings.xo.debounce;
			this.lintDocumentDebounced = debounce(this.lintDocument, params.settings.xo.debounce, {
				maxWait: 350
			});
		}

		// recache each folder config
		this.configurationCache.clear();
		return this.lintDocuments(this.documents.all());
	}

	/**
	 * handle connection.onDidChangeWatchedFiles
	 *
	 * @type {import('vscode-languageserver/node').NotificationHandler}
	 * @returns {Promise<void>}
	 */
	async handleDidChangeWatchedFiles() {
		return this.lintDocuments(this.documents.all());
	}

	/**
	 * Handle custom all fixes request
	 *
	 * @type {import('vscode-languageserver/node').ServerRequestHandler}
	 */
	async handleAllFixesRequest(params) {
		return new Promise((resolve, reject) => {
			this.queue.push(async () => {
				try {
					const fixes = await this.getDocumentFixes(params.textDocument.uri);
					resolve(fixes);
				} catch (error) {
					reject(error);
				}
			});
		});
	}

	/**
	 * Handle LSP document formatting request
	 *
	 * @type {import('vscode-languageserver/node').ServerRequestHandler}
	 * @param {import('vscode-languageserver/node').DocumentFormattingParams} params
	 * @param {import('vscode-languageserver/node').CancellationToken} token
	 */
	async handleDocumentFormattingRequest(params, token) {
		return new Promise((resolve, reject) => {
			this.queue.push(async () => {
				try {
					if (!this.isDocumentOpen(params.textDocument)) return null;

					if (token.isCancellationRequested) {
						return reject(
							new ResponseError(LSPErrorCodes.RequestCancelled, 'Request got cancelled')
						);
					}

					if (
						params.textDocument.version &&
						params.textDocument.version !== this.documents.get(params.textDocument.uri).version
					) {
						return reject(
							new ResponseError(LSPErrorCodes.RequestCancelled, 'Request got cancelled')
						);
					}

					const config = await this.getDocumentConfig(params.textDocument);
					if (!config?.format?.enable) return resolve(null);

					// get fixes and send to client
					const fixes = await this.getDocumentFixes(params.textDocument.uri);

					if (!fixes?.edits) return resolve();

					/** @type {TextDocument} */
					const cachedTextDocument = this.documents.get(params.textDocument.uri);

					const originalText = cachedTextDocument.getText();

					// clone the cached document
					const textDocument = TextDocument.create(
						cachedTextDocument.uri,
						cachedTextDocument.languageId,
						cachedTextDocument.version,
						originalText
					);

					// apply the edits to the copy and get the edits that would be
					// further needed for all the fixes to work.
					const editedContent = TextDocument.applyEdits(textDocument, fixes.edits);

					const report = await this.getLintResults(textDocument, editedContent, true);

					if (report.results[0].output && report.results[0].output !== editedContent) {
						this.log('Experimental replace triggered');
						const string0 = originalText;
						const string1 = report.results[0].output;

						let i = 0;
						while (i < string0.length && i < string1.length && string0[i] === string1[i]) {
							++i;
						}

						// length of common suffix
						let j = 0;
						while (
							i + j < string0.length &&
							i + j < string1.length &&
							string0[string0.length - j - 1] === string1[string1.length - j - 1]
						) {
							++j;
						}

						// eslint-disable-next-line unicorn/prefer-string-slice
						const newText = string1.substring(i, string1.length - j);
						const pos0 = cachedTextDocument.positionAt(i);
						const pos1 = cachedTextDocument.positionAt(string0.length - j);

						return resolve([TextEdit.replace(Range.create(pos0, pos1), newText)]);
					}

					resolve(fixes?.edits);
				} catch (error) {
					this.logError(error);
					reject(error);
				}
			});
		});
	}

	/**
	 * Handle LSP code action request
	 * these happen at the time of an error/warning hover
	 *
	 * @type {import('vscode-languageserver/node').ServerRequestHandler}
	 * @param {import('vscode-languageserver/node').CodeActionParams} params
	 * @param {import('vscode-languageserver/node').CancellationToken} token
	 */
	async handleCodeActionRequest(params, token) {
		return new Promise((resolve, reject) => {
			this.queue.push(async () => {
				try {
					if (!params.context?.diagnostics?.length) return resolve();
					if (!params?.textDocument?.uri) return resolve();
					if (token.isCancellationRequested) {
						return reject(
							new ResponseError(LSPErrorCodes.RequestCancelled, 'Request got cancelled')
						);
					}

					if (
						params.textDocument.version &&
						params.textDocument.version !== this.documents.get(params.textDocument.uri).version
					) {
						return reject(
							new ResponseError(LSPErrorCodes.RequestCancelled, 'Request got cancelled')
						);
					}

					const [diagnostic] = params.context.diagnostics;
					const documentEdits = this.documentEdits.get(params.textDocument.uri);
					const textDocument = this.documents.get(params.textDocument.uri);
					const edit = documentEdits?.get(utils.computeKey(diagnostic));

					const codeActionBuilder = new CodeActionsBuilder({
						diagnostic,
						edit,
						textDocument
					});

					resolve(codeActionBuilder.build());
				} catch (error) {
					this.logError(error);
					reject(error);
				}
			});
		});
	}

	/**
	 * Handle documents.onDidChangeContent
	 * queues document content linting
	 * @param {import('vscode-languageserver/node').TextDocumentChangeEvent} event
	 */
	handleDocumentsOnDidChangeContent(event) {
		this.queue.push(async () => {
			try {
				if (event.document.version !== this.documents.get(event.document.uri).version) return;

				await this.lintDocumentDebounced(event.document);
			} catch (error) {
				this.logError(error);
			}
		});
	}

	/**
	 * Handle documents.onDidClose
	 * Clears the diagnostics when document is closed and
	 * cleans up cached folders that no longer have open documents
	 *
	 * @param {import('vscode-languageserver/node').TextDocumentChangeEvent} event
	 */
	handleDocumentsOnDidClose(event) {
		const folders = new Set(
			[...this.documents.all()].map((document) => path.dirname(document.uri))
		);

		for (const folder of this.foldersCache.keys()) {
			if (!folders.has(folder)) {
				this.foldersCache.delete(folder);
				this.xoCache.delete(folder);
				this.configurationCache.delete(folder);
			}
		}

		this.connection.sendDiagnostics({
			uri: event.document.uri,
			diagnostics: []
		});
	}
}

new LintServer().listen();

module.exports = {LintServer};
