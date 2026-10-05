import {type LanguageClient, type TextEdit, RequestType} from 'vscode-languageclient/node';
import * as vscode from 'vscode';
import type {DocumentFix} from '../server/types.ts';

// eslint-disable-next-line @typescript-eslint/naming-convention
const AllFixesRequest = {
	type: new RequestType('textDocument/xo/allFixes'),
};

/**
 * Runs the explicit fix-all command as one guarded operation. An absent result
 * or empty edit list is a normal outcome when linting found nothing fixable.
 * Actual request and edit failures are logged without leaking a raw command
 * rejection, then represented by one concise user message.
 */
export async function fixAllProblems(client: LanguageClient): Promise<void> {
	const textEditor = vscode.window.activeTextEditor;
	if (!textEditor) {
		return;
	}

	const uri = textEditor.document.uri.toString();
	try {
		const result = (await client.sendRequest(AllFixesRequest.type, {
			textDocument: {uri},
		})) as DocumentFix | undefined;

		if (result === undefined || result.edits.length === 0) {
			return;
		}

		await applyTextEdits(uri, Number(result.documentVersion), result.edits, client);
	} catch (error: unknown) {
		client.error('[client] XO fix-all failed', error, false);
		await vscode.window.showErrorMessage(
			'XO could not fix this document. See the XO output for details.',
		);
	}
}

/**
 * Applies versioned protocol edits only while the same editor and document
 * version remain active. Version drift is expected during an asynchronous
 * request, so it receives the existing informational message and returns before
 * any stale edit can reach VS Code.
 */
async function applyTextEdits(
	uri: string,
	documentVersion: number,
	edits: TextEdit[],
	client: LanguageClient,
): Promise<void> {
	const textEditor = vscode.window.activeTextEditor;
	if (textEditor?.document.uri.toString() !== uri) {
		return;
	}

	if (textEditor.document.version !== documentVersion) {
		await vscode.window.showInformationMessage(
			'xo fixes are outdated and can\'t be applied to the document.',
		);
		return;
	}

	const isSuccess = await textEditor.edit(mutator => {
		for (const edit of edits) {
			mutator.replace(client.protocol2CodeConverter.asRange(edit.range), edit.newText);
		}
	});

	if (!isSuccess) {
		throw new Error('VS Code rejected the XO workspace edit.');
	}
}
