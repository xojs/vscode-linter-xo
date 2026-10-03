import * as path from 'node:path';
import * as node from 'vscode-languageserver/node';
import loadJsonFile from 'load-json-file';
import {URI} from 'vscode-uri';
// eslint-disable-next-line import-x/no-extraneous-dependencies, n/no-extraneous-import
import type {Linter} from 'eslint';

export interface XoResult {
	xo?: string;
	pkgPath?: string;
	pkgJson?: any;
}

interface PkgJson {
	dependencies: Record<string, string>;
	devDependencies: Record<string, string>;
}

type Deps = Record<string, string>;

export function parseSeverity(severity: number): node.DiagnosticSeverity {
	switch (severity) {
		case 1: {
			return node.DiagnosticSeverity.Warning;
		}

		case 2: {
			return node.DiagnosticSeverity.Error;
		}

		default: {
			return node.DiagnosticSeverity.Error;
		}
	}
}

export function makeDiagnostic(problem: Linter.LintMessage): node.Diagnostic {
	const message =
		problem.ruleId === null ? problem.message : `${problem.message} (${problem.ruleId})`;
	return {
		message,
		severity: parseSeverity(problem.severity),
		code: problem.ruleId ?? '',
		source: 'XO',
		range: {
			start: {line: problem.line - 1, character: problem.column - 1},
			end: {
				line: (problem.endLine ?? problem.line) - 1,
				character: (problem.endColumn ?? problem.column) - 1,
			},
		},
	};
}

export function computeKey(diagnostic: node.Diagnostic): string {
	const {range} = diagnostic;
	return `[${range.start.line},${range.start.character},${range.end.line},${range.end.character}]-${
		diagnostic.code?.toString() ?? ''
	}`;
}

/**
 * Shortcut to convert a uri string to a path
 * URI.parse(uri).fsPath
 *
 * @param uri - The URI to convert into a local filesystem path.
 * @returns the uri fsPath
 */
export function uriToPath(uri: string): string {
	return URI.parse(uri).fsPath;
}

/**
 * Shortcut to convert a path to a uri string
 * URI.file(path).toString()
 *
 * @param filePath - The local filesystem path to convert into a URI.
 * @returns uri string
 */
export function pathToUri(filePath: string): string {
	return URI.file(filePath).toString();
}

/**
 * recursively searches up the directory tree to
 * find the nearest directory with a package json with an xo
 * dependency. Returns an empty object if none can be found.
 */
export async function findXoRoot(cwd: string): Promise<XoResult> {
	const {findUpSync} = await import('find-up');
	let searchDirectory = cwd;

	while (true) {
		const pkgPath = findUpSync('package.json', {cwd: searchDirectory});
		if (pkgPath === undefined || pkgPath === '') {
			return {};
		}

		const pkgJson = loadJsonFile.sync<PkgJson>(pkgPath);
		const deps: Deps = {
			...pkgJson.dependencies,
			...pkgJson.devDependencies,
		};

		if (deps.xo !== undefined && deps.xo !== '') {
			return {
				xo: deps.xo,
				pkgPath,
				pkgJson,
			};
		}

		const parentDirectory = path.resolve(path.dirname(pkgPath), '..');
		if (parentDirectory === path.dirname(pkgPath)) {
			return {};
		}

		searchDirectory = parentDirectory;
	}
}
