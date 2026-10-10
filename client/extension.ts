import process from 'node:process';
import {
	type ConfigurationChangeEvent,
	type ExtensionContext,
	workspace,
	window,
	commands,
} from 'vscode';
import {
	LanguageClient,
	TransportKind,
	type LanguageClientOptions,
	type ServerOptions,
} from 'vscode-languageclient/node';
import Queue from 'queue';
import pkg from '../package.json';
import {updateStatusBar} from './status-bar.ts';
import {xoRootCache} from './cache.ts';
import {fixAllProblems} from './fix-all-problems.ts';
import {getDocumentSelector} from './language-validation.ts';

let languageClient: LanguageClient;

const queue = new Queue({autostart: true, concurrency: 1});

/**
 * Activates the extension, creates its single language client, and wires VS Code
 * events to that client. Configuration-file events are deliberately coalesced
 * here because editors commonly emit several filesystem events for one save,
 * while the language client's stop/start lifecycle only supports one transition
 * at a time.
 */
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
			options: {
				execArgv: ['--enable-source-maps'],
				cwd: process.cwd(),
			},
		},
		debug: {
			module: serverModule,
			runtime,
			transport: TransportKind.ipc,
			options: {
				execArgv: ['--enable-source-maps', '--nolazy', '--inspect=6004'],
				cwd: process.cwd(),
			},
		},
	};

	const clientOptions: LanguageClientOptions = {
		documentSelector: getDocumentSelector(xoConfig),
		outputChannel: logger,
		synchronize: {
			configurationSection: 'xo',
		},
	};

	languageClient = new LanguageClient('xo', serverOptions, clientOptions);
	const {default: pDebounce} = await import('p-debounce');

	/**
	 * Starts an inactive client or replaces its running server process. The
	 * promise-level debounce prevents overlapping lifecycle transitions, and the
	 * timed debounce folds the create/change/delete events from one atomic save
	 * into a single operation.
	 */
	const restart = pDebounce(
		pDebounce.promise(async () => {
			try {
				if (!languageClient.isRunning()) {
					logger.info('[client] Starting client');
					await languageClient.start();
					logger.info('[client] Starting client success');
					return;
				}

				logger.info('[client] Restarting client');
				await languageClient.restart();
				logger.info('[client] Restarting client success');
			} catch (error) {
				languageClient.error('[client] Restarting client failed', error, 'force');
				throw error;
			}
		}),
		200,
	);

	/**
	 * Requests the shared restart from filesystem event callbacks without leaking
	 * a rejected promise into VS Code's event dispatcher. The restart operation
	 * already records the underlying failure in the language client output.
	 */
	const restartAfterConfigChange = () => {
		void restart().catch(() => undefined);
	};

	const configWatchers = [
		workspace.createFileSystemWatcher('**/.eslintignore'),
		workspace.createFileSystemWatcher('**/.xo-confi{g.cjs,g.json,g.js,g}'),
		workspace.createFileSystemWatcher('**/xo.confi{g.cjs,g.js,g.mjs,g.ts,g.cts,g.mts}'),
		workspace.createFileSystemWatcher('**/package.json'),
	];

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
		...configWatchers,
		...configWatchers.flatMap(watcher => [
			watcher.onDidCreate(restartAfterConfigChange),
			watcher.onDidChange(restartAfterConfigChange),
			watcher.onDidDelete(restartAfterConfigChange),
		]),
		/**
		 * react to config changes - if the `xo.validate` setting changes, we need to restart the client
		 */
		workspace.onDidChangeConfiguration((configChange: ConfigurationChangeEvent) => {
			queue.push(done => {
				void (async () => {
					try {
						logger.debug('[client] Configuration change detected');

						const isValidateChanged = configChange.affectsConfiguration('xo.validate');

						if (isValidateChanged) {
							logger.info(
								'[client] xo.validate change detected, restarting client with new options.',
							);

							statusBar.text = '$(gear~spin)';
							statusBar.show();

							languageClient.clientOptions.documentSelector = getDocumentSelector(xoConfig);

							await restart();

							statusBar.text = '$(xo-logo)';

							statusBar.hide();
							logger.info('[client] Restarted client with new xo.validate options.');
						}
					} catch (error) {
						if (error instanceof Error) {
							logger.error('[client] There was a problem handling the configuration change.');
							logger.error(error);
						}
					}
				})().finally(() => {
					done?.();
				});
			});
		}),
		/**
		 * Only show status bar on relevant files where xo is set up to lint
		 * updated on every active editor change, also check if we should start the
		 * server for the first time if xo wasn't originally in the workspace
		 */
		window.onDidChangeActiveTextEditor(textEditor => {
			queue.push(done => {
				void (async () => {
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
							isEnabled
							&& textDocument
							&& languageClient.needsStart()
							&& (await xoRootCache.get(textDocument.uri.fsPath))
						) {
							logger.debug('[client] Starting Language Client');
							await restart();
						}
					} catch (error) {
						if (error instanceof Error) {
							statusBar.text = '$(xo-logo)';
							logger.error('[client] There was a problem handling the active text editor change.');
							logger.error(error);
						}
					}
				})().finally(() => {
					done?.();
				});
			});
		}),
		/**
		 * Check again whether or not we need a server instance
		 * if folders are added are removed from the workspace
		 */
		workspace.onDidCloseTextDocument(textDocument => {
			queue.push(done => {
				xoRootCache.delete(textDocument.uri.fsPath);
				done?.();
			});
		}),
		/**
		 * Dispose of the status bar when the extension is deactivated
		 */
		statusBar,
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
	await languageClient?.stop();
}
