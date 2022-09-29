import type {LanguageClient, TextEdit} from 'vscode-languageclient/node';
import {RequestType} from 'vscode-languageclient/node';
import type {Uri} from 'vscode';
import * as vscode from 'vscode';

// eslint-disable-next-line @typescript-eslint/naming-convention
const AllFixesRequest = {
	type: new RequestType('textDocument/xo/allFixes')
};

async function fixAllProblems(client: LanguageClient) {
	const textEditor = vscode.window.activeTextEditor;
	if (!textEditor) {
		return;
	}

	const uri = textEditor.document.uri.toString();

	const result = (await client.sendRequest(AllFixesRequest.type, {
		textDocument: {uri}
	})) as DocumentFix;

	try {
		await applyTextEdits(uri, Number(result.documentVersion), result.edits, client);
	} catch {
		await vscode.window.showErrorMessage(
			'Failed to apply xo fixes to the document. Please consider opening an issue with steps to reproduce.'
		);
	}
}

async function applyTextEdits(
	uri: string,
	documentVersion: number,
	edits: TextEdit[],
	client: LanguageClient
) {
	const textEditor = vscode.window.activeTextEditor;
	if (textEditor?.document.uri.toString() === uri) {
		if (textEditor.document.version !== documentVersion) {
			await vscode.window.showInformationMessage(
				"xo fixes are outdated and can't be applied to the document."
			);
		}

		const success = await textEditor.edit((mutator) => {
			for (const edit of edits) {
				mutator.replace(client.protocol2CodeConverter.asRange(edit.range), edit.newText);
			}
		});

		if (!success) {
			await vscode.window.showErrorMessage(
				'Failed to apply xo fixes to the document. Please consider opening an issue with steps to reproduce.'
			);
		}
	}
}

export default fixAllProblems;
