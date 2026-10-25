import {
	workspace,
	window,
	ThemeColor,
	languages,
	LanguageStatusSeverity,
	type StatusBarItem,
	type TextDocument,
} from 'vscode';
import {xoRootCache} from './cache.ts';
import {isValidatedDocument} from './language-validation.ts';

const statusBar = window.createStatusBarItem('xoStatusBarItem', 2, 0);
statusBar.name = 'xo';
statusBar.command = 'xo.showOutputChannel';

// An empty selector keeps the menu entry hidden until active-file relevance is
// known. It is independent of xo.statusBar, which controls only the standalone icon.
const languageStatus = languages.createLanguageStatusItem('xoLanguageStatus', []);
languageStatus.name = 'XO';
languageStatus.text = 'XO';
languageStatus.command = {command: 'xo.showOutputChannel', title: 'Open XO logs'};

interface ServerStatus {
	scopeUri: string;
	operation?: string;
	state: 'error' | 'ready';
	message?: string;
}

const failures = new Map<string, Map<string, string>>();
let isRestarting = false;
let restartFailure: string | undefined;
let updateRevision = 0;
let highlightedFailure = '';
let isErrorHighlighted = false;
let errorFlashTimer: ReturnType<typeof setTimeout> | undefined;

export const statusItems = {
	/**
	 * Disposes both UI surfaces and cancels any pending flash timeout. Keeping
	 * their lifetimes together prevents a timer from refreshing disposed items
	 * after extension shutdown.
	 */
	dispose() {
		clearTimeout(errorFlashTimer);
		statusBar.dispose();
		languageStatus.dispose();
	},
};

/**
 * Retains failures independently by project and operation, then refreshes the
 * active editor rather than the document that happened to trigger the report.
 * Current servers omit operation and report one last-error state per scope.
 */
export function updateServerStatus(status: ServerStatus): void {
	const operation = status.operation ?? '';
	if (status.state === 'error') {
		const scopeFailures = failures.get(status.scopeUri) ?? new Map<string, string>();
		scopeFailures.set(operation, status.message ?? 'XO failed');
		failures.set(status.scopeUri, scopeFailures);
	} else {
		const scopeFailures = failures.get(status.scopeUri);
		scopeFailures?.delete(operation);
		if (scopeFailures?.size === 0) {
			failures.delete(status.scopeUri);
		}
	}

	void updateStatusBar(window.activeTextEditor?.document);
}

/**
 * Clears reports belonging to a stopped or replaced server. Restart failures
 * are deliberately separate: a new server's ready report must not clear them.
 */
export function resetServerStatus(): void {
	failures.clear();
	void updateStatusBar(window.activeTextEditor?.document);
}

/**
 * Tracks the client lifecycle independently of project health. Starting a new
 * attempt clears the previous lifecycle error; completion preserves any fresh
 * reports already received from the replacement server.
 */
export function updateRestartStatus(isInProgress: boolean, error?: unknown): void {
	isRestarting = isInProgress;
	restartFailure = error === undefined
		? undefined
		: `XO restart failed: ${error instanceof Error ? error.message : 'See XO logs for details'}`;
	void updateStatusBar(window.activeTextEditor?.document);
}

/**
 * Renders both the standalone icon and the native Language Status entry from the
 * same health snapshot. Only the icon obeys xo.statusBar; the menu entry follows
 * active-file relevance and xo.enable. Project failures bypass discovery so a
 * broken configuration cannot hide the explanation of its own failure.
 *
 * Each refresh invalidates older asynchronous checks and immediately removes the
 * previous document's menu entry. Its selector is restored only after the current
 * document is known to be relevant. A newly displayed error briefly highlights
 * the icon's background using VS Code's theme-aware error color. The timeout
 * refreshes through this renderer rather than changing appearance itself; the
 * tooltip and native menu retain the error after the highlight expires.
 */
