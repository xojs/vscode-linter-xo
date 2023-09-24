import process from 'node:process';
import type {ExtensionContext, StatusBarItem} from 'vscode';
import {workspace, commands} from 'vscode';
import {TransportKind, LanguageClient, SettingMonitor} from 'vscode-languageclient/node';
import isSANB from 'is-string-and-not-blank';
import fixAllProblems from './fix-all-problems';
import statusBar from './status-bar';

let client: LanguageClient;

export function activate(context: ExtensionContext) {
	// The server is implemented in node
	const serverModule = context.asAbsolutePath('dist/server.js');

	const debugOptions = {
		execArgv: ['--nolazy', '--inspect=6004'],
		cwd: process.cwd()
	};

	const xoOptions = workspace.getConfiguration('xo');

	let runtime: string | undefined;

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
	for (const language of xoOptions.get('validate', [])) {
		documentSelector.push({language, scheme: 'file'}, {language, scheme: 'untitled'});
	}

	const clientOptions = {
		documentSelector,
		synchronize: {
			configurationSection: 'xo',
			fileEvents: [
				// we relint all open textDocuments whenever a config changes
				// that may possibly affect the options xo should be using
				workspace.createFileSystemWatcher('**/.eslintignore'),
				workspace.createFileSystemWatcher('**/.xo-confi{g.cjs,g.json,g.js,g}'),
				workspace.createFileSystemWatcher('**/xo.confi{g.cjs,g.js,g}'),
				workspace.createFileSystemWatcher('**/package.json')
			]
		}
	};

	client = new LanguageClient('xo', serverOptions, clientOptions);

	context.subscriptions.push(
		new SettingMonitor(client, 'xo.enable').start(),
		commands.registerCommand('xo.fix', async () => fixAllProblems(client)),
		commands.registerCommand('xo.showOutputChannel', () => {
			client.outputChannel.show();
		}),
		commands.registerCommand('xo.restart', () => {
			client.restart().catch((error) => {
				client.error(`Restarting client failed`, error, 'force');
			});
		})
	);

	workspace.onDidChangeConfiguration(async () => {
		if (validate !== JSON.stringify(xoOptions.get('validate'))) {
			validate = JSON.stringify(xoOptions.get('validate'));
			await commands.executeCommand('workbench.action.reloadWindow');
		}

		statusBar();
	});

	workspace.onDidOpenTextDocument(() => statusBar());
	workspace.onDidCloseTextDocument(() => statusBar());

	if (typeof statusBar === 'function') context.subscriptions.push(statusBar()!);
}

export async function deactivate() {
	if (!client) {
		return undefined;
	}

	return client.stop();
}
