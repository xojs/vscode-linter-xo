const {pathToFileURL} = require('url');
const node = require('vscode-languageserver/node.js');
const textDocument = require('vscode-languageserver-textdocument');
const {URI} = require('vscode-uri');
const utils = require('./utils');

const Fixes = require('./fixes');
const Package = require('./package');
const BufferedMessageQueue = require('./buffered-message-queue');

const AllFixesRequest = {
	type: new node.RequestType('textDocument/xo/allFixes')
};

const ValidateNotification = {
	type: new node.NotificationType('xo/validate')
};

const connection = node.createConnection(node.ProposedFeatures.all);

class Linter {
	constructor() {
		// Base connection
		this.connection = connection;

		this.connection.console.info(
			`XO Server Running in Node ${process.version}`
		);

		// Base documents object
		this.documents = new node.TextDocuments(textDocument.TextDocument);

		this.codeActions = Object.create(null);

		// Set up messageQueue
		this.messageQueue = new BufferedMessageQueue(this.connection);
		this.messageQueue.onNotification(
			ValidateNotification.type,
			(document) => {
				this.validateSingle(document);
			},
			(document) => document.version
		);

		// Listen for text document create, change
		this.documents.listen(this.connection);

		// Validate document if it changed
		this.documents.onDidChangeContent((event) => {
			this.messageQueue.addNotificationMessage(
				ValidateNotification.type,
				event.document,
				event.document.version
			);
		});

		this.messageQueue.registerRequest(
			node.DocumentFormattingRequest.type,
			async (params) => {
				const doc = this.documents.get(params.textDocument.uri);
				if (!doc) {
					return null;
				}

				const config = await this.connection.workspace.getConfiguration('xo');

				if (
					!config ||
					!config.enable ||
					!config.format ||
					!config.format.enable
				)
					return null;

				this.connection.console.info(
					`Applying Fixes to ${URI.parse(doc.uri).fsPath}`
				);

				const fixes = this.computeAllFixes(params.textDocument.uri);
				return fixes === null || fixes === undefined ? undefined : fixes.edits;
			}
		);

		// Clear the diagnostics when document is closed
		this.documents.onDidClose((event) => {
			this.connection.sendDiagnostics({
				uri: event.document.uri,
				diagnostics: []
			});
		});

		this.connection.onInitialize(this.initialize.bind(this));

		this.connection.onDidChangeConfiguration((params) => {
			const {settings} = params;
			this.options = settings.xo ? settings.xo.options || {} : {};
			this.validateMany(this.documents.all());
		});

		this.connection.onDidChangeWatchedFiles(() => {
			this.validateMany(this.documents.all());
		});

		this.connection.onRequest(AllFixesRequest.type, (params) =>
			this.computeAllFixes(params.textDocument.uri)
		);
	}

	listen() {
		this.connection.listen();
	}

	async initialize(params) {
		this.workspaceRoot = params.rootPath;
		this.package = new Package(this.workspaceRoot);
		return this.resolveModule();
	}

	async resolveModule() {
		const result = {
			capabilities: {
				textDocumentSync: node.TextDocumentSyncKind.Incremental,
				documentFormattingProvider: true
			}
		};

		if (typeof this?.lib?.lintText === 'function') return result;

		try {
			const xoPathRaw = await node.Files.resolve(
				'xo',
				undefined,
				this.workspaceRoot
			);
			const xoPath = pathToFileURL(xoPathRaw).toString();

			// eslint-disable-next-line node/no-unsupported-features/es-syntax
			const xo = await import(xoPath);

			// eslint-disable-next-line node/no-unsupported-features/es-syntax
			const optionsManager = await import(
				xoPath.replace('index.js', 'lib/options-manager.js')
			);

			if (!xo?.default?.lintText) {
				return new node.ResponseError(
					99,
					"The XO library doesn't export a lintText method.",
					{retry: true}
				);
			}

			this.connection.console.info(
				`XO Library v ${this.package.getVersion(
					'xo'
				)} was successfully loaded from ${xoPath}`
			);
			this.lib = xo.default;
			this.lib.optionsManager = optionsManager;

			return result;
		} catch {
			if (this.package.isDependency('xo')) {
				return new node.ResponseError(
					99,
					"Failed to load XO library. Make sure XO is installed in your workspace folder using 'npm install xo' and then press Retry.",
					{retry: true}
				);
			}
		}
	}

	async validateMany(documents) {
		const tracker = new node.ErrorMessageTracker();
		await Promise.all(
			documents.map(async (document) => {
				try {
					await this.validate(document);
				} catch (error) {
					tracker.add(this.getMessage(error, document));
				}
			})
		);
		return tracker.sendErrors(this.connection);
	}

	async validateSingle(document) {
		try {
			await this.validate(document);
		} catch (error) {
			this.connection.window.showErrorMessage(this.getMessage(error, document));
		}
	}

	async validate(document) {
		if (!this.package.isDependency('xo')) return;

		await this.resolveModule();

		const {fsPath} = URI.parse(document.uri);

		if (!fsPath) {
			return;
		}

		const contents = document.getText();

		const {options} = this;

		options.cwd = this.workspaceRoot;
		options.filename = fsPath;
		options.filePath = fsPath;

		const report = await this.runLint(contents, options);

		// Clean previously computed code actions.
		this.codeActions[document.uri] = undefined;

		const {results} = report;

		if (results.length === 0 || !results[0].messages) return;

		const diagnostics = results[0].messages.map((problem) => {
			const diagnostic = utils.makeDiagnostic(problem);
			this.recordCodeAction(document, diagnostic, problem);
			return diagnostic;
		});

		this.connection.sendDiagnostics({uri: document.uri, diagnostics});
	}

	async runLint(contents, options) {
		const cwd = process.cwd();
		let report;
		try {
			process.chdir(options.cwd);

			try {
				const foundOptions = await this.lib.optionsManager.mergeWithFileConfig(
					options
				);

				this.connection.console.info(
					`Linting ${options.filePath} With Options ${JSON.stringify(
						foundOptions
					)}`
				);

				report = await this.lib.lintText(contents, foundOptions.options);
			} catch (error) {
				this.connection.console.error(error.toString());
				this.connection.console.error(error.message);
				this.connection.console.error(error.stack);
				throw error;
			}
		} finally {
			if (cwd !== process.cwd()) {
				process.chdir(cwd);
			}
		}

		return report;
	}

	recordCodeAction(document, diagnostic, problem) {
		if (!problem.fix || !problem.ruleId) {
			return;
		}

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

	getMessage(error, document) {
		if (typeof error.message === 'string' || error.message instanceof String) {
			return error.message;
		}

		return `An unknown error occurred while validating file: ${
			URI.parse(document.uri).fsPath
		}`;
	}

	computeAllFixes(uri) {
		let result = null;
		const textDocument = this.documents.get(uri);
		const edits = this.codeActions[uri];
		function createTextEdit(editInfo) {
			return node.TextEdit.replace(
				node.Range.create(
					textDocument.positionAt(editInfo.edit.range[0]),
					textDocument.positionAt(editInfo.edit.range[1])
				),
				editInfo.edit.text || ''
			);
		}

		if (edits) {
			const fixes = new Fixes(edits);
			if (!fixes.isEmpty()) {
				result = {
					documentVersion: fixes.getDocumentVersion(),
					edits: fixes.getOverlapFree().map(createTextEdit)
				};
			}
		}

		return result;
	}
}

new Linter().listen();
