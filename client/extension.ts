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

	const {version} = context.extension.packageJSON as {version: string};
	logger.info(`[client] Activating XO extension v${version}`);

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
	 * Starts or restarts only when an open file still belongs to a package that
	 * declares XO. Rechecking here also covers manual restarts and removed dependencies.
	 * The promise-level debounce prevents overlapping lifecycle transitions, and the
	 * timed debounce folds the create/change/delete events from one atomic save
	 * into a single operation.
	 */
	const restart = pDebounce(
		pDebounce.promise(async () => {
			try {
				xoRootCache.clear();
				const xoRoots = await Promise.all(
					workspace.textDocuments
						.filter(document => document.uri.scheme === 'file')
						.map(async document => xoRootCache.get(document.uri.fsPath)),
				);
				if (!xoRoots.some(Boolean)) {
					logger.debug('[client] Skipping restart: no open file belongs to a package declaring XO.');
					return;
				}

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
				languageClient.error('[client] Restarting client failed', error, false);
				throw error;
			}
		}),
		200,
	);

	/**
	 * Invalidates XO metadata after package or configuration changes. Only an
	 * already-running client needs a restart; unrelated file changes must not
	 * start XO in projects that do not use it.
	 */
	const restartAfterConfigChange = () => {
		xoRootCache.clear();
		void (async () => {
			if (languageClient.isRunning()) {
				await restart();
			}

			await updateStatusBar(window.activeTextEditor?.document);
		})().catch(() => undefined);
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
		 * Keep the selector current for the next start, but only restart a running
		 * client so changing validation settings cannot activate XO by itself.
		 */
		workspace.onDidChangeConfiguration((configChange: ConfigurationChangeEvent) => {
			queue.push(done => {
				void (async () => {
					try {
						logger.debug('[client] Configuration change detected');

						const isValidateChanged = configChange.affectsConfiguration('xo.validate');
						const isPathChanged = configChange.affectsConfiguration('xo.path');

						if (isPathChanged) {
							xoRootCache.clear();
							await updateStatusBar(window.activeTextEditor?.document);
						}

						if (isValidateChanged) {
							languageClient.clientOptions.documentSelector = getDocumentSelector(xoConfig);

							if (languageClient.isRunning()) {
								logger.info(
									'[client] xo.validate change detected, restarting client with new options.',
								);
								statusBar.text = '$(gear~spin)';
								statusBar.show();

								await restart();

								statusBar.text = '$(xo-logo)';
								logger.info('[client] Restarted client with new xo.validate options.');
							}

							await updateStatusBar(window.activeTextEditor?.document);
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
