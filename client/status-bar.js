const vscode = require('vscode');

let statusBar;

function updateStatusBar() {
	const xoOptions = vscode.workspace.getConfiguration('xo');

	statusBar = statusBar ? statusBar : vscode.window.createStatusBarItem('xoStatusBarItem', 2, 0);

	statusBar.text = '$(xo-logo)';

	statusBar.command = 'xo.showOutputChannel';

	// const foregroundColor = new vscode.ThemeColor('statusBarItem.foreground');
	// const backgroundColor = new vscode.ThemeColor('statusBarItem.background');
	// statusBar.color = foregroundColor;
	// statusBar.backgroundColor = backgroundColor;
	const showStatusBar = xoOptions.get('showStatusBar');

	if (showStatusBar) statusBar.show();
	else statusBar.hide();

	return statusBar;
}

module.exports = updateStatusBar;
