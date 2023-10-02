import process from 'node:process';
import {workspace, type ExtensionContext, type LogOutputChannel} from 'vscode';
import {
	TransportKind,
	LanguageClient,
	type LanguageClientOptions,
	type ServerOptions
} from 'vscode-languageclient/node';

interface StartLanguageServerOptions {
	context: ExtensionContext;
	outputChannel: LogOutputChannel;
	languages?: string[];
	runtime?: string;
}

export async function createLanguageClient({
	context,
	outputChannel,
	languages,
	runtime
}: StartLanguageServerOptions) {
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

	// TODO: fix this better
	const documentSelector = [];

	if (languages && languages.length > 0)
		for (const language of languages) {
			documentSelector.push({language, scheme: 'file'}, {language, scheme: 'untitled'});
		}

	const clientOptions: LanguageClientOptions = {
		documentSelector,
		outputChannel,
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

	return new LanguageClient('xo', serverOptions, clientOptions);
}
