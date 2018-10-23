import {
	createConnection, IConnection,
	ResponseError, RequestType, InitializeResult,
	InitializeError,
	Diagnostic, Range, Files,
	TextDocuments, TextDocument, TextEdit, TextDocumentIdentifier,
	ErrorMessageTracker, IPCMessageReader, IPCMessageWriter,
	NotificationType,
	DocumentFormattingRequest
} from 'vscode-languageserver';
import Uri from 'vscode-uri';
import {makeDiagnostic, computeKey} from './utils';
import {Fixes, AutoFix, ESLintProblem} from './fixes';
import {Map} from './map';
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
	export const type = new RequestType<AllFixesParams, AllFixesResult, void, void>('textDocument/xo/allFixes');
}

namespace ValidateNotification {
	export const type = new NotificationType<TextDocument, void>('xo/validate');
}

class Linter {
	private readonly connection: IConnection;
	private readonly documents: TextDocuments;
	private package: Package;

	private workspaceRoot: string;
	private lib: any;
	private options: any;
	private readonly codeActions: Map<Map<AutoFix>> = Object.create(null);
	private readonly messageQueue: BufferedMessageQueue;

	constructor() {
		this.connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
		this.documents = new TextDocuments();

		this.messageQueue = new BufferedMessageQueue(this.connection);

		this.messageQueue.onNotification(ValidateNotification.type, document => {
			this.validateSingle(document);
		}, document => {
			return document.version;
		});

		// Listen for text document create, change
		this.documents.listen(this.connection);

		// Validate document if it changed
		this.documents.onDidChangeContent(event => {
			this.messageQueue.addNotificationMessage(ValidateNotification.type, event.document, event.document.version);
		});

		this.messageQueue.registerRequest(DocumentFormattingRequest.type, params => {
			const doc = this.documents.get(params.textDocument.uri);
			if (!doc) {
				return null;
			}
			return this.connection.workspace.getConfiguration('xo').then(config => {
				if (!config || !config.enable || !config.format || !config.format.enable) {
					return null;
				}
				const fixes = this.computeAllFixes(params.textDocument.uri);
				return fixes && fixes.edits;
			});
		});

		// Clear the diagnostics when document is closed
		this.documents.onDidClose(event => {
			this.connection.sendDiagnostics({
				uri: event.document.uri,
				diagnostics: []
			});
		});

		this.connection.onInitialize(this.initialize.bind(this));

		this.connection.onDidChangeConfiguration(params => {
			const settings = params.settings as Settings;

			this.options = settings.xo ? settings.xo.options || {} : {};
			this.validateMany(this.documents.all());
		});

		this.connection.onDidChangeWatchedFiles(() => {
			this.validateMany(this.documents.all());
		});

		this.connection.onRequest(AllFixesRequest.type, params => {
			return this.computeAllFixes(params.textDocument.uri);
		});
	}

	public listen(): void {
		this.connection.listen();
	}

	private initialize(params: {rootPath: string}) {
		this.workspaceRoot = params.rootPath;

		this.package = new Package(this.workspaceRoot);

		return this.resolveModule();
	}

	private resolveModule(): Thenable<InitializeResult | ResponseError<InitializeError>> {
		const result: InitializeResult = {
			capabilities: {
				textDocumentSync: this.documents.syncKind,
				documentFormattingProvider: true
			}
		};

		if (this.lib) {
			return Promise.resolve(result);
		}

		return Files.resolveModule(this.workspaceRoot, 'xo').then(
			(xo: any) => {
				if (!xo.lintText) {
					return new ResponseError(99, 'The XO library doesn\'t export a lintText method.', {retry: false});
				}

				this.lib = xo;

				return result;
			}, () => {
				if (this.package.isDependency('xo')) {
					throw new ResponseError<InitializeError>(99, 'Failed to load XO library. Make sure XO is installed in your workspace folder using \'npm install xo\' and then press Retry.', {retry: true});
				}
				return result;
			});
	}

	private validateMany(documents: TextDocument[]): Thenable<void> {
		const tracker = new ErrorMessageTracker();

		const promises = documents.map(document => {
			return this.validate(document).then(
				() => {
					// Do nothing
				},
				err => {
					tracker.add(this.getMessage(err, document));
				}
			);
		});

		return Promise.all(promises)
			.then(() => {
				tracker.sendErrors(this.connection);
			});
	}

	private validateSingle(document: TextDocument): Thenable<void> {
		return this.validate(document)
			.then(
				() => {
					// Do nothing
				},
				(err: Error) => {
					this.connection.window.showErrorMessage(this.getMessage(err, document));
				}
			);
	}

	private validate(document: TextDocument): Thenable<void> {
		if (!this.package.isDependency('xo')) {
			// Do not validate if `xo` is not a dependency
			return Promise.resolve();
		}

		return this.resolveModule()
			.then(() => {
				const uri = document.uri;
				const fsPath = Uri.parse(document.uri).fsPath;

				if (!fsPath) {
					return;
				}

				const contents = document.getText();

				const options = this.options;
				options.cwd = this.workspaceRoot;
				options.filename = fsPath;

				const report = this.lib.lintText(contents, options);

				// Clean previously computed code actions.
				this.codeActions[uri] = undefined;

				const results = report.results;

				if (results.length === 0 || !results[0].messages) {
					return;
				}

				const diagnostics: Diagnostic[] = results[0].messages.map((problem: any) => {
					const diagnostic = makeDiagnostic(problem);
					this.recordCodeAction(document, diagnostic, problem);
					return diagnostic;
				});

				this.connection.sendDiagnostics({uri, diagnostics});
			});
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
			edit: problem.fix
		};
	}

	private getMessage(err: any, document: TextDocument): string {
		if (typeof err.message === 'string' || err.message instanceof String) {
			return err.message as string;
		}

		return `An unknown error occurred while validating file: ${Uri.parse(document.uri).fsPath}`;
	}

	private computeAllFixes(uri: string): AllFixesResult | null {
		let result: AllFixesResult = null;
		const textDocument = this.documents.get(uri);
		const edits = this.codeActions[uri];

		function createTextEdit(editInfo: AutoFix): TextEdit {
			return TextEdit.replace(Range.create(textDocument.positionAt(editInfo.edit.range[0]), textDocument.positionAt(editInfo.edit.range[1])), editInfo.edit.text || '');
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
