import * as vscode from 'vscode';

let statusBar: vscode.StatusBarItem;

function updateStatusBar(): vscode.StatusBarItem | undefined {
	const xoConfig = vscode.workspace.getConfiguration('xo');
	const statusBarOption = xoConfig.get('statusBar');

	if (statusBarOption === 'Never') {
		if (statusBar) {
			statusBar.hide();
		}

		return;
	}

	statusBar = statusBar ?? vscode.window.createStatusBarItem('xoStatusBarItem', 2, 0);
	statusBar.text = '$(xo-logo)';
	statusBar.command = 'xo.showOutputChannel';

	const latestDocument = vscode.window.activeTextEditor?.document;
	const fileTypes = xoConfig.get('validate', []) as string[];

	const shouldShowStatusBar =
		statusBarOption === 'Always' ||
		(statusBarOption === 'Relevant' &&
			vscode.workspace.textDocuments.find(
				(textDocument) =>
					(textDocument.fileName === latestDocument?.fileName &&
						fileTypes.includes(textDocument.languageId)) ||
					textDocument.fileName.startsWith('extension-output')
			));

	if (shouldShowStatusBar) {
		statusBar.show();
	} else {
		statusBar.hide();
	}

	return statusBar;
}

export default updateStatusBar;
