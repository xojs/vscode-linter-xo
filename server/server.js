const process = require('process');
const {
	createConnection,
	ProposedFeatures,
	TextDocuments,
	RequestType,
	NotificationType,
	DocumentFormattingRequest,
	TextDocumentSyncKind,
	Files,
	DiagnosticSeverity,
	TextEdit,
	Range
} = require('vscode-languageserver/node');
const {TextDocument} = require('vscode-languageserver-textdocument');
const {URI} = require('vscode-uri');
const autoBind = require('auto-bind');
const debounce = require('lodash.debounce');
const loadJsonFile = require('load-json-file');
const utils = require('./utils');

const Fixes = require('./fixes');
const Queue = require('./queue');

const sendDiagnosticsNotification = new NotificationType('xo/validate');
const DEFAULT_DEBOUNCE = 150;

class Linter {
	constructor() {
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
		 * codeActions to apply on format request
		 */
		this.codeActions = new Map();

		/**
		 * Set up queue which allows for
		 * async cancellations and processing notifications
		 * and requests in order
		 */
		this.createQueue();

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
		this.connection.onRequest(
			new RequestType('textDocument/xo/allFixes'),
			this.handleAllFixesRequest
		);

		/**
		 * initialize core helper objects
		 * - xoCache is a mapping of folderUris to the xo object from its node_modules
		 * - configurationCache is mapping of folders to their configurations
		 * - folders is an array of folderUris
		 */
		this.xoCache = new Map();
		this.configurationCache = new Map();
		this.foldersCache = [];

		this.hasShownResolutionError = false;
		this.currentDebounce = DEFAULT_DEBOUNCE;
	}

	listen() {
		// Listen for text document create, change
		this.documents.listen(this.connection);
		this.connection.listen();
		this.connection.console.info(
			`XO Server Starting in Node ${process.version}`
		);
	}

	/**
	 * check if document is open
	 * @param {TextDocument} document
	 */
	isDocumentOpen(document) {
		return document?.uri && this.documents.get(document.uri);
	}

	/**
	 * Set up the queue which allows for
	 * async cancellations and processing in order
	 */
	createQueue() {
		this.queue = new Queue(this.connection);

		/**
		 * Notification handler for document changes
		 * sets up here with default debounce since
		 * configurations are not available yet
		 */
		this.queue.onNotification(
			sendDiagnosticsNotification,
			debounce(this.lintDocument, 150, {maxWait: 350}),
			(document) => document.version
		);

		/**
		 * define a request handler for a
		 * document formatting request from vscode
		 */
		this.queue.registerRequest(
			DocumentFormattingRequest.type,
			this.handleDocumentFormattingRequest
		);
	}

	/**
	 * log a message to the client console
	 * in a console.log type of way - primarily used
	 * for development and debugging
	 * @param  {...any} messages
	 */
	log(...messages) {
		this.connection.console.log(
			// eslint-disable-next-line unicorn/no-array-reduce
			messages.reduce((acc, message) => {
				if (message instanceof Map)
					message = `Map(${JSON.stringify([...message.entries()], null, 2)})`;
				if (typeof message === 'object')
					message = JSON.stringify(message, null, 2);
				// eslint-disable-next-line unicorn/prefer-spread
				return acc.concat(message + ' ');
			}, '')
		);
	}

	/**
	 * handle onInitialize
	 */
	async handleInitialize(params) {
		this.foldersCache = params.workspaceFolders;
		return {
			capabilities: {
				workspace: {
					workspaceFolders: {
						supported: true
					}
				},
				textDocumentSync: {
					openClose: true,
					change: TextDocumentSyncKind.Incremental,
					willSaveWaitUntil: false,
					save: {
						includeText: false
					}
				},
				documentFormattingProvider: true
			}
		};
	}

	/**
	 * handle onDidChangeConfiguration
	 */
	async handleDidChangeConfiguration(params) {
		this.log('params', params);
		if (
			Number.isInteger(Number(params?.settings?.xo?.debounce)) &&
			Number(params?.settings?.xo?.debounce) !== this.currentDebounce
		) {
			this.currentDebounce = params.settings.xo.debounce;
			this.queue.onNotification(
				sendDiagnosticsNotification,
				debounce(this.lintDocument, params.settings.xo.debounce),
				(document) => document.version
			);
		}

		this.configurationCache.clear();
		await Promise.all(
			this.foldersCache.map((folder) => this.getDocumentConfig(folder))
		);
		return this.lintDocuments(this.documents.all());
	}

