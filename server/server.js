const process = require('process');
const path = require('path');
const {
	createConnection,
	ProposedFeatures,
	TextDocuments,
	RequestType,
	TextDocumentSyncKind,
	Files,
	DiagnosticSeverity,
	TextEdit,
	Range,
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
const pkgDir = require('pkg-dir');
const getRuleUrl = require('eslint-rule-docs');
const utils = require('./utils');
const Fixes = require('./fixes');
const CodeActionsBuilder = require('./code-actions');

const DEFAULT_DEBOUNCE = 0;

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
		this.lintDocumentDebounced = debounce(this.lintDocument, DEFAULT_DEBOUNCE, {
			maxWait: 350
		});

		/**
		 * initialize core helper objects
		 * - xoCache is a mapping of folderUris to the xo object from its node_modules
		 * - configurationCache is mapping of folders to their configurations
		 * - folders is an array of folderUris
		 */
		this.xoCache = new Map();
		this.configurationCache = new Map();
		this.errorOptionsCache = new Map();
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
	 * log a message to the client console
	 * in a console.log type of way - primarily used
	 * for development and debugging
	 * @param  {...any} messages
	 */
	log(...messages) {
		const ts = Date.now();
		this.connection.console.log(
			// eslint-disable-next-line unicorn/no-array-reduce
			messages.reduce((acc, message) => {
				if (message instanceof Map)
					message = `Map(${JSON.stringify([...message.entries()], null, 2)})`;
				if (typeof message === 'object')
					message = JSON.stringify(message, null, 2);
				// eslint-disable-next-line unicorn/prefer-spread
				return acc.concat(message + ' ');
			}, `[${ts}] `)
		);
	}

	logError(error) {
		this.connection.console.error(
			error?.message ? error.message : 'Unknown Error'
		);
	}

	/**
	 * handle onInitialize
	 */
	async handleInitialize(params) {
		this.foldersCache = params.workspaceFolders || [];
		// cache as early as possible
		try {
			await Promise.all(
				this.foldersCache.map((folder) => this.resolveXO(folder))
			);
		} catch {}

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
	 * handle onDidChangeConfiguration
	 */
	async handleDidChangeConfiguration(params) {
		if (
			Number.isInteger(Number(params?.settings?.xo?.debounce)) &&
			Number(params?.settings?.xo?.debounce) !== this.currentDebounce
		) {
			this.currentDebounce = params.settings.xo.debounce;
			this.lintDocumentDebounced = debounce(
				this.lintDocument,
				params.settings.xo.debounce,
				{maxWait: 350}
			);
		}

		// recache each folder config
		this.configurationCache.clear();
		await Promise.all(
			this.foldersCache.map((folder) => this.getDocumentConfig(folder))
		);
		return this.lintDocuments(this.documents.all());
	}

	/**
	 * handle onDidChangeWatchedFiles
	 */
	async handleDidChangeWatchedFiles(params) {
		for (const document of params.changes) {
			try {
				// eslint-disable-next-line no-await-in-loop
				const folder = await this.getDocumentFolder(document);
				if (this.errorOptionsCache.has(folder.uri))
					this.errorOptionsCache.delete(folder.uri);
				// eslint-disable-next-line no-await-in-loop
				await this.getDocumentErrorOptions(document);
			} catch (error) {
				this.logError(error);
			}
		}

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
							new ResponseError(
								LSPErrorCodes.RequestCancelled,
								'Request got cancelled'
							)
						);
					}

					if (
						params.textDocument.version &&
						params.textDocument.version !==
							this.documents.get(params.textDocument.uri).version
					) {
						return reject(
							new ResponseError(
								LSPErrorCodes.RequestCancelled,
								'Request got cancelled'
							)
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
							new ResponseError(
								LSPErrorCodes.RequestCancelled,
								'Request got cancelled'
							)
						);
					}

					if (
						params.textDocument.version &&
						params.textDocument.version !==
							this.documents.get(params.textDocument.uri).version
					) {
						return reject(
							new ResponseError(
								LSPErrorCodes.RequestCancelled,
								'Request got cancelled'
							)
						);
					}

					const [diagnostic] = params.context.diagnostics;
					const documentEdits = this.codeActions.get(params.textDocument.uri);
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
			const {folder, config: {path: customUri} = {}} =
				await this.getDocumentConfig(event.document);
			if (isSANB(customUri)) return;
			if (!folder?.uri) return;
			if (!this.xoCache.has(folder.uri)) return;
			const folderPath = URI.parse(folder.uri).fsPath;
			const xo = this.xoCache.get(folder.uri);
			// TODO: use same mechanism as in resolveXO
			const xoDirPath = path.dirname(
				await Files.resolve('xo', undefined, folderPath)
			);
			const {version} = await loadJsonFile(
				path.join(xoDirPath, 'package.json')
			);
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
				if (
					event.document.version !==
					this.documents.get(event.document.uri).version
				)
					return;

				await this.lintDocumentDebounced(event.document);
			} catch (error) {
				this.logError(error);
			}
		});
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
	 * get the folder error options
	 * cache them if needed
	 * @param {TextDocument} document
	 */
	async getDocumentErrorOptions(document, newOptions) {
		try {
			const {uri: folderUri} = await this.getDocumentFolder(document);
			if (this.errorOptionsCache.has(folderUri)) {
				const errorOptions = {
					...this.errorOptionsCache.get(folderUri),
					...(typeof newOptions === 'undefined' ? {} : newOptions)
				};
				this.errorOptionsCache.set(folderUri, errorOptions);
				return errorOptions;
			}

			const folderPath = URI.parse(folderUri).fsPath;
			const pkg = await loadJsonFile(path.join(folderPath, 'package.json'));

			try {
				if (pkg?.dependencies?.xo || pkg?.devDependencies?.xo) {
					this.errorOptionsCache.set(folderUri, {
						...(this.errorOptionsCache.has(folderUri)
							? this.errorOptionsCache.get(folderUri)
							: {}),
						...(typeof newOptions === 'undefined' ? {} : newOptions),
						showResolutionError: true
					});
				} else if (this.errorOptionsCache.has(folderUri))
					this.errorOptionsCache.delete(folderUri);
			} catch (error) {
				if (this.errorOptionsCache.has(folderUri))
					this.errorOptionsCache.delete(folderUri);

				this.logError(error);
			}

			return this.errorOptionsCache.get(folderUri);
		} catch (error) {
			this.logError(error);
		}
	}

	/**
	 * Get xo from cache if it is there.
	 * Attempt to resolve from node_modules relative
	 * to the current working directory if it is not
	 * @param {TextDocument} document
	 */
	async resolveXO(document) {
		const {folder: {uri: folderUri} = {}, config: {path: customPath} = {}} =
			await this.getDocumentConfig(document);

		let xo = this.xoCache.get(folderUri);

		if (typeof xo?.lintText === 'function') return xo;

		// determine whether we should show resolution errors first
		await this.getDocumentErrorOptions(document);
		const folderPath = URI.parse(folderUri).fsPath;

		let xoUri;
		let xoFilePath;
		const useCustomPath = isSANB(customPath);
		if (!useCustomPath) {
			xoFilePath = await Files.resolve('xo', undefined, folderPath);
			xoUri = URI.file(xoFilePath).toString();
		} else if (useCustomPath && customPath.startsWith('file://')) {
			xoUri = customPath;
			this.connection.console.warn(
				'Using a file uri for "xo.path" setting is deprecated and will be removed in the future, please provide an absolute or relative path to the file.'
			);
		} else if (useCustomPath && path.isAbsolute(customPath)) {
			xoUri = URI.file(customPath).toString();
		} else if (useCustomPath && !path.isAbsolute(customPath)) {
			xoUri = URI.file(path.join(folderPath, customPath)).toString();
		} else {
			throw new Error(
				`Unknown path format “${customPath}”: Needs to start with “/”, “./”, or "../"`
			);
		}

		let version;

		[xo, {version}] = await Promise.all([
			import(xoUri),
			xoFilePath
				? loadJsonFile(path.join(path.dirname(xoFilePath), 'package.json'))
				: Promise.resolve({version: 'custom'})
		]);

		if (!xo?.default?.lintText)
			throw new Error("The XO library doesn't export a lintText method.");

		xo.default.version = version;

		await this.connection.console.info(
			`XO Library ${xo.default.version} was successfully resolved and cached for ${folderPath}.`
		);

		this.xoCache.set(folderUri, xo.default);

		return xo.default;
	}

	/**
	 * helper to lint and sends diagnostics for multiple files
	 */
	async lintDocuments(documents) {
		for (const document of documents) {
			this.queue.push(async () => {
				if (document.version !== this.documents.get(document.uri).version)
					return;

				await this.lintDocument(document);
			});
		}
	}

	/**
	 * lints and sends diagnostics for a single file
	 * @param {TextDocument} document
	 */
	async lintDocument(document) {
		try {
			const currentDocument = this.documents.get(document.uri);
			if (!currentDocument) return;

			if (document.version !== currentDocument.version) {
				return null;
			}

			const diagnostics = await this.getDocumentDiagnostics(document);
			this.connection.sendDiagnostics({
				uri: document.uri,
				version: document.version,
				diagnostics
			});
		} catch (error) {
			/**
			 * only show resolution errors if package.json has xo listed
			 * as a dependency. Only show the error 1 time per folder.
			 */
			const isResolutionErr = error?.message?.includes(
				'Failed to resolve module'
			);

			if (isResolutionErr) {
				const errorOptions = await this.getDocumentErrorOptions(document);

				if (
					errorOptions?.showResolutionError &&
					!errorOptions?.hasShownResolutionError
				) {
					error.message += '. Ensure that xo is installed.';
					this.connection.window.showErrorMessage(
						error?.message ? error.message : 'Unknown Error'
					);
					this.getDocumentErrorOptions(document, {
						hasShownResolutionError: true
					});
				}
			}

			if (!isResolutionErr)
				this.connection.window.showErrorMessage(
					error?.message ? error.message : 'Unknown Error'
				);

			this.logError(error);
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

		// if still no folder is found then we
		// attempt to find the nearest package.json and set that
		// as the dir
		if (!folder?.uri) {
			const documentPath = URI.parse(document.uri).fsPath;
			const documentDir = path.dirname(documentPath);
			const packageDir = await pkgDir(documentDir);
			if (!packageDir) return undefined;
			folder = {uri: URI.file(packageDir).toString()};
			this.foldersCache.push(folder);
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

	async getLintResults(document, {contents} = {}) {
		// first we resolve all the configs we need
		const {folder: {uri: folderUri} = {}, config: {options} = {}} =
			await this.getDocumentConfig(document);

		// if we can't find a valid folder, then the user
		// has likely opened a JS file from another location
		// so we will just bail out of linting early
		if (!folderUri) {
			const error = new Error(
				'No valid workspace folder could be found for this file. Skipping linting as it is an external JS file.'
			);
			this.logError(error);
			return [];
		}

		const xo = await this.resolveXO(document);

		const {fsPath: documentFsPath} = URI.parse(document.uri);
		const {fsPath: folderFsPath} = URI.parse(folderUri);
		contents = isSANB(contents) ? contents : document.getText();

		// set the options needed for internal xo config resolution
		options.cwd = folderFsPath;
		options.filename = documentFsPath;
		options.filePath = documentFsPath;

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

		return report;
	}

	async getDocumentDiagnostics(document) {
		const {config: {overrideSeverity} = {}} = await this.getDocumentConfig(
			document
		);

		const {results, rulesMeta} = await this.getLintResults(document);

		// Clean previously computed code actions.
		this.codeActions.delete(document.uri);

		if (results.length === 0 || !results[0].messages) return;

		const diagnostics = results[0].messages.map((problem) => {
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

	async getDocumentFixes(uri) {
		let result = null;
		const textDocument = this.documents.get(uri);
		const edits = this.codeActions.get(uri);
		if (edits && edits.size > 0) {
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
