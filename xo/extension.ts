import * as path from 'path';
import {
	workspace, window, commands, languages,
	ExtensionContext,
	TextDocument,
	DocumentFormattingEditProvider,
	Disposable,
	DocumentFilter,
	TextEdit
} from 'vscode';
import {
	LanguageClient, LanguageClientOptions, SettingMonitor, RequestType, TransportKind,
	TextDocumentIdentifier, VersionedTextDocumentIdentifier
} from 'vscode-languageclient';

interface AllFixesParams {
	textDocument: TextDocumentIdentifier;
}

interface AllFixesResult {
	documentVersion: number,
	edits: TextEdit[]
}

namespace AllFixesRequest {
	export const type = new RequestType<AllFixesParams, AllFixesResult, void, void>('textDocument/xo/allFixes');
}

const defaultLanguages = ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'];

class XOEditProivder implements DocumentFormattingEditProvider {
	constructor(private _client: LanguageClient) {}

	provideDocumentFormattingEdits(document: TextDocument) {
		if (!workspace.getConfiguration('xo', document.uri).get<boolean>('format.enable', false)) {
			return Promise.resolve([]);
		}

		let textDocument: VersionedTextDocumentIdentifier = {
			uri: document.uri.toString(),
			version: document.version
		};
		return Promise.resolve(this._client.sendRequest(AllFixesRequest.type, { textDocument: textDocument}).then(result => result.edits));
	}
}

let formatterHandler: undefined | Disposable;

function disposeFormatterHandler() {
    if (formatterHandler) {
        formatterHandler.dispose();
    }
    formatterHandler = undefined;
}

export function activate(context: ExtensionContext) {
	// We need to go one level up since an extension compile the js code into
	// the output folder.
	const serverModule = path.join(__dirname, '..', 'server', 'server.js');
	const debugOptions = {execArgv: ['--nolazy', '--inspect=6004']};
	const serverOptions = {
		run: {module: serverModule, transport: TransportKind.ipc},
		debug: {module: serverModule, transport: TransportKind.ipc, options: debugOptions}
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: defaultLanguages,
		synchronize: {
			configurationSection: 'xo',
			fileEvents: [
				workspace.createFileSystemWatcher('**/package.json')
			]
		}
	}

	const client = new LanguageClient('XO Linter', serverOptions, clientOptions);

	function applyTextEdits(uri: string, documentVersion: number, edits: TextEdit[]) {
		const textEditor = window.activeTextEditor;
		if (textEditor && textEditor.document.uri.toString() === uri) {
			if (textEditor.document.version !== documentVersion) {
				window.showInformationMessage(`XO fixes are outdated and can't be applied to the document.`);
			}

			textEditor.edit(mutator => {
				for(const edit of edits) {
					mutator.replace(client.protocol2CodeConverter.asRange(edit.range), edit.newText);
				}
			}).then((success) => {
				if (!success) {
					window.showErrorMessage('Failed to apply XO fixes to the document. Please consider opening an issue with steps to reproduce.');
				}
			});
		}
	}

	function fixAllProblems() {
		const textEditor = window.activeTextEditor;
		if (!textEditor) {
			return;
		}

		const uri: string = textEditor.document.uri.toString();
		client.sendRequest(AllFixesRequest.type, { textDocument: { uri }}).then((result) => {
			if (result) {
				applyTextEdits(uri, result.documentVersion, result.edits);
			}
		}, () => {
			window.showErrorMessage('Failed to apply XO fixes to the document. Please consider opening an issue with steps to reproduce.');
		});
	}

	let configuration = workspace.getConfiguration('xo', null);

	const editProivder = new XOEditProivder(client);
	function registerFormatter() {
		disposeFormatterHandler();
		if (!configuration.get<boolean>('format.enable', false) || !configuration.get<boolean>('enable', true)) {
			return;
		}

		const filter: DocumentFilter[] = defaultLanguages.map(language => ({
			scheme: 'file', language
		}));

		formatterHandler = languages.registerDocumentFormattingEditProvider(filter, editProivder);
	}

	registerFormatter();

	context.subscriptions.push(
		new SettingMonitor(client, 'xo.enable').start(),
		commands.registerCommand('xo.fix', fixAllProblems),
		workspace.onDidChangeConfiguration(registerFormatter),
		{
			dispose: disposeFormatterHandler
		}
	);
}
