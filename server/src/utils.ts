import {Diagnostic, DiagnosticSeverity} from 'vscode-languageserver';
import type {Linter} from 'eslint';

function parseSeverity(severity: number): DiagnosticSeverity {
	switch (severity) {
		case 1:
			return DiagnosticSeverity.Warning;
		case 2:
			return DiagnosticSeverity.Error;
		default:
			return DiagnosticSeverity.Error;
	}
}

export function makeDiagnostic(problem: Linter.LintMessage): Diagnostic {
	const message = (problem.ruleId === null)
		? `${problem.message}`
		: `${problem.message} (${problem.ruleId})`;

	return {
		message,
		severity: parseSeverity(problem.severity),
		code: problem.ruleId,
		source: 'XO',
		range: {
			start: {line: problem.line - 1, character: problem.column - 1},
			end: {line: problem.line - 1, character: problem.column - 1},
		},
	};
}

export function computeKey(diagnostic: Diagnostic): string {
	const range = diagnostic.range;
	return `[${range.start.line},${range.start.character},${range.end.line},${range.end.character}]-${diagnostic.code}`;
}
