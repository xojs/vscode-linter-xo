'use strict';
import * as path from 'path';
import * as fs from 'fs';
import {
	createConnection, IConnection,
	ResponseError, RequestType, RequestHandler, NotificationType, NotificationHandler,
	InitializeResult, InitializeError,
	Diagnostic, DiagnosticSeverity, Position, Range, Files,
	TextDocuments, TextDocument, TextDocumentSyncKind, TextEdit, TextDocumentIdentifier,
	Command,
	ErrorMessageTracker, IPCMessageReader, IPCMessageWriter
} from 'vscode-languageserver';
import { makeDiagnostic, computeKey } from './utils';
import { Fixes, AutoFix, ESLintProblem } from './fixes';
import { Map } from './map';
import { Settings } from './settings';

interface AllFixesParams {
	textDocument: TextDocumentIdentifier;
}

interface AllFixesResult {
	documentVersion: number,
	edits: TextEdit[]
}

namespace AllFixesRequest {
	export const type: RequestType<AllFixesParams, AllFixesResult, void> = { get method() { return 'textDocument/xo/allFixes'; } };
}

class Linter {

	private connection: IConnection;
	private documents: TextDocuments;

	private workspaceRoot: string;
	private lib: any;
	private options: any;
	private codeActions: Map<Map<AutoFix>> = Object.create(null);

	constructor() {
		this.connection = createConnection(new IPCMessageReader(process), new IPCMessageWriter(process));
		this.documents = new TextDocuments();

		// Listen for text document create, change
		this.documents.listen(this.connection);

		// Validate document if it changed
		this.documents.onDidChangeContent(event => {
			this.validateSingle(event.document);
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
			const settings = <Settings>params.settings;

			this.options = settings.xo ? settings.xo.options || {} : {};
			this.validateMany(this.documents.all());
		});

		this.connection.onDidChangeWatchedFiles(params => {
			this.validateMany(this.documents.all());
		});

		this.connection.onRequest(AllFixesRequest.type, (params) => {
			let result: AllFixesResult = null;
			let uri = params.textDocument.uri;
			let textDocument = this.documents.get(uri);
			let edits = this.codeActions[uri];

			function createTextEdit(editInfo: AutoFix): TextEdit {
				return TextEdit.replace(Range.create(textDocument.positionAt(editInfo.edit.range[0]), textDocument.positionAt(editInfo.edit.range[1])), editInfo.edit.text || '');
			}

			if (edits) {
				let fixes = new Fixes(edits);
				if (!fixes.isEmpty()) {
					result = {
						documentVersion: fixes.getDocumentVersion(),
						edits: fixes.getOverlapFree().map(createTextEdit)
					}
				}
			}

			return result;
		});
	}

	public listen(): void {
		this.connection.listen();
	}

	private initialize(params): Thenable<InitializeResult | ResponseError<InitializeError>> {
		this.workspaceRoot = params.rootPath;

		return Files.resolveModule(this.workspaceRoot, 'xo').then((xo: any) => {
			if (!xo.lintText) {
				return new ResponseError(99, 'The XO library doesn\'t export a lintText method.', {retry: false});
			}

			this.lib = xo;

			return {
				capabilities: {
					textDocumentSync: this.documents.syncKind,
					codeActionProvider: true
				}
			};
		}, err => {
			throw new ResponseError<InitializeError>(99, 'Failed to load xo library. Please install xo in your workspace folder using \'npm install xo\' and then press Retry.', {retry: true});
		});
	}

	private validateMany(documents: TextDocument[]): void {
		let tracker = new ErrorMessageTracker();
		documents.forEach(document => {
			try {
				this.validate(document);
			} catch (err) {
				tracker.add(this.getMessage(err, document));
			}
		});
		tracker.sendErrors(this.connection);
	}

	private validateSingle(document: TextDocument): void {
		try {
			this.validate(document);
		} catch (err) {
			this.connection.window.showErrorMessage(this.getMessage(err, document));
		}
	}

	private validate(document: TextDocument): void {
		const uri = document.uri;
		const fsPath = Files.uriToFilePath(uri);
		const contents = document.getText();

		const options:any = this.options;
		options.cwd = path.dirname(fsPath);
		options.filename = fsPath

		const report = this.lib.lintText(contents, options);

		// Clean previously computed code actions.
		delete this.codeActions[uri];

		const diagnostics: Diagnostic[] = report.results[0].messages.map(problem => {
			const diagnostic = makeDiagnostic(problem);
			this.recordCodeAction(document, diagnostic, problem);
			return diagnostic;
		});

		this.connection.sendDiagnostics({uri, diagnostics});
	}

	private recordCodeAction(document: TextDocument, diagnostic: Diagnostic, problem: ESLintProblem): void {
		if (!problem.fix || !problem.ruleId) {
			return;
		}

		const uri = document.uri;
		let edits: Map<AutoFix> = this.codeActions[uri];
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
			return <string>err.message;
		} else {
			return `An unknown error occurred while validating file: ${Files.uriToFilePath(document.uri)}`;
		}
	}
}

new Linter().listen();
