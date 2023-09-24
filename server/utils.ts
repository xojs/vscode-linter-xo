import * as path from 'node:path';
import * as node from 'vscode-languageserver/node';
import loadJsonFile from 'load-json-file';
import {URI} from 'vscode-uri';
// eslint-disable-next-line import/no-extraneous-dependencies
import type {Linter} from 'eslint';

interface XoResult {
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
		problem.ruleId === null ? `${problem.message}` : `${problem.message} (${problem.ruleId})`;
	return {
		message,
		severity: parseSeverity(problem.severity),
		code: problem.ruleId ?? '',
		source: 'XO',
		range: {
			start: {line: problem.line - 1, character: problem.column - 1},
			end: {
				line: typeof problem.endLine === 'number' ? problem.endLine - 1 : problem.line - 1,
				character:
					typeof problem.endColumn === 'number' ? problem.endColumn - 1 : problem.column - 1
			}
		}
	};
}

export function computeKey(diagnostic: node.Diagnostic): string {
	const {range} = diagnostic;
	return `[${range.start.line},${range.start.character},${range.end.line},${range.end.character}]-${
		diagnostic.code?.toString() ?? ''
	}`;
}

export function uriToPath(uri: string): string {
	return URI.parse(uri).fsPath;
}

export function pathToUri(path: string): string {
	return URI.file(path).toString();
}

/**
 * recursively searches up the directory tree to
 * find the nearest directory with a package json with an xo
 * dependency. Returns an empty object if none can be found.
 */
export async function findXoRoot(cwd: string): Promise<XoResult | undefined> {
	const {findUp} = await import('find-up');
	const pkgPath = await findUp('package.json', {cwd});

	if (!pkgPath) return {};

	const pkgJson: PkgJson = await loadJsonFile(pkgPath);

	const deps: Deps = {
		...pkgJson?.dependencies,
		...pkgJson?.devDependencies
	};

	if (deps?.xo) {
		return {
			xo: deps?.xo,
			pkgPath,
			pkgJson
		};
	}

	return findXoRoot(path.resolve(path.dirname(pkgPath), '..'));
}
