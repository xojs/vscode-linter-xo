import type {TextEdit} from 'vscode-languageserver/node';
// eslint-disable-next-line import-x/no-extraneous-dependencies, n/no-extraneous-import
import type {ESLint, Rule, Linter} from 'eslint';

export interface XoLintResult {
	errorCount: number;
	warningCount: number;
	fixableErrorCount: number;
	fixableWarningCount: number;
	results: ESLint.LintResult[];
	rulesMeta: Record<string, Rule.RuleMetaData>;
}

export enum SeverityOption {
	off = 'off',
	warn = 'warn',
	error = 'error',
	info = 'info',
}

export type XoResult = XoLintResult & ESLint.LintResultData;

export interface LintTextOptions extends XoConfigOptions, LinterOptions {
	warnIgnored?: boolean;
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

// eslint-disable-next-line import-x/no-extraneous-dependencies, n/no-extraneous-import
export * from 'eslint';

export type Space = boolean | number | string | undefined;

export interface XoConfigOptions {
	/**
	* Use spaces for indentation.
	 *
	* Tabs are used if the value is `false`, otherwise the value is the number of spaces to use or true, the default number of spaces is 2.
	*/
	space?: Space;

	/**
	* Use semicolons at the end of statements or error for semi-colon usage.
	*/
	semicolon?: boolean;

	/**
	* Add React support.
	*/
	react?: boolean;

	/**
	* Files to ignore, can be a glob or array of globs.
	*/
	ignores?: string | string[];
}

export interface LinterOptions {
	/**
	* The current working directory to use for relative paths.
	*/
	cwd: string;

	/**
	* Write fixes to the files.
	*/
	fix?: boolean;

	/**
	* The path to the file being linted.
	*/
	filePath?: string;

	/**
	* If true, show only errors and NOT warnings. false by default.
	*/
	quiet?: boolean;

	/**
	* Auto-configure type aware linting on unincluded TS files.
	 *
	* Ensures that TypeScript files are linted with the type-aware parser even if they are not explicitly included in the tsconfig.
	 *
	*/
	ts?: boolean;

	/**
	* Custom path to config to use for the linter.
	*/
	configPath?: string;
}

export interface LintTextOptions {
	/**
	* The path to the file being linted.
	*/
	filePath: string;

	/**
	* Warn if the file is ignored.
	*/
	warnIgnored?: boolean;
}

export type XoConfigItem = XoConfigOptions
	& Omit<Linter.Config, 'files' | 'ignores'> & {
		/**
	* An array of glob patterns indicating the files that the configuration object should apply to. If not specified, the configuration object applies to all files.
		 *
	* @see [Ignore Patterns](https://eslint.org/docs/latest/user-guide/configuring/configuration-files-new#excluding-files-with-ignores)
	*/
		files?: string | string[] | undefined;

		/**
	* An array of glob patterns indicating the files that the configuration object should not apply to. If not specified, the configuration object applies to all files matched by files.
		 *
	* @see [Ignore Patterns](https://eslint.org/docs/latest/user-guide/configuring/configuration-files-new#excluding-files-with-ignores)
	*/
		ignores?: string | string[] | undefined;
	};

export type FlatXoConfig = XoConfigItem | XoConfigItem[];

export interface XoLintResult {
	errorCount: number;
	warningCount: number;
	fixableErrorCount: number;
	fixableWarningCount: number;
	results: ESLint.LintResult[];
	rulesMeta: Record<string, Rule.RuleMetaData>;
}
