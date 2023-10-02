import {workspace, window, type StatusBarItem, type TextDocument} from 'vscode';
import {xoRootCache} from './cache';

const statusBar = window.createStatusBarItem('xoStatusBarItem', 2, 0);
statusBar.name = 'xo';
statusBar.text = '$(xo-logo)';
statusBar.command = 'xo.showOutputChannel';
statusBar.tooltip = 'Show XO output channel';

export async function updateStatusBar(textDocument?: TextDocument): Promise<StatusBarItem> {
	try {
		const xoConfig = workspace.getConfiguration('xo', textDocument);

		const statusBarOption =
			xoConfig.get<'Always' | 'Never' | 'Relevant'>('statusBar') ?? 'Relevant';
		if (statusBarOption === 'Never') {
			statusBar.hide();
			return statusBar;
		}

		statusBar.text = '$(gear~spin)';
		statusBar.show();

		if (statusBarOption === 'Always') {
			statusBar.show();
			return statusBar;
		}

		if (!textDocument) {
			statusBar.hide();
			return statusBar;
		}

		const languages = xoConfig.get<string[]>('validate', [
			'javascript',
			'javascriptreact',
			'typescript',
			'typescriptreact',
			'vue'
		]);
		const isXoOutputChannel = textDocument.uri.fsPath === 'samverschueren.linter-xo.xo';
		const isRelevantLanguage = languages.includes(textDocument.languageId);
		const hasXoRoot = await xoRootCache.get(textDocument.uri.fsPath);

		const isRelevant = isXoOutputChannel || (isRelevantLanguage && hasXoRoot);

		if (isRelevant) statusBar.show();
		else statusBar.hide();

		statusBar.text = '$(xo-logo)';
		return statusBar;
	} catch {
		return statusBar;
	}
}
