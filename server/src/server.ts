import {
	createConnection, Connection,
	ResponseError, RequestType, InitializeResult,
	InitializeError,
	Diagnostic, Range, Files,
	TextDocuments, TextEdit, TextDocumentIdentifier,
	ErrorMessageTracker, IPCMessageReader, IPCMessageWriter,
	NotificationType,
	DocumentFormattingRequest,
	TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {URI} from 'vscode-uri';
import Xo, {XoReport} from '../typings/xo.d';
import {makeDiagnostic, computeKey} from './utils';
import {Fixes, AutoFix, ESLintProblem} from './fixes';
import {Settings} from './settings';
import {Package} from './package';
import BufferedMessageQueue from './buffered-message-queue';

interface AllFixesParams {
	textDocument: TextDocumentIdentifier;
}

interface AllFixesResult {
	documentVersion: number;
	edits: TextEdit[];
}

namespace AllFixesRequest {
	export const type = new RequestType<AllFixesParams, AllFixesResult, void>('textDocument/xo/allFixes');
}

namespace ValidateNotification {
	export const type = new NotificationType<TextDocument>('xo/validate');
}

class Linter {
	private readonly connection: Connection;
	private readonly documents: TextDocuments<TextDocument>;
	private package: Package;

	private workspaceRoot: string;
	private lib: Xo | undefined;
	private options: any;
	private readonly codeActions: Record<string, Record<string, AutoFix>> = Object.create(null);
	private readonly messageQueue: BufferedMessageQueue;

	constructor() {
		this.connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
		this.documents = new TextDocuments<TextDocument>(TextDocument);

		this.messageQueue = new BufferedMessageQueue(this.connection);

		this.messageQueue.onNotification(ValidateNotification.type, document => {
			void this.validateSingle(document);
		}, document => document.version);

		// Listen for text document create, change
		this.documents.listen(this.connection);

		// Validate document if it changed
		this.documents.onDidChangeContent(event => {
			this.messageQueue.addNotificationMessage(ValidateNotification.type, event.document, event.document.version);
		});

		this.messageQueue.registerRequest(DocumentFormattingRequest.type, async params => {
			const doc = this.documents.get(params.textDocument.uri);
			if (!doc) {
				return null;
			}

			return this.connection.workspace.getConfiguration('xo').then(config => {
				if (!config || !config.enable || !config.format || !config.format.enable) {
					return null;
				}

				const fixes = this.computeAllFixes(params.textDocument.uri);

				return fixes?.edits;
			});
		});

		// Clear the diagnostics when document is closed
		this.documents.onDidClose(event => {
			this.connection.sendDiagnostics({
				uri: event.document.uri,
				diagnostics: [],
			});
		});

		this.connection.onInitialize(this.initialize.bind(this));

		this.connection.onDidChangeConfiguration(params => {
			const settings = params.settings as Settings;

			this.options = settings?.xo?.options || {};
			void this.validateMany(this.documents.all());
		});

		this.connection.onDidChangeWatchedFiles(() => {
			void this.validateMany(this.documents.all());
		});

		this.connection.onRequest(AllFixesRequest.type, params => this.computeAllFixes(params.textDocument.uri));
	}

	public listen(): void {
		this.connection.listen();
	}

	private async initialize(params: {rootPath: string}) {
		this.workspaceRoot = params.rootPath;

		this.package = new Package(this.workspaceRoot);

		return this.resolveModule();
	}

	private async resolveModule(): Promise<InitializeResult | ResponseError<InitializeError>> {
		const result: InitializeResult = {
			capabilities: {
				textDocumentSync: TextDocumentSyncKind.Incremental,
				documentFormattingProvider: true,
			},
		};

		if (this.lib) {
			return result;
		}

		return Files.resolveModulePath(this.workspaceRoot, 'xo', '.', this.connection.tracer.log).then(xoPath => {
			// eslint-disable-next-line
			const xo = require(xoPath);
			if (!xo.lintText) {
				return new ResponseError(99, 'The XO library doesn\'t export a lintText method.', {retry: false});
			}

			this.lib = xo;

			return result;
		}).catch(() => {
			if (this.package.isDependency('xo')) {
				throw new ResponseError<InitializeError>(99, 'Failed to load XO library. Make sure XO is installed in your workspace folder using \'npm install xo\' and then press Retry.', {retry: true});
			}

			return result;
		});
	}

	private async validateMany(documents: TextDocument[]): Promise<void | void[]> {
		const tracker = new ErrorMessageTracker();

		const promises = documents.map(async document => this.validate(document).then(() => {
			// Do nothing
		}).catch(error => {
			tracker.add(this.getMessage(error, document));
		}));

		return Promise.all(promises).catch(() => {
			tracker.sendErrors(this.connection);
		});
	}

	private async validateSingle(document: TextDocument): Promise<void> {
		return this.validate(document).catch(error => {
			this.connection.window.showErrorMessage(this.getMessage(error, document));
		});
	}

	private async validate(document: TextDocument): Promise<void> {
		if (!this.package.isDependency('xo')) {
			// Do not validate if `xo` is not a dependency
			return;
		}

		await this.resolveModule();
		const uri = document.uri;
		const fsPath = URI.parse(document.uri).fsPath;

		if (!fsPath) {
			return;
		}

		const contents = document.getText();

		const options = this.options;
		options.cwd = this.workspaceRoot;
		options.filePath = fsPath;

		const report = await this.runLint(contents, options);

		// Clean previously computed code actions.
		this.codeActions[uri] = undefined;

		const results = report.results;

		if (results.length === 0 || !results[0].messages) {
			return;
		}

		const diagnostics: Diagnostic[] = results[0].messages.map(problem => {
			const diagnostic = makeDiagnostic(problem);
			this.recordCodeAction(document, diagnostic, problem);
			return diagnostic;
		});

		this.connection.sendDiagnostics({uri, diagnostics});
	}

	private async runLint(contents: string, options: any): Promise<XoReport> {
		const cwd = process.cwd();
		let report: XoReport | undefined;

		try {
			process.chdir(options.cwd);
			report = await this.lib.lintText(contents, options);
		} finally {
			if (cwd !== process.cwd()) {
				process.chdir(cwd);
			}
		}

		return report;
	}

	private recordCodeAction(document: TextDocument, diagnostic: Diagnostic, problem: ESLintProblem): void {
		if (!problem.fix || !problem.ruleId) {
			return;
		}

		const uri = document.uri;
		let edits = this.codeActions[uri];
		if (!edits) {
			edits = Object.create(null);
			this.codeActions[uri] = edits;
		}

		edits[computeKey(diagnostic)] = {
			label: `Fix this ${problem.ruleId} problem`,
			documentVersion: document.version,
			ruleId: problem.ruleId,
			edit: problem.fix,
		};
	}

	private getMessage(error: any, document: TextDocument): string {
		if (typeof error.message === 'string' || error.message instanceof String) {
			return error.message as string;
		}

		return `An unknown error occurred while validating file: ${URI.parse(document.uri).fsPath}`;
	}

	private computeAllFixes(uri: string): AllFixesResult | null {
		let result: AllFixesResult = null;
		const textDocument = this.documents.get(uri);
		const edits = this.codeActions[uri];

		if (edits) {
			const fixes = new Fixes(edits);
			if (!fixes.isEmpty()) {
				result = {
					documentVersion: fixes.getDocumentVersion(),
					edits: fixes.getOverlapFree().map(editInfo => TextEdit.replace(Range.create(textDocument.positionAt(editInfo.edit.range[0]), textDocument.positionAt(editInfo.edit.range[1])), editInfo.edit.text || '')),
				};
			}
		}

		return result;
	}
}

new Linter().listen();
