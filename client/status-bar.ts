import {
	workspace,
	window,
	type StatusBarItem,
	type TextDocument,
} from 'vscode';
import {xoRootCache} from './cache.ts';
import {isValidatedDocument} from './language-validation.ts';

const statusBar = window.createStatusBarItem('xoStatusBarItem', 2, 0);
statusBar.name = 'xo';
statusBar.text = '$(xo-logo)';
statusBar.command = 'xo.showOutputChannel';
statusBar.tooltip = 'Show XO output channel';

/**
 * Updates the shared status item for the active document. Files added to XO 5's
 * defaults are considered relevant candidates here so users receive feedback
 * while the language server resolves the workspace's exact XO version and
 * decides whether to lint them.
 */
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

		const isXoOutputChannel = textDocument.uri.fsPath === 'samverschueren.linter-xo.xo';
		const isRelevantLanguage = isValidatedDocument(xoConfig, textDocument);
		const hasXoRoot = await xoRootCache.get(textDocument.uri.fsPath);

		const isRelevant = isXoOutputChannel || (isRelevantLanguage && hasXoRoot);

		if (isRelevant) {
			statusBar.show();
		} else {
			statusBar.hide();
		}

		statusBar.text = '$(xo-logo)';
		return statusBar;
	} catch {
		return statusBar;
	}
}
