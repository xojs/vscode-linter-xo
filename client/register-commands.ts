import {type ExtensionContext, commands, type LogOutputChannel} from 'vscode';
import {type LanguageClient} from 'vscode-languageclient/node';
import {fixAllProblems} from './fix-all-problems';

export function registerCommands({
	context,
	client,
	logger
}: {
	context: ExtensionContext;
	client: LanguageClient;
	logger: LogOutputChannel;
}) {
	context.subscriptions.push(
		/**
		 * register xo extensions provided commands
		 */
		commands.registerCommand('xo.fix', async () => fixAllProblems(client)),
		commands.registerCommand('xo.showOutputChannel', () => {
			logger.show();
		}),
		commands.registerCommand('xo.restart', async () => {
			try {
				logger.info('[client] Restarting client');
				await client.restart();
			} catch (error) {
				client.error(`[client] Restarting client failed`, error, 'force');
			}
		})
	);
}
