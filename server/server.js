const process = require('process');
const path = require('path');
const {
	createConnection,
	ProposedFeatures,
	TextDocuments,
	RequestType,
	TextDocumentSyncKind,
	Files,
	ResponseError,
	LSPErrorCodes
} = require('vscode-languageserver/node');
const {TextDocument} = require('vscode-languageserver-textdocument');
const {URI} = require('vscode-uri');
const autoBind = require('auto-bind');
const debounce = require('lodash.debounce');
const Queue = require('queue');
const loadJsonFile = require('load-json-file');
const isSANB = require('is-string-and-not-blank');
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

class Linter {
	constructor() {
		/**
		 * Bind all imported methods
		 */
		this.getDocumentConfig = getDocumentConfig.bind(this);
		this.getDocumentFixes = getDocumentFixes.bind(this);
		this.getDocumentFolder = getDocumentFolder.bind(this);
		this.getLintResults = getLintResults.bind(this);
		this.lintDocument = lintDocument.bind(this);
		this.lintDocuments = lintDocuments.bind(this);
		this.lintDocumentDebounced = debounce(this.lintDocument, DEFAULT_DEBOUNCE, {
			maxWait: 350
		});
		this.resolveXO = resolveXO.bind(this);
		this.log = log.bind(this);
		this.logError = logError.bind(this);
		/**
		 * Bind all methods
		 */
		autoBind(this);
		/**
		 * Connection
		 */
		this.connection = createConnection(ProposedFeatures.all);

		/**
		 * Documents
		 */
		this.documents = new TextDocuments(TextDocument);

		/**
		 * Set up queue which allows for
		 * async cancellations and processing notifications
		 * and requests in order
		 */
		this.queue = new Queue({concurrency: 1, autostart: true});

		/**
		 * setup documents listeners
		 */
		this.documents.onDidOpen(this.handleDocumentsOnDidOpen);
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
		 * initialize core helper objects
		 * - xoCache is a mapping of folderUris to the xo object from its node_modules
		 * - configurationCache is mapping of folders to their configurations
		 * - folders is an array of folderUris
		 */
		this.xoCache = new Map();
		this.configurationCache = new Map();
		this.foldersCache = new Map();
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
	 * @param {TextDocument} document
	 */
	isDocumentOpen(document) {
		return document?.uri && this.documents.get(document.uri);
	}

	/**
	 * handle connection.onInitialize
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
	 * handle connection.onDidChangeConfiguration
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
	 */
	async handleDidChangeWatchedFiles() {
		return this.lintDocuments(this.documents.all());
	}

	/**
	 * Handle custom all fixes request
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

					const {config} = await this.getDocumentConfig(params.textDocument);
					if (!config?.format?.enable) return resolve(null);
					// get fixes and send to client
					const fixes = await this.getDocumentFixes(params.textDocument.uri);
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
	 * Handle documents.onDidOpen
	 * async checks if cached xo version is current
	 * if not, delete the cache and force reloading
	 */
	async handleDocumentsOnDidOpen(event) {
		try {
			const {folder, config: {path: customUri} = {}} = await this.getDocumentConfig(event.document);
			if (isSANB(customUri)) return;
			if (!folder?.uri) return;
			if (!this.xoCache.has(folder.uri)) return;
			const folderPath = URI.parse(folder.uri).fsPath;
			const xo = this.xoCache.get(folder.uri);
			// TODO: use same mechanism as in resolveXO
			const xoDirPath = path.dirname(await Files.resolve('xo', undefined, folderPath));
			const {version} = await loadJsonFile(path.join(xoDirPath, 'package.json'));
			if (xo.version !== version) this.xoCache.delete(folder.uri);
		} catch (error) {
			this.logError(error);
		}
	}

	/**
	 * Handle documents.onDidChangeContent
	 * queues document content linting
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
	 */
	handleDocumentsOnDidClose(event) {
		const folders = new Set(
			new Set([...this.documents.all()].map((document) => path.dirname(document.uri)))
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

new Linter().listen();
