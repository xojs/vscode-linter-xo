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
	ErrorMessageTracker,
	DiagnosticSeverity,
	TextEdit,
	Range
} = require('vscode-languageserver/node');
const {TextDocument} = require('vscode-languageserver-textdocument');
const autoBind = require('auto-bind');
const {URI} = require('vscode-uri');
const debounce = require('lodash.debounce');
const loadJsonFile = require('load-json-file');
const utils = require('./utils');

const Fixes = require('./fixes');
const BufferedMessageQueue = require('./buffered-message-queue');

const sendDiagnosticsNotification = new NotificationType('xo/validate');

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
		this.codeActions = Object.create(null);

		/**
		 * Set up messageQueue which allows for
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

		// TODO: we need to properly re-initialize when these handlers
		// 		 are called currently they will miss some edge cases with updating
		// 		 xo and it would be good to get that handled
		this.connection.onDidChangeConfiguration(this.handleDidChangeConfiguration);
		this.connection.onDidChangeWatchedFiles(this.handleDidChangeWatchedFiles);
		this.connection.onRequest(
			new RequestType('textDocument/xo/allFixes'),
			this.handleAllFixesRequest
		);

		/**
		 * initialize core helper objects
		 * - xoCache is a mapping of folderUris to the xo object from its node_modules
		 * - folders is an array of folderUris
		 */
		this.xoCache = new Map();
		this.foldersCache = [];
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
	 * Set up messageQueue which allows for
	 * async cancellations and processing in order
	 */
	createQueue() {
		this.messageQueue = new BufferedMessageQueue(this.connection);

		/**
		 * Notification handler for document changes
		 */
		this.messageQueue.onNotification(
			sendDiagnosticsNotification,
			debounce((document) => this.lintDocument(document), 150, {maxWait: 350}),
			(document) => document.version
		);

		/**
		 * define a request handler for a
		 * document formatting request from vscode
		 */
		this.messageQueue.registerRequest(
			DocumentFormattingRequest.type,
			async (params) => {
				// ensure document is open
				if (
					!params?.textDocument?.uri ||
					!this.documents.get(params?.textDocument?.uri)
				)
					return null;
				// ensure format is enabled by the user
				if (!this.configurationCache)
					this.configurationCache =
						await this.connection.workspace.getConfiguration('xo');
				if (!this.configurationCache?.format?.enable) return null;
				// get fixes and send to client
				const fixes = await this.getFileFormattingFixes(
					params?.textDocument?.uri
				);
				return fixes?.edits;
			}
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
	handleDidChangeConfiguration(params) {
		this.configurationCache = params?.settings?.xo;
		this.overrideSeverity = this.configurationCache?.overrideSeverity;
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
		return this.getFileFormattingFixes(params.textDocument.uri);
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
	 */
	handleDocumentsOnDidChangeContent(event) {
		this.messageQueue.addNotificationMessage(
			sendDiagnosticsNotification,
			event.document,
			event.document.version
		);
	}

	/**
	 * Get xo from cache if it is there.
	 * Attempt to resolve from node_modules relative
	 * to the current working directory if it is not
	 */
	async resolveXO(document) {
		const folderUri = await this.getWorkspaceFolderUri(document);

		if (!folderUri) {
			const err = new Error(
				'Cannot lint: No folder found in workspace for this file.'
			);
			this.connection.console.error(err);
			throw err;
		}

		let xo = this.xoCache.get(folderUri);

		/**
		 * return early if we already have xo cached
		 */
		if (typeof xo?.lintText === 'function') return xo;

		const folderPath = URI.parse(folderUri).path;

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
	 * lints and sends diagnostics for multiple files
	 */
	async lintDocuments(documents) {
		const tracker = new ErrorMessageTracker();
		await Promise.all(
			documents.map(async (document) => {
				try {
					const diagnostics = await this.getDocumentDiagnostics(document);
					this.connection.sendDiagnostics({uri: document.uri, diagnostics});
				} catch (error) {
					if (error?.message) {
						const {fsPath} = URI.parse(document.uri);
						error.message = `${fsPath} ${error.message}`;
					}

					if (error?.message?.includes('Failed to resolve module'))
						error.message += '. Ensure that xo is installed.';
					this.connection.console.error(error?.stack);
					tracker.add(error?.message ? error.message : 'Unknown Error');
				}
			})
		);
		return tracker.sendErrors(this.connection);
	}

	/**
	 * lints and sends diagnostics for a single file
	 */
	async lintDocument(document) {
		try {
			if (!this.documents.get(document.uri)) return;
			const diagnostics = await this.getDocumentDiagnostics(document);
			this.connection.sendDiagnostics({uri: document.uri, diagnostics});
		} catch (error) {
			if (error?.message?.includes('Failed to resolve module'))
				error.message += '. Ensure that xo is installed.';
			this.connection.console.error(error?.stack);
			this.connection.window.showErrorMessage(
				error?.message ? error.message : 'Unknown Error'
			);
		}
	}

	/**
	 * get the workspace folderUri from a document
	 * caches workspace folders if needed
	 */
	async getWorkspaceFolderUri(document) {
		// first check this.foldersCache hasn't been cleared or unset for some reason
		if (!Array.isArray(this.foldersCache) || this.foldersCache.length === 0)
			this.foldersCache =
				(await this.connection.workspace.getWorkspaceFolders()) || [];

		let folderUri;

		// attempt to find the folder in the cache
		folderUri = this.foldersCache.find((workspaceFolder) =>
			document.uri.includes(workspaceFolder.uri)
		)?.uri;

		// if we can't find the folder in the cache - try 1 more time to reset the folders
		// and see if that helps if a new folder was added to the workspace.
		// We try to avoid resetting the folders if we can as a small optimization
		if (!folderUri) {
			this.foldersCache = await this.connection.workspace.getWorkspaceFolders();
			folderUri = this.foldersCache.find((workspaceFolder) =>
				document.uri.includes(workspaceFolder.uri)
			)?.uri;
		}

		return folderUri;
	}

	async getDocumentDiagnostics(document) {
		const xo = await this.resolveXO(document);

		const contents = document.getText();
		const {options} = this.configurationCache;
		const {fsPath} = URI.parse(document.uri);
		const folderUri = await this.getWorkspaceFolderUri(document);

		options.cwd = URI.parse(folderUri).fsPath;
		options.filename = fsPath;
		options.filePath = fsPath;

		// Clean previously computed code actions.
		this.codeActions[document.uri] = undefined;

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
			if (this.configurationCache?.overrideSeverity) {
				const mapSeverity = {
					off: diagnostic.severity,
					info: DiagnosticSeverity.Information,
					warn: DiagnosticSeverity.Warning,
					error: DiagnosticSeverity.Error
				};
				diagnostic.severity =
					mapSeverity[this.configurationCache.overrideSeverity] ||
					diagnostic.severity;
			}

			/**
			 * record a code action for applying fixes
			 */
			if (problem.fix && problem.ruleId) {
				const {uri} = document;
				let edits = this.codeActions[uri];
				if (!edits) {
					edits = Object.create(null);
					this.codeActions[uri] = edits;
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

	async getFileFormattingFixes(uri) {
		let result = null;
		const textDocument = this.documents.get(uri);
		const edits = this.codeActions[uri];
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
