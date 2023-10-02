import {type ConfigurationChangeEvent, type ExtensionContext, workspace, window} from 'vscode';
import {type LanguageClient, type DocumentSelector} from 'vscode-languageclient/node';
import Queue from 'queue';
import pkg from '../package.json';
import {createLanguageClient} from './create-language-client';
import {updateStatusBar} from './status-bar';
import {xoRootCache} from './cache';
import {registerCommands} from './register-commands';

let client: LanguageClient;

const queue = new Queue({autostart: true, concurrency: 1});

export async function activate(context: ExtensionContext) {
	const logger = window.createOutputChannel('xo', {log: true});
	xoRootCache.logger = logger;

	logger.info(`[client] Activating XO extension v${pkg.version}`);
	logger.clear();

	const shouldStartServer = await xoRootCache.get(window.activeTextEditor?.document.uri.fsPath);
	const xoConfig = workspace.getConfiguration('xo');
	const runtime = xoConfig.get<string>('runtime');
	let languages = xoConfig.get<string[]>('validate')!;

	client = await createLanguageClient({context, outputChannel: logger, runtime, languages});
	/**
	 * Update status bar on activation, and dispose of the status bar when the extension is deactivated
	 */
	const statusBar = await updateStatusBar(window.activeTextEditor?.document);

	registerCommands({context, client, logger});

	context.subscriptions.push(
		/**
		 * react to config changes - if the `xo.validate` setting changes, we need to restart the client
		 */
		workspace.onDidChangeConfiguration((configChange: ConfigurationChangeEvent) => {
			queue.push(async () => {
				try {
					const isValidateChanged = configChange.affectsConfiguration('xo.validate');

					if (isValidateChanged) {
						logger.info(
							'[client] xo.validate change detected, restarting client with new options.'
						);

						statusBar.text = '$(gear~spin)';
						statusBar.show();

						languages = workspace.getConfiguration('xo').get<string[]>('validate', languages);

						client.clientOptions.documentSelector = [];
						if (languages && languages.length > 0)
							for (const language of languages) {
								(client.clientOptions.documentSelector as DocumentSelector).push(
									{language, scheme: 'file'},
									{language, scheme: 'untitled'}
								);
							}

						await client.restart();

						statusBar.text = '$(xo-logo)';

						statusBar.hide();
						logger.info('[client] Restarted client with new xo.validate options.');
					}

					const isEnabledChanged = configChange.affectsConfiguration('xo.enable');

					if (isEnabledChanged) {
						const enabled = workspace.getConfiguration('xo').get<boolean>('enable', true);

						if (client.needsStart() && enabled) {
							await client.start();
						}

						if (client.needsStop() && !enabled) {
							await client.dispose();
						}
					}
				} catch (error) {
					logger.error(`[client] Restarting client failed`, error);
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
					await updateStatusBar(textDocument);
					// if the client was not started
					if (
						textDocument &&
						client.needsStart() &&
						(await xoRootCache.get(textDocument.uri.fsPath))
					)
						await client.start();
				} catch (error) {
					statusBar.text = '$(xo-logo)';
					logger.error(`[client] There was a problem updating the statusbar`, error);
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
		statusBar
	);

	if (shouldStartServer) {
		logger.info('[client] XO was present in the workspace, server is now starting.');
		await client.start();
		context.subscriptions.push(client);
	} else {
		logger.info('[client] XO was not present in the workspace, server will not be started.');
	}
}

export async function deactivate() {
	if (!client) {
		return undefined;
	}

	return client.stop();
}
