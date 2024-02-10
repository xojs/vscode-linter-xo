import {TextDocument} from 'vscode-languageserver-textdocument';
import {TextEdit, Range} from 'vscode-languageserver/node';
import Fix from './fix-builder';
import type LintServer from './server';
import {type DocumentFix} from './types';

/**
 * Computes the TextEdits for a text document uri
 */
async function getDocumentFormatting(
	this: LintServer,
	uri: string,
	range?: Range
): Promise<DocumentFix> {
	const cachedTextDocument = this.documents.get(uri);

	const defaultResponse = {
		documentVersion: cachedTextDocument?.version,
		edits: []
	};

	if (cachedTextDocument === undefined) return defaultResponse;

	const documentFixCache = this.documentFixCache.get(uri);

	if (documentFixCache === undefined || documentFixCache.size === 0) {
		return defaultResponse;
	}

	const documentFix = new Fix(cachedTextDocument, documentFixCache, range);

	if (documentFix.isEmpty()) {
		return defaultResponse;
	}

	const edits = documentFix.getTextEdits();

	const documentVersion = documentFix.getDocumentVersion();

	/**
	 * We only need to run the second pass lint if the
	 * document fixes have overlaps. Otherwise, all fixes can be applied.
	 */
	if (!documentFix.hasOverlaps) {
		return {
			documentVersion,
			edits
		};
	}

	const originalText = cachedTextDocument.getText();

	// clone the cached document
	const textDocument = TextDocument.create(
		cachedTextDocument.uri,
		cachedTextDocument.languageId,
		cachedTextDocument.version,
		originalText
	);

	// apply the edits to the copy and get the edits that would be
	// further needed for all the fixes to work.
	const editedContent = TextDocument.applyEdits(textDocument, edits);

	const report = await this.getLintResults(textDocument, editedContent, true);

	if (report.results[0].output && report.results[0].output !== editedContent) {
		this.log('Experimental replace triggered');
		const string0 = originalText;
		const string1 = report.results[0].output;

		let i = 0;
		while (i < string0.length && i < string1.length && string0[i] === string1[i]) {
			++i;
		}

		// length of common suffix
		let j = 0;
		while (
			i + j < string0.length &&
			i + j < string1.length &&
			string0[string0.length - j - 1] === string1[string1.length - j - 1]
		) {
			++j;
		}

		// eslint-disable-next-line unicorn/prefer-string-slice
		const newText = string1.substring(i, string1.length - j);
		const pos0 = cachedTextDocument.positionAt(i);
		const pos1 = cachedTextDocument.positionAt(string0.length - j);

		return {
			documentVersion: documentFix.getDocumentVersion(),
			edits: [TextEdit.replace(Range.create(pos0, pos1), newText)]
		};
	}

	return {
		documentVersion,
		edits: documentFix.getTextEdits()
	};
}

export default getDocumentFormatting;
