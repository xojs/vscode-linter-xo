const {RequestType} = require('vscode-languageclient/node');
const vscode = require('vscode');

const AllFixesRequest = {
	type: new RequestType('textDocument/xo/allFixes')
};

/**
 *
 * @param {import('vscode-languageclient/node').LanguageClient} client
 */
function fixAllProblems(client) {
	const textEditor = vscode.window.activeTextEditor;
	if (!textEditor) {
		return;
	}

	const uri = textEditor.document.uri.toString();
	client.sendRequest(AllFixesRequest.type, {textDocument: {uri}}).then(
		(result) => {
			if (result) {
				applyTextEdits(uri, result.documentVersion, result.edits, client);
			}
		},
		() => {
			vscode.window.showErrorMessage(
				'Failed to apply xo fixes to the document. Please consider opening an issue with steps to reproduce.'
			);
		}
	);
}

/**
 * @param {import('vscode-languageclient/node').LanguageClient} client
 */
function applyTextEdits(uri, documentVersion, edits, client) {
	const textEditor = vscode.window.activeTextEditor;
	if (textEditor && textEditor.document.uri.toString() === uri) {
		if (textEditor.document.version !== documentVersion) {
			vscode.window.showInformationMessage(
				"xo fixes are outdated and can't be applied to the document."
			);
		}

		textEditor
			.edit((mutator) => {
				for (const edit of edits) {
					mutator.replace(client.protocol2CodeConverter.asRange(edit.range), edit.newText);
				}
			})
			.then((success) => {
				if (!success) {
					vscode.window.showErrorMessage(
						'Failed to apply xo fixes to the document. Please consider opening an issue with steps to reproduce.'
					);
				}
			});
	}
}

module.exports = fixAllProblems;
