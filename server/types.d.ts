import type {Options, ResultReport} from 'xo';
import type {ESLint, Rule} from 'eslint';
import type {TextEdit} from 'vscode-languageserver/node';

declare enum SeverityOption {
	off = 'off',
	warn = 'warn',
	error = 'error',
	info = 'info'
}

declare global {
	type XoResult = ResultReport & ESLint.LintResultData;

	interface LintTextOptions extends Options {
		warnIgnored?: boolean;
		filePath?: string;
	}

	interface Xo {
		lintText(text: string, options?: LintTextOptions): XoResult;
	}

	interface FormatOption {
		enable: boolean;
	}

	interface XoConfig {
		enable?: boolean;
		options?: Options;
		overrideSeverity?: SeverityOption;
		debounce?: number;
		path?: string;
		runtime?: string;
		validate?: string;
		statusBar?: string;
		format?: FormatOption;
	}

	interface XoFix {
		label: string;
		documentVersion: string | number;
		ruleId: string;
		edit: Rule.Fix;
	}

	interface DocumentFix {
		documentVersion?: string | number;
		edits: TextEdit[];
	}
}
