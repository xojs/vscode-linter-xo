'use strict';
var vscode_languageworker_1 = require('vscode-languageworker');
var path = require('path');
var objectAssign = require('object-assign');
var lintText = null;
var lintConfig = null;
function makeDiagnostic(problem) {
    return {
        message: problem.message + " (" + problem.ruleId + ")",
        severity: problem.severity === 2 ? vscode_languageworker_1.Severity.Error : vscode_languageworker_1.Severity.Warning,
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
var validator = {
    initialize: function (rootFolder) {
        return vscode_languageworker_1.Files.resolveModule(rootFolder, 'xo').then(function (xo) {
            lintText = xo.lintText;
            return null;
        }, function (error) {
            return Promise.reject({
                success: false,
                message: 'Failed to load xo library. Please install xo in your workspace folder using \'npm install xo\' and then press Retry.',
                retry: true
            });
        });
    },
    onConfigurationChange: function (settings, requestor) {
        // VSCode settings have changed and the requested settings changes
        // have been synced over to the language worker
        if (settings.xo) {
            lintConfig = settings.xo.options;
        }
        // Request re-validation of all open documents
        requestor.all();
    },
    validate: function (document) {
        try {
            var uri = document.uri;
            var fsPath = vscode_languageworker_1.Files.uriToFilePath(uri);
            var contents = document.getText();
            var report = lintText(contents, objectAssign({ cwd: path.dirname(fsPath) }, lintConfig));
            var diagnostics = [];
            report.results.forEach(function (result) {
                result.messages.forEach(function (message) {
                    diagnostics.push(makeDiagnostic(message));
                });
            });
            return diagnostics;
        }
        catch (err) {
            var message = null;
            if (typeof err.message === 'string' || err.message instanceof String) {
                message = err.message;
                throw new Error(message);
            }
            throw err;
        }
    }
};
vscode_languageworker_1.runSingleFileValidator(process.stdin, process.stdout, validator);
//# sourceMappingURL=extension.js.map