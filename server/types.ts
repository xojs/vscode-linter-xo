import type {Options, ResultReport} from 'xo';
import type {ESLint, Rule} from 'eslint';
import type {TextEdit} from 'vscode-languageserver/node';

export enum SeverityOption {
	off = 'off',
	warn = 'warn',
	error = 'error',
	info = 'info'
}

export type XoResult = ResultReport & ESLint.LintResultData;

export interface LintTextOptions extends Options {
	warnIgnored?: boolean;
	filePath?: string;
}

export interface Xo {
	lintText(text: string, options?: LintTextOptions): XoResult;
}

export interface FormatOption {
	enable: boolean;
}

export interface XoConfig {
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

export interface XoFix {
	label: string;
	documentVersion: string | number;
	ruleId: string;
	edit: Rule.Fix;
}

export interface DocumentFix {
	documentVersion?: string | number;
	edits: TextEdit[];
}
