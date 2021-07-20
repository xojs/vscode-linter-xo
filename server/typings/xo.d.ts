import type {ESLint} from 'eslint';

export interface XoReport {
	errorCount: number;
	warningCount: number;
	results: ESLint.LintResult[];
}

export default interface Xo {
	getFormatter(name: string): Promise<any>;
	getErrorResults(results: ESLint.LintResult[]): ESLint.LintResult[];
	outputFixes(results: any): Promise<any>;
	getConfig(options: any): Promise<any>;
	lintText(string: string, inputOptions: any): Promise<XoReport>;
	lintFiles(patterns: string | string[], inputOptions: any): Promise<XoReport>;
}
