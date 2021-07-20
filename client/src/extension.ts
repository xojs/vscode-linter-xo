import * as path from 'path';
import {workspace, window, commands, ExtensionContext} from 'vscode';
import {LanguageClient, LanguageClientOptions, SettingMonitor, RequestType, TransportKind, TextDocumentIdentifier, TextEdit} from 'vscode-languageclient/node';

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

export function activate(context: ExtensionContext) {
	const serverModule = context.asAbsolutePath(path.join('server', 'out', 'server.js'));
	const debugOptions = {execArgv: ['--nolazy', '--inspect=6004'], cwd: process.cwd()};
	const serverOptions = {
		run: {module: serverModule, transport: TransportKind.ipc, options: {cwd: process.cwd()}},
		debug: {module: serverModule, transport: TransportKind.ipc, options: debugOptions},
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: [
			{language: 'javascript', scheme: 'file'},
			{language: 'javascript', scheme: 'untitled'},
			{language: 'javascriptreact', scheme: 'file'},
			{language: 'javascriptreact', scheme: 'untitled'},
			{language: 'typescript', scheme: 'file'},
			{language: 'typescript', scheme: 'untitled'},
			{language: 'typescriptreact', scheme: 'file'},
			{language: 'typescriptreact', scheme: 'untitled'},
		],
		synchronize: {
			configurationSection: 'xo',
			fileEvents: [
				workspace.createFileSystemWatcher('**/package.json'),
			],
		},
	};

	const client = new LanguageClient('XO Linter', serverOptions, clientOptions);

	function applyTextEdits(uri: string, documentVersion: number, edits: TextEdit[]) {
		const textEditor = window.activeTextEditor;
		if (textEditor && textEditor.document.uri.toString() === uri) {
			if (textEditor.document.version !== documentVersion) {
				void window.showInformationMessage('XO fixes are outdated and can\'t be applied to the document.');
			}

			void textEditor.edit(mutator => {
				for (const edit of edits) {
					mutator.replace(client.protocol2CodeConverter.asRange(edit.range), edit.newText);
				}
			}).then(success => {
				if (!success) {
					void window.showErrorMessage('Failed to apply XO fixes to the document. Please consider opening an issue with steps to reproduce.');
				}
			});
		}
	}

	function fixAllProblems() {
		const textEditor = window.activeTextEditor;
		if (!textEditor) {
			return;
		}

		const uri = textEditor.document.uri.toString();
		client.sendRequest(AllFixesRequest.type, {textDocument: {uri}}).then(result => {
			if (result) {
				applyTextEdits(uri, result.documentVersion, result.edits);
			}
		}, () => {
			void window.showErrorMessage('Failed to apply XO fixes to the document. Please consider opening an issue with steps to reproduce.');
		});
	}

	context.subscriptions.push(
		new SettingMonitor(client, 'xo.enable').start(),
		commands.registerCommand('xo.fix', fixAllProblems),
	);
}
