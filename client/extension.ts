import {type ConfigurationChangeEvent, type ExtensionContext, workspace, window} from 'vscode';
import {type LanguageClient, type DocumentSelector} from 'vscode-languageclient/node';
import Queue from 'queue';
import pkg from '../package.json';
import {createLanguageClient} from './create-language-client';
import {updateStatusBar} from './status-bar';
import {xoRootCache} from './cache';
import {registerCommands} from './register-commands';

let languageClient: LanguageClient;

const queue = new Queue({autostart: true, concurrency: 1});

export async function activate(context: ExtensionContext) {
	const logger = window.createOutputChannel('xo', {log: true});
	xoRootCache.logger = logger;

	logger.info(`[client] Activating XO extension v${pkg.version}`);

	const xoConfig = workspace.getConfiguration('xo');
	const runtime = xoConfig.get<string>('runtime');
	const languages = xoConfig.get<string[]>('validate');
	const hasValidXoRoot = await xoRootCache.get(window.activeTextEditor?.document.uri.fsPath);

	languageClient = await createLanguageClient({context, outputChannel: logger, runtime, languages});
	/**
	 * Update status bar on activation, and dispose of the status bar when the extension is deactivated
	 */
	const statusBar = await updateStatusBar(window.activeTextEditor?.document);

	registerCommands({context, client: languageClient, logger});

	context.subscriptions.push(
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

						const languages = workspace.getConfiguration('xo').get<string[]>('validate');

						languageClient.clientOptions.documentSelector = [];
						if (languages && languages.length > 0)
							for (const language of languages) {
								(languageClient.clientOptions.documentSelector as DocumentSelector).push(
									{language, scheme: 'file'},
									{language, scheme: 'untitled'}
								);
							}

						await languageClient.restart();

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
