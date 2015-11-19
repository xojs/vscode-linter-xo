'use strict';

import * as path from 'path';
import { workspace, Disposable, ExtensionContext } from 'vscode';
import { LanguageClient, LanguageClientOptions, SettingMonitor, RequestType } from 'vscode-languageclient';

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
	context.subscriptions.push(new SettingMonitor(client, 'xo.enable').start());
}
