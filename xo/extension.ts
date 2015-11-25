'use strict';

import * as path from 'path';
import { workspace, window, commands, Disposable, ExtensionContext, Range, Position } from 'vscode';
import { LanguageClient, LanguageClientOptions, SettingMonitor } from 'vscode-languageclient';

export function activate(context: ExtensionContext) {

	// We need to go one level up since an extension compile the js code into
	// the output folder.
	const serverModule = path.join(__dirname, '..', 'server', 'server.js');
	const debugOptions = {execArgv: ["--nolazy", "--debug=6004"]};
	const serverOptions = {
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

	const disposable = commands.registerCommand('XO:Fix', () => {
		const editor = window.activeTextEditor;

		if (editor) {
			const document = editor.document;

			Promise.resolve()
				.then(() => {
					return client.sendRequest({method: 'xo:fix'}, document.uri);
				})
				.then((result: string) =>
					new Promise(resolve => {
						editor.edit(builder => {
							const lastLine = document.lineAt(document.lineCount - 2);

							const start = new Position(0, 0);
							const end = new Position(document.lineCount - 1, lastLine.text.length);

							builder.replace(new Range(start, end), result);

							resolve();
						});
					})
				)
				.catch(err => {
					window.showErrorMessage(err.message || err);
				});
		}
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(new SettingMonitor(client, 'xo.enable').start());
}
