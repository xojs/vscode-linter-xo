const process = require('process');
const vscode = require('vscode');
const {TransportKind, LanguageClient, SettingMonitor} = require('vscode-languageclient/node');
const isSANB = require('is-string-and-not-blank');
const fixAllProblems = require('./fix-all-problems');
const statusBar = require('./status-bar');

let client;

function activate(context) {
	// The server is implemented in node
	const serverModule = context.asAbsolutePath('dist/server.js');

	const debugOptions = {
		execArgv: ['--nolazy', '--inspect=6004'],
		cwd: process.cwd()
	};

	const xoOptions = vscode.workspace.getConfiguration('xo');

	let runtime;
	if (isSANB(xoOptions.get('runtime'))) runtime = xoOptions.get('runtime');

	const serverOptions = {
		run: {
			module: serverModule,
			runtime,
			transport: TransportKind.ipc,
			options: {cwd: process.cwd()}
		},
		debug: {
			module: serverModule,
			runtime,
			transport: TransportKind.ipc,
			options: debugOptions
		}
	};

	let validate = JSON.stringify(xoOptions.get('validate'));
	const documentSelector = [];
	for (const language of xoOptions.get('validate')) {
		documentSelector.push({language, scheme: 'file'}, {language, scheme: 'untitled'});
	}

	const clientOptions = {
		documentSelector,
		synchronize: {
			configurationSection: 'xo',
			fileEvents: [
				// we relint all open textDocuments whenever a config changes
				// that may possibly affect the options xo should be using
				vscode.workspace.createFileSystemWatcher('**/.eslintignore'),
				vscode.workspace.createFileSystemWatcher('**/.xo-confi{g.cjs,g.json,g.js,g}'),
				vscode.workspace.createFileSystemWatcher('**/xo.confi{g.cjs,g.js,g}'),
				vscode.workspace.createFileSystemWatcher('**/package.json')
			]
		}
	};

	/** @type {import('vscode-languageclient/node').LanguageClient} */
	client = new LanguageClient('xo', serverOptions, clientOptions);

	context.subscriptions.push(
		new SettingMonitor(client, 'xo.enable').start(),
		vscode.commands.registerCommand('xo.fix', () => fixAllProblems(client)),
		vscode.commands.registerCommand('xo.showOutputChannel', () => {
			client.outputChannel.show();
		}),
		vscode.commands.registerCommand('xo.restart', () => {
			client.restart().catch((error) => client.error(`Restarting client failed`, error, 'force'));
		})
	);

	vscode.workspace.onDidChangeConfiguration(() => {
		if (validate !== JSON.stringify(xoOptions.get('validate'))) {
			validate = JSON.stringify(xoOptions.get('validate'));
			vscode.commands.executeCommand('workbench.action.reloadWindow');
		}

		statusBar(client);
	});

	vscode.workspace.onDidOpenTextDocument(() => statusBar(client));
	vscode.workspace.onDidCloseTextDocument(() => statusBar(client));

	context.subscriptions.push(statusBar(client));
}

function deactivate() {
	if (!client) {
		return undefined;
	}

	return client.stop();
}

module.exports = {
	activate,
	deactivate
};
