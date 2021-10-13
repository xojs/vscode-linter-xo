const node = require('vscode-languageserver/node');

function parseSeverity(severity) {
	switch (severity) {
		case 1:
			return node.DiagnosticSeverity.Warning;
		case 2:
			return node.DiagnosticSeverity.Error;
		default:
			return node.DiagnosticSeverity.Error;
	}
}

function makeDiagnostic(problem) {
	const message =
		// eslint-disable-next-line no-negated-condition
		problem.ruleId !== null
			? `${problem.message} (${problem.ruleId})`
			: `${problem.message}`;
	return {
		message,
		severity: parseSeverity(problem.severity),
		code: problem.ruleId,
		source: 'XO',
		range: {
			start: {line: problem.line - 1, character: problem.column - 1},
			end: {line: problem.line - 1, character: problem.column - 1}
		}
	};
}

function computeKey(diagnostic) {
	const {range} = diagnostic;
	return `[${range.start.line},${range.start.character},${range.end.line},${range.end.character}]-${diagnostic.code}`;
}

module.exports = {
	computeKey,
	makeDiagnostic
};
