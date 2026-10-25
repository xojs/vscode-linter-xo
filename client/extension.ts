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
	State,
	TransportKind,
	type LanguageClientOptions,
	type ServerOptions,
} from 'vscode-languageclient/node';
import Queue from 'queue';
import {
	updateStatusBar,
	languageStatus,
	updateServerStatus,
	resetServerStatus,
	updateRestartStatus,
} from './status-bar.ts';
import {xoRootCache} from './cache.ts';
import {fixAllProblems} from './fix-all-problems.ts';
import {getDocumentSelector} from './language-validation.ts';

let languageClient: LanguageClient;

const queue = new Queue({autostart: true, concurrency: 1});

/**
 * Activates the extension, creates its single language client, and wires VS Code
 * events to that client. The bundled launcher starts the external server package
 * over Node IPC rather than relying on a server implementation in this repository.
 * Configuration-file events are deliberately coalesced
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
	languageClient.registerFeature({
		/**
		 * Advertises the optional UI without requiring server support. Older
		 * servers ignore this experimental capability and still supply logs.
		 */
		fillClientCapabilities(capabilities) {
			const experimental = capabilities.experimental as Record<string, unknown> | undefined;
			capabilities.experimental = {...experimental, xo: {status: true}};
		},
		/**
		 * The notification listener is registered before start, so this feature
		 * has no initialization-time subscriptions to install.
		 */
		initialize() {
			// The pre-start notification subscription survives server replacement.
		},
		/**
		 * Status support is permanent for this client rather than a dynamic
		 * registration negotiated separately for each document.
		 */
		getState() {
			return {kind: 'static'};
		},
		/**
		 * Server reports cannot survive a disconnect or replacement. Keeping
		 * this reset in the lifecycle feature also covers automatic restarts.
		 */
		clear() {
			resetServerStatus();
		},
	});
	context.subscriptions.push(
		languageClient,
		languageClient.onNotification('xo/status', updateServerStatus),
		languageClient.onDidChangeState(({newState}) => {
			if (newState === State.Starting) {
				resetServerStatus();
			}
		}),
	);
	const {default: pDebounce} = await import('p-debounce');

	/**
	 * Starts an inactive client or replaces its running server process. The
	 * promise-level debounce prevents overlapping lifecycle transitions, and the
	 * timed debounce folds the create/change/delete events from one atomic save
	 * into a single operation.
	 */
	const restart = pDebounce(
		pDebounce.promise(async () => {
			resetServerStatus();
			updateRestartStatus(true);
			try {
				if (!languageClient.isRunning()) {
					logger.info('[client] Starting client');
					await languageClient.start();
					logger.info('[client] Starting client success');
					updateRestartStatus(false);
					return;
				}

				logger.info('[client] Restarting client');
				await languageClient.restart();
				logger.info('[client] Restarting client success');
				updateRestartStatus(false);
			} catch (error) {
				updateRestartStatus(false, error);
				languageClient.error('[client] Restarting client failed', error, 'force');
				throw error;
			}
		}),
		200,
	);

	/**
	 * Invalidates client-side XO metadata and requests the shared restart after a
	 * watched package or configuration file changes. Once the replacement server
	 * is ready, the active document is checked again so its status reflects a new
	 * XO installation immediately rather than waiting for an editor switch.
	 */
	const restartAfterConfigChange = () => {
		xoRootCache.clear();
		void (async () => {
			await restart();
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
		 * react to config changes - if the `xo.validate` setting changes, we need to restart the client
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

						if (
							configChange.affectsConfiguration('xo.statusBar')
							|| configChange.affectsConfiguration('xo.enable')
						) {
							await updateStatusBar(window.activeTextEditor?.document);
						}

						if (isValidateChanged) {
							logger.info(
								'[client] xo.validate change detected, restarting client with new options.',
							);

							languageClient.clientOptions.documentSelector = getDocumentSelector(xoConfig);

							await restart();

							await updateStatusBar(window.activeTextEditor?.document);
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
			void updateStatusBar(textEditor?.document);
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
		languageStatus,
	);

	if (hasValidXoRoot) {
		logger.info('[client] XO is enabled and is needed for linting file, server is now starting.');
		await restart();
		return;
	}

	if (!hasValidXoRoot) {
		logger.info('[client] XO is enabled and server will start when a relevant file is opened.');
	}
}

/**
 * Stops the language client during extension shutdown so its server process and
 * transport do not outlive the extension host's subscriptions.
 */
export async function deactivate() {
	await languageClient?.stop();
}
