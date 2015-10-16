'use strict';

import { runSingleFileValidator, SingleFileValidator, InitializeResponse, IValidationRequestor, IDocument, Diagnostic, Severity, Files } from 'vscode-languageworker';

import * as path from 'path';
import * as fs from 'fs';
import objectAssign from 'object-assign';

let lintText: any = null;
let lintConfig: Object = null;

function makeDiagnostic(problem: any): Diagnostic {
	return {
		message: `${problem.message} (${problem.ruleId})`,
		severity: problem.severity === 2 ? Severity.Error : Severity.Warning,
		start: {
			line: problem.line,
			character: problem.column
		},
		end: {
			line: problem.line,
			character: problem.column
		}
	};
}

let validator : SingleFileValidator = {
	initialize: (rootFolder: string): Thenable<InitializeResponse> => {
		return Files.resolveModule(rootFolder, 'xo').then(xo => {
			lintText = xo.lintText;
			return null;
		}, (error) => {
			return Promise.reject({
				success: false,
				message: 'Failed to load xo library. Please install xo in your workspace folder using \'npm install xo\' and then press Retry.',
				retry: true
			});
		});
	},
	onConfigurationChange(settings: any, requestor: IValidationRequestor): void {
		// VSCode settings have changed and the requested settings changes
		// have been synced over to the language worker
		if (settings.xo) {
			lintConfig = settings.xo.options;
		}

		// Request re-validation of all open documents
		requestor.all();
	},
	validate: (document: IDocument): Diagnostic[] => {
		try {
			const uri = document.uri;
			const fsPath = Files.uriToFilePath(uri);
			const contents = document.getText();

			const report = lintText(contents, objectAssign({cwd: path.dirname(fsPath)}, lintConfig));

			let diagnostics: Diagnostic[] = [];

			report.results.forEach(result => {
				result.messages.forEach(message => {
					diagnostics.push(makeDiagnostic(message));
				});
			});

			return diagnostics;
		} catch (err) {
			let message: string = null;
			if (typeof err.message === 'string' || err.message instanceof String) {
				message = <string>err.message;
				throw new Error(message);
			}
			throw err;
		}
	}
};

runSingleFileValidator(process.stdin, process.stdout, validator);
