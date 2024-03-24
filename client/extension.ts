import process from 'node:process';
import {
	type ConfigurationChangeEvent,
	type ExtensionContext,
	workspace,
	window,
	commands
} from 'vscode';
import {
	LanguageClient,
	TransportKind,
	type DocumentSelector,
	type LanguageClientOptions,
	type ServerOptions
} from 'vscode-languageclient/node';
import Queue from 'queue';
import pkg from '../package.json';
import {updateStatusBar} from './status-bar';
import {xoRootCache} from './cache';
import {fixAllProblems} from './fix-all-problems';

let languageClient: LanguageClient;

const queue = new Queue({autostart: true, concurrency: 1});

export async function activate(context: ExtensionContext) {
	const logger = window.createOutputChannel('xo', {log: true});
	xoRootCache.logger = logger;

	logger.info(`[client] Activating XO extension v${pkg.version}`);

	const xoConfig = workspace.getConfiguration('xo');
	const runtime = xoConfig.get<string>('runtime');
	const hasValidXoRoot = await xoRootCache.get(window.activeTextEditor?.document.uri.fsPath);

	const serverModule = context.asAbsolutePath('dist/server.js');

	const serverOptions: ServerOptions = {
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
			options: {
				execArgv: ['--nolazy', '--inspect=6004'],
				cwd: process.cwd()
			}
		}
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: xoConfig.get<string[]>('validate', []).flatMap((language) => [
			{language, scheme: 'file'},
			{language, scheme: 'untitled'}
		]),
		outputChannel: logger,
		synchronize: {
			configurationSection: 'xo'
		}
	};
	const languageClient = new LanguageClient('xo', serverOptions, clientOptions);

	const restart = async () => {
		try {
			logger.info('[client] Restarting client');
			await languageClient.restart();
			logger.info('[client] Restarting client success');
		} catch (error) {
			languageClient.error(`[client] Restarting client failed`, error, 'force');
			throw error;
		}
	};

	/**
	 * Update status bar on activation, and dispose of the status bar when the extension is deactivated
	 */
	const statusBar = await updateStatusBar(window.activeTextEditor?.document);

	context.subscriptions.push(
		/**
		 * register xo extensions provided commands
		 */
		commands.registerCommand('xo.fix', async () => fixAllProblems(languageClient)),
		commands.registerCommand('xo.showOutputChannel', () => {
			logger.show();
		}),
		commands.registerCommand('xo.restart', restart),
		...[
			// we relint all open textDocuments whenever a config changes
			// that may possibly affect the options xo should be using
			workspace.createFileSystemWatcher('**/.eslintignore'),
			workspace.createFileSystemWatcher('**/.xo-confi{g.cjs,g.json,g.js,g}'),
			workspace.createFileSystemWatcher('**/xo.confi{g.cjs,g.js,g}'),
			workspace.createFileSystemWatcher('**/package.json')
		].map((watcher) => watcher.onDidChange(restart)),
		/**
		 * react to config changes - if the `xo.validate` setting changes, we need to restart the client
		 */
		workspace.onDidChangeConfiguration((configChange: ConfigurationChangeEvent) => {
			queue.push(async () => {
				try {
					logger.debug('[client] Configuration change detected');

					const isValidateChanged = configChange.affectsConfiguration('xo.validate');

					if (isValidateChanged) {
						logger.info(
							'[client] xo.validate change detected, restarting client with new options.'
						);

						statusBar.text = '$(gear~spin)';
						statusBar.show();

						languageClient.clientOptions.documentSelector = xoConfig
							.get<string[]>('validate', [])
							.flatMap((language) => [
								{language, scheme: 'file'},
								{language, scheme: 'untitled'}
							]);

						await restart();

						statusBar.text = '$(xo-logo)';

						statusBar.hide();
						logger.info('[client] Restarted client with new xo.validate options.');
					}
				} catch (error) {
					if (error instanceof Error) {
						logger.error(`[client] There was a problem handling the configuration change.`);
						logger.error(error);
					}
				}
			});
		}),
		/**
		 * Only show status bar on relevant files where xo is set up to lint
		 * updated on every active editor change, also check if we should start the
		 * server for the first time if xo wasn't originally in the workspace
		 */
		window.onDidChangeActiveTextEditor((textEditor) => {
			queue.push(async () => {
				try {
					const {document: textDocument} = textEditor ?? {};

					logger.debug('[client] onDidChangeActiveTextEditor', textDocument?.uri.fsPath);

					const isEnabled = workspace
						.getConfiguration('xo', textDocument)
						.get<boolean>('enable', true);

					if (!isEnabled) {
						logger.debug('[client] onDidChangeActiveTextEditor > XO is not enabled');
						return;
					}

					await updateStatusBar(textDocument);

					if (
						isEnabled &&
						textDocument &&
						languageClient.needsStart() &&
						(await xoRootCache.get(textDocument.uri.fsPath))
					) {
						logger.debug('[client] Starting Language Client');
						await languageClient.start();
					}
				} catch (error) {
					if (error instanceof Error) {
						statusBar.text = '$(xo-logo)';
						logger.error(`[client] There was a problem handling the active text editor change.`);
						logger.error(error);
					}
				}
			});
		}),
		/**
		 * Check again whether or not we need a server instance
		 * if folders are added are removed from the workspace
		 */
		workspace.onDidCloseTextDocument((textDocument) => {
			queue.push(async () => {
				xoRootCache.delete(textDocument.uri.fsPath);
			});
		}),
		/**
		 * Dispose of the status bar when the extension is deactivated
		 */
		statusBar
	);

	if (hasValidXoRoot) {
		logger.info('[client] XO is enabled and is needed for linting file, server is now starting.');
		await languageClient.start();
		context.subscriptions.push(languageClient);
		return;
	}

	if (!hasValidXoRoot) {
		logger.info('[client] XO is enabled and server will start when a relevant file is opened.');
	}
}

export async function deactivate() {
	if (!languageClient) {
		return undefined;
	}

	return languageClient.stop();
}
