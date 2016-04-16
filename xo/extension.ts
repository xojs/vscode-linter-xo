'use strict';
import * as path from 'path';
import { workspace, window, commands, Disposable, ExtensionContext, Range, Position } from 'vscode';
import { LanguageClient, LanguageClientOptions, SettingMonitor, ServerOptions } from 'vscode-languageclient';
import setText from 'vscode-set-text';

export function activate(context: ExtensionContext) {

	// We need to go one level up since an extension compile the js code into
	// the output folder.
	const serverModule = context.asAbsolutePath(path.join('server', 'server.js'));
	const debugOptions = {execArgv: ["--nolazy", "--debug=6004"]};
	const serverOptions: ServerOptions = {
		run: {module: serverModule},
		debug: {module: serverModule, options: debugOptions}
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: ['javascript', 'javascriptreact'],
		synchronize: {
			configurationSection: 'xo',
			fileEvents: workspace.createFileSystemWatcher('package.json')
		}
	};

	let client = new LanguageClient('XO Linter', serverOptions, clientOptions);

	const disposable = commands.registerCommand('xo.fix', () => {
		const editor = window.activeTextEditor;

		if (editor) {
			const document = editor.document;

			Promise.resolve()
				.then(() => {
					return client.sendRequest({method: 'xo:fix'}, document.uri.fsPath);
				})
				.then((result: string) => {
					return setText(result);
				})
				.catch(err => {
					window.showErrorMessage(err.message || err);
				});
		}
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(new SettingMonitor(client, 'xo.enable').start());
}