	/**
	 * handle onDidChangeWatchedFiles
	 */
	handleDidChangeWatchedFiles() {
		return this.lintDocuments(this.documents.all());
	}

	/**
	 * Handle custom all fixes request
	 */
	async handleAllFixesRequest(params) {
		return this.getDocumentFixes(params.textDocument.uri);
	}

	/**
	 * Handle LSP document formatting request
	 */
	async handleDocumentFormattingRequest(params) {
		if (!this.isDocumentOpen(params.textDocument)) return null;
		const {config} = await this.getDocumentConfig(params.textDocument);
		if (!config?.format?.enable) return null;
		// get fixes and send to client
		const fixes = await this.getDocumentFixes(params.textDocument.uri);
		return fixes?.edits;
	}

	/**
	 * Handle documents.onDidClose
	 * Clears the diagnostics when document is closed
	 */
	handleDocumentsOnDidClose(event) {
		this.connection.sendDiagnostics({
			uri: event.document.uri,
			diagnostics: []
		});
	}

	/**
	 * Handle documents.onDidChangeContent
	 * queues document content linting
	 */
	async handleDocumentsOnDidChangeContent(event) {
		await this.queue.addNotificationMessage(
			sendDiagnosticsNotification,
			event.document,
			event.document.version
		);
	}

	/**
	 * Get xo from cache if it is there.
	 * Attempt to resolve from node_modules relative
	 * to the current working directory if it is not
	 * @param {TextDocument} document
	 */
	async resolveXO(document) {
		const {uri: folderUri} = await this.getDocumentFolder(document);
		let xo = this.xoCache.get(folderUri);

		if (typeof xo?.lintText === 'function') return xo;

		const folderPath = URI.parse(folderUri).fsPath;
		const xoPath = URI.file(
			await Files.resolve('xo', undefined, folderPath)
		).toString();

		// eslint-disable-next-line node/no-unsupported-features/es-syntax
		xo = await import(xoPath);

		if (!xo?.default?.lintText)
			throw new Error("The XO library doesn't export a lintText method.");

		try {
			// this is completely unnecessary but helps with debugging
			// and messages will likely be removed in future versions
			const pkg = await loadJsonFile(
				URI.parse(xoPath).path.replace('index.js', 'package.json')
			);
			xo.default.version = pkg.version;
		} catch (error) {
			this.connection.console.error(
				'There was a problem getting the xo version - this does not affect the use of this plugin.'
			);
			this.connection.console.error(error?.stack);
		}

		await this.connection.console.info(
			`XO Library ${xo.default.version} was successfully resolved and cached.`
		);

		this.xoCache.set(folderUri, xo.default);

		return xo.default;
	}

	/**
	 * helper to lint and sends diagnostics for multiple files
	 */
	async lintDocuments(documents) {
		for (const document of documents) {
			this.queue.addNotificationMessage(
				sendDiagnosticsNotification,
				document,
				document.version,
				true
			);
		}
	}

	/**
	 * lints and sends diagnostics for a single file
	 * @param {TextDocument} document
	 */
	async lintDocument(document) {
		try {
			if (!this.documents.get(document.uri)) return;
			const diagnostics = await this.getDocumentDiagnostics(document);
			this.connection.sendDiagnostics({uri: document.uri, diagnostics});
		} catch (error) {
			const isResolutionErr = error?.message?.includes(
				'Failed to resolve module'
			);

			if (!this.hasShownResolutionError && isResolutionErr) {
				error.message += '. Ensure that xo is installed.';
				this.connection.window.showErrorMessage(
					error?.message ? error.message : 'Unknown Error'
				);
				this.hasShownResolutionError = true;
			}

			if (!isResolutionErr)
				this.connection.window.showErrorMessage(
					error?.message ? error.message : 'Unknown Error'
				);

			this.connection.console.error(error?.stack);
		}
	}

