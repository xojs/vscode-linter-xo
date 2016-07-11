'use strict';
import * as path from 'path';
import * as fs from 'fs';
import {
	createConnection, IConnection,
	ResponseError, RequestType, NotificationType,
	InitializeParams, InitializeResult, InitializeError,
	DidChangeConfigurationParams, DidChangeWatchedFilesParams,
	Diagnostic, DiagnosticSeverity, Position, Files,
	TextDocument, TextDocuments,
	ErrorMessageTracker
} from 'vscode-languageserver';

interface Settings {
	xo: {
		enable: boolean;
		options: any;
	},
	[key: string]: any;
}

function makeDiagnostic(problem: any): Diagnostic {
	return {
		message: `${problem.message} (${problem.ruleId})`,
		severity: parseSeverity(problem.severity),
		range: {
			start: {line: problem.line - 1, character: problem.column - 1},
			end: {line: problem.line - 1, character: problem.column - 1}
		}
	};
}

function parseSeverity(severity: number): number {
	switch (severity) {
		case 2:
			return DiagnosticSeverity.Error;
		default:
			return DiagnosticSeverity.Warning;
	}
}

class Linter {

	private connection: IConnection;
	private documents: TextDocuments;

	private workspaceRoot: string;
	private lib: any;
	private options: any;

	constructor() {
		this.connection = createConnection(process.stdin, process.stdout);
		this.documents = new TextDocuments();
		this.documents.onDidChangeContent(event => this.validateSingle(event.document));
		this.documents.onDidClose(event => this.connection.sendDiagnostics({uri: event.document.uri, diagnostics: []}));
		this.documents.listen(this.connection);

		this.connection.onInitialize(params => this.initialize(params));
		this.connection.onDidChangeConfiguration(params => {
			const settings = <Settings>params.settings;

			this.options = settings.xo ? settings.xo.options || {} : {};
			this.validateAll();
		});
		this.connection.onDidChangeWatchedFiles(params => {
			this.validateAll();
		});
		this.connection.onRequest({method: 'xo:fix'}, (fsPath: string) => {
			const contents = fs.readFileSync(fsPath).toString('utf8');

			const report = this.lib.lintText(contents, {
				cwd: path.dirname(fsPath),
				filename: fsPath,
				fix: true
			});

			return report.results[0].output;
		});
	}

	public listen(): void {
		this.connection.listen();
	}

	private initialize(params: InitializeParams): Thenable<InitializeResult> {
		this.workspaceRoot = params.rootPath;

		return Files.resolveModule(this.workspaceRoot, 'xo').then(xo => {
			if (!xo.lintText) {
				return new ResponseError(99, 'The xo library doesn\'t export a lintText method.', {retry: false});
			}

			this.lib = xo;

			return <InitializeResult>{capabilities: {textDocumentSync: this.documents.syncKind}};
		}, err => {
			throw new ResponseError<InitializeError>(99, 'Failed to load xo library. Please install xo in your workspace folder using \'npm install xo\' and then press Retry.', {retry: true});
		});
	}

	private validateAll(): void {
		let tracker = new ErrorMessageTracker();
		this.documents.all().forEach(document => {
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

		let options:any = this.options;
		options.cwd = path.dirname(fsPath);
		options.filename = fsPath

		const report = this.lib.lintText(contents, options);

		const diagnostics: Diagnostic[] = report.results[0].messages.map(makeDiagnostic);

		this.connection.sendDiagnostics({uri: uri, diagnostics});
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
