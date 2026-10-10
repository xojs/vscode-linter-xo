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
 * Updates the shared status item for the active document. Automatic validation
 * uses the cached installed XO version so the icon appears only when the server
 * will actually lint the active file; explicit validation lists are honored
 * without applying a version restriction.
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
		const hasXoRoot = await xoRootCache.get(textDocument.uri.fsPath);
		const xoVersion = hasXoRoot
			? await xoRootCache.getVersion(
				textDocument.uri.fsPath,
				xoConfig.get<string>('path') ?? '',
			)
			: undefined;
		const isRelevantLanguage = isValidatedDocument(xoConfig, textDocument, xoVersion);
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
