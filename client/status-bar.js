const vscode = require('vscode');

let statusBar;

function updateStatusBar() {
	const xoConfig = vscode.workspace.getConfiguration('xo');
	const statusBarOption = xoConfig.get('statusBar');

	if (statusBarOption === 'Never') {
		if (statusBar) {
			statusBar.hide();
		}

		return;
	}

	statusBar = statusBar ? statusBar : vscode.window.createStatusBarItem('xoStatusBarItem', 2, 0);
	statusBar.text = '$(xo-logo)';
	statusBar.command = 'xo.showOutputChannel';

	const latestDocument = vscode.window.activeTextEditor?.document;
	const fileTypes = xoConfig.get('validate', []);

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

module.exports = updateStatusBar;
