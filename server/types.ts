// @ts-expect-error this is fine since its just types imported from ESM module
import {type XoConfigOptions, type XoLintResult, type LinterOptions} from 'xo';
// eslint-disable-next-line import-x/no-extraneous-dependencies, n/no-extraneous-import
import {type ESLint, type Rule} from 'eslint';
import {type TextEdit} from 'vscode-languageserver/node';

export enum SeverityOption {
	off = 'off',
	warn = 'warn',
	error = 'error',
	info = 'info'
}

export type XoResult = XoLintResult & ESLint.LintResultData;

export interface LintTextOptions extends XoConfigOptions, LinterOptions {
	warnIgnored?: boolean;
	filePath?: string;
}

export interface Xo {
	lintText(text: string, options?: LintTextOptions): Promise<XoResult>;
}

export interface FormatOption {
	enable: boolean;
}

export interface XoConfig {
	enable?: boolean;
	options?: XoConfigOptions;
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
