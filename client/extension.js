const process = require('process');
const vscode = require('vscode');
const {
	RequestType,
	TransportKind,
	LanguageClient,
	SettingMonitor
} = require('vscode-languageclient/node');
const isSANB = require('is-string-and-not-blank');

let client;

const AllFixesRequest = {
	type: new RequestType('textDocument/xo/allFixes')
};

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

	const clientOptions = {
		documentSelector: [
			{language: 'javascript', scheme: 'file'},
			{language: 'javascript', scheme: 'untitled'},
			{language: 'javascriptreact', scheme: 'file'},
			{language: 'javascriptreact', scheme: 'untitled'},
			{language: 'typescript', scheme: 'file'},
			{language: 'typescript', scheme: 'untitled'},
			{language: 'typescriptreact', scheme: 'file'},
			{language: 'typescriptreact', scheme: 'untitled'}
		],
		synchronize: {
			configurationSection: 'xo',
			fileEvents: [
				// we relint all open textDocuments whenever a config changes
				// that may possibly affect the options xo should be using
				vscode.workspace.createFileSystemWatcher('**/.eslintignore'),
				vscode.workspace.createFileSystemWatcher(
					'**/.xo-confi{g.cjs,g.json,g.js,g}'
				),
				vscode.workspace.createFileSystemWatcher('**/xo.confi{g.cjs,g.js,g}'),
				vscode.workspace.createFileSystemWatcher('**/package.json')
			]
		}
	};

	client = new LanguageClient('xo', serverOptions, clientOptions);

	context.subscriptions.push(
		new SettingMonitor(client, 'xo.enable').start(),
		vscode.commands.registerCommand('xo.fix', fixAllProblems),
		vscode.commands.registerCommand('xo.showOutputChannel', () => {
			client.outputChannel.show();
		})
	);

	const statusBar = vscode.window.createStatusBarItem('xoStatusBarItem', 2, 0);
	statusBar.text = 'XO';
	statusBar.command = 'xo.showOutputChannel';
	statusBar.show();
}

function fixAllProblems() {
	const textEditor = vscode.window.activeTextEditor;
	if (!textEditor) {
		return;
	}

	const uri = textEditor.document.uri.toString();
	client.sendRequest(AllFixesRequest.type, {textDocument: {uri}}).then(
		(result) => {
			if (result) {
				applyTextEdits(uri, result.documentVersion, result.edits);
			}
		},
		() => {
			vscode.window.showErrorMessage(
				'Failed to apply XO fixes to the document. Please consider opening an issue with steps to reproduce.'
			);
		}
	);
}

function applyTextEdits(uri, documentVersion, edits) {
	const textEditor = vscode.window.activeTextEditor;
	if (textEditor && textEditor.document.uri.toString() === uri) {
		if (textEditor.document.version !== documentVersion) {
			vscode.window.showInformationMessage(
				"XO fixes are outdated and can't be applied to the document."
			);
		}

		textEditor
			.edit((mutator) => {
				for (const edit of edits) {
					mutator.replace(
						client.protocol2CodeConverter.asRange(edit.range),
						edit.newText
					);
				}
			})
			.then((success) => {
				if (!success) {
					vscode.window.showErrorMessage(
						'Failed to apply XO fixes to the document. Please consider opening an issue with steps to reproduce.'
					);
				}
			});
	}
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