export async function updateStatusBar(textDocument?: TextDocument): Promise<StatusBarItem> {
	const revision = ++updateRevision;
	const xoConfig = workspace.getConfiguration('xo', textDocument);
	const option = xoConfig.get<'Always' | 'Never' | 'Relevant'>('statusBar') ?? 'Relevant';
	const documentUri = textDocument?.uri.toString();
	const messages = [...failures]
		.filter(([scope]) => documentUri === scope || documentUri?.startsWith(`${scope.replace(/\/$/v, '')}/`))
		.flatMap(([, operations]) => operations.values().toArray());
	const failure = restartFailure ?? messages.join('\n');
	const hasFailure = failure !== '';
	statusBar.text = isRestarting ? '$(gear~spin)' : '$(xo-logo)';
	// Refreshes of the same visible failure must not restart the flash. Hiding
	// the icon, restarting, or recovering cancels it; a newly visible failure
	// gets one short highlight rather than a persistent or repeating animation.
	const visibleFailure = option === 'Never' || isRestarting ? '' : failure;
	if (visibleFailure !== highlightedFailure) {
		highlightedFailure = visibleFailure;
		clearTimeout(errorFlashTimer);
		errorFlashTimer = undefined;
		isErrorHighlighted = visibleFailure !== '';
		if (isErrorHighlighted) {
			/**
			 * Ends only the visual highlight, not the stored failure. Rendering the
			 * latest active editor also keeps timeout expiry safe across switches.
			 */
			errorFlashTimer = setTimeout(() => {
				isErrorHighlighted = false;
				errorFlashTimer = undefined;
				void updateStatusBar(window.activeTextEditor?.document);
			}, 2000);
		}
	}

	statusBar.backgroundColor = isErrorHighlighted ? new ThemeColor('statusBarItem.errorBackground') : undefined;
	statusBar.tooltip = isRestarting
		? 'XO is restarting'
		: (hasFailure ? `${failure}\nClick to open XO logs` : 'Show XO output channel');

	languageStatus.selector = [];
	languageStatus.busy = isRestarting;
	languageStatus.severity = LanguageStatusSeverity.Information;
	languageStatus.detail = 'Ready';
	if (hasFailure) {
		languageStatus.severity = LanguageStatusSeverity.Error;
		languageStatus.detail = failure;
	}

	if (isRestarting) {
		languageStatus.severity = LanguageStatusSeverity.Information;
		languageStatus.detail = 'Restarting';
	}

	// Never suppresses only the standalone icon, not the relevance check below.
	if (option === 'Never') {
		statusBar.hide();
	} else {
		statusBar.show();
	}

	const isXoOutputChannel = textDocument?.uri.fsPath === 'samverschueren.linter-xo.xo';
	let isRelevant = hasFailure || isXoOutputChannel;
	if (textDocument && !isRelevant) {
		if (option === 'Relevant') {
			statusBar.text = '$(gear~spin)';
		}

		try {
			const hasXoRoot = await xoRootCache.get(textDocument.uri.fsPath);
			const xoVersion = hasXoRoot
				? await xoRootCache.getVersion(textDocument.uri.fsPath, xoConfig.get<string>('path') ?? '')
				: undefined;
			isRelevant = Boolean(hasXoRoot && isValidatedDocument(xoConfig, textDocument, xoVersion));
		} catch {
			// Discovery failure must not leave the temporary relevance spinner behind.
		}
	}

	if (revision !== updateRevision) {
		return statusBar;
	}

	statusBar.text = isRestarting ? '$(gear~spin)' : '$(xo-logo)';
	if (option === 'Relevant' && !isRelevant) {
		statusBar.hide();
	}

	if (textDocument && isRelevant && !isXoOutputChannel && xoConfig.get<boolean>('enable', true)) {
		// Active-editor changes synchronously clear this selector before awaiting
		// discovery, so the entry cannot carry project health into another editor.
		languageStatus.selector = [{scheme: textDocument.uri.scheme, language: textDocument.languageId}];
	}

	return statusBar;
}