	/**
	 * get the workspace folder document from a document
	 * caches workspace folders if needed
	 * @param {TextDocument} document
	 * @returns {TextDocument}
	 */
	async getDocumentFolder(document) {
		// first check this.foldersCache hasn't been cleared or unset for some reason
		if (!Array.isArray(this.foldersCache) || this.foldersCache.length === 0)
			this.foldersCache =
				(await this.connection.workspace.getWorkspaceFolders()) || [];

		let folder;

		// attempt to find the folder in the cache
		folder = this.foldersCache.find((workspaceFolder) =>
			document.uri.includes(workspaceFolder.uri)
		);

		// if we can't find the folder in the cache - try 1 more time to reset the folders
		// and see if that helps if a new folder was added to the workspace.
		// We try to avoid resetting the folders if we can as a small optimization
		if (!folder?.uri) {
			this.foldersCache =
				(await this.connection.workspace.getWorkspaceFolders()) || [];
			folder = this.foldersCache.find((workspaceFolder) =>
				document.uri.includes(workspaceFolder.uri)
			);
		}

		return folder;
	}

	/**
	 * Gets document folder and settings
	 * and caches them if needed
	 * @param {TextDocument} document
	 */
	async getDocumentConfig(document) {
		const folder = await this.getDocumentFolder(document);
		if (!folder) return {};
		if (this.configurationCache.has(folder.uri))
			return {
				folder,
				config: this.configurationCache.get(folder.uri)
			};
		const config = await this.connection.workspace.getConfiguration({
			scopeUri: folder.uri,
			section: 'xo'
		});
		this.configurationCache.set(folder.uri, config);
		return {
			folder,
			config
		};
	}

	async getDocumentDiagnostics(document) {
		// first we resolve all the configs we need
		const {
			folder: {uri: folderUri} = {},
			config: {options, overrideSeverity} = {}
		} = await this.getDocumentConfig(document);

		// if we can't find a valid folder, then the user
		// has likely opened a JS file from another location
		// so we will just bail out of linting early
		if (!folderUri) {
			const error = new Error(
				'No valid workspace folder could be found for this file. Skipping linting as it is an external JS file.'
			);
			this.connection.console.warn(error.stack);
			return [];
		}

		const xo = await this.resolveXO(document);

		const {fsPath: documentFsPath} = URI.parse(document.uri);
		const {fsPath: folderFsPath} = URI.parse(folderUri);
		const contents = document.getText();

		// set the options needed for internal xo config resolution
		options.cwd = folderFsPath;
		options.filename = documentFsPath;
		options.filePath = documentFsPath;

		// Clean previously computed code actions.
		this.codeActions.delete(document.uri);

		let report;
		const cwd = process.cwd();

		try {
			process.chdir(options.cwd);
			report = await xo.lintText(contents, options);
		} finally {
			if (cwd !== process.cwd()) {
				process.chdir(cwd);
			}
		}

		const {results} = report;

		if (results.length === 0 || !results[0].messages) return;

		return results[0].messages.map((problem) => {
			const diagnostic = utils.makeDiagnostic(problem);
			if (overrideSeverity) {
				const mapSeverity = {
					off: diagnostic.severity,
					info: DiagnosticSeverity.Information,
					warn: DiagnosticSeverity.Warning,
					error: DiagnosticSeverity.Error
				};
				diagnostic.severity =
					mapSeverity[overrideSeverity] || diagnostic.severity;
			}

			/**
			 * record a code action for applying fixes
			 */
			if (problem.fix && problem.ruleId) {
				const {uri} = document;
				let edits = this.codeActions.get(uri);
				if (!edits) {
					edits = Object.create(null);
					this.codeActions.set(uri, edits);
				}

				edits[utils.computeKey(diagnostic)] = {
					label: `Fix this ${problem.ruleId} problem`,
					documentVersion: document.version,
					ruleId: problem.ruleId,
					edit: problem.fix
				};
			}

			return diagnostic;
		});
	}

	async getDocumentFixes(uri) {
		let result = null;
		const textDocument = this.documents.get(uri);
		const edits = this.codeActions.get(uri);
		if (edits) {
			const fixes = new Fixes(edits);
			if (!fixes.isEmpty()) {
				result = {
					documentVersion: fixes.getDocumentVersion(),
					edits: fixes
						.getOverlapFree()
						.map((editInfo) =>
							TextEdit.replace(
								Range.create(
									textDocument.positionAt(editInfo.edit.range[0]),
									textDocument.positionAt(editInfo.edit.range[1])
								),
								editInfo.edit.text || ''
							)
						)
				};
			}
		}

		return result;
	}
}

new Linter().listen();
