const path = require('node:path');
const {URI} = require('vscode-uri');
const node = require('vscode-languageserver/node');
const loadJsonFile = require('load-json-file');

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
		problem.ruleId !== null ? `${problem.message} (${problem.ruleId})` : `${problem.message}`;
	return {
		message,
		severity: parseSeverity(problem.severity),
		code: problem.ruleId,
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

function computeKey(diagnostic) {
	const {range} = diagnostic;
	return `[${range.start.line},${range.start.character},${range.end.line},${range.end.character}]-${diagnostic.code}`;
}

function uriToPath(uri) {
	return URI.parse(uri).fsPath;
}

function pathToUri(path) {
	return URI.file(path).toString();
}

/**
 * recursively searches up the directory tree to
 * find the nearest directory with a package json with an xo
 * dependency. Returns an empty object if none can be found.
 *
 * @param {string} cwd - A path to start at
 * @param {string} stopAt - A path to not look past
 */
async function findXoRoot(cwd, stopAt) {
	const {findUp} = await import('find-up');
	const pkgPath = await findUp('package.json', {cwd, stopAt});

	if (!pkgPath) return {};

	const pkgJson = await loadJsonFile(pkgPath);

	const deps = {
		...pkgJson.dependencies,
		...pkgJson.devDependencies
	};

	if (deps.xo) {
		return {
			xo: deps.xo,
			pkgPath,
			pkgJson
		};
	}

	return findXoRoot(path.join('..', path.dirname(pkgPath)), stopAt);
}

module.exports = {
	computeKey,
	makeDiagnostic,
	uriToPath,
	pathToUri,
	findXoRoot
};
