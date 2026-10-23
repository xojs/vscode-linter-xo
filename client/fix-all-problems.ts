import {type LanguageClient, type TextEdit, RequestType} from 'vscode-languageclient/node';
import * as vscode from 'vscode';
// The optional XO request is an extension to LSP, not a server implementation API.
interface DocumentFix {
	documentVersion?: string | number;
	edits: TextEdit[];
}

// eslint-disable-next-line @typescript-eslint/naming-convention
const AllFixesRequest = {
	type: new RequestType('textDocument/xo/allFixes'),
};

export async function fixAllProblems(client: LanguageClient) {
	const textEditor = vscode.window.activeTextEditor;
	if (!textEditor) {
		return;
	}

	const uri = textEditor.document.uri.toString();

	const result = (await client.sendRequest(AllFixesRequest.type, {
		textDocument: {uri},
	})) as DocumentFix;

	try {
		await applyTextEdits(uri, Number(result.documentVersion), result.edits, client);
	} catch {
		await vscode.window.showErrorMessage(
			'Failed to apply xo fixes to the document. Please consider opening an issue with steps to reproduce.',
		);
	}
}

async function applyTextEdits(
	uri: string,
	documentVersion: number,
	edits: TextEdit[],
	client: LanguageClient,
) {
	const textEditor = vscode.window.activeTextEditor;

	if (textEditor?.document.uri.toString() !== uri) {
		return;
	}

	if (textEditor.document.version !== documentVersion) {
		await vscode.window.showInformationMessage(
			'xo fixes are outdated and can\'t be applied to the document.',
		);
	}

	const isSuccess = await textEditor.edit(mutator => {
		for (const edit of edits) {
			mutator.replace(client.protocol2CodeConverter.asRange(edit.range), edit.newText);
		}
	});

	if (!isSuccess) {
		await vscode.window.showErrorMessage(
			'Failed to apply xo fixes to the document. Please consider opening an issue with steps to reproduce.',
		);
	}
}
