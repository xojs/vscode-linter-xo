import isUndefined from 'lodash/isUndefined';
import FixesBuilder from './fixes-builder';
import type LintServer from './server';

/**
 * Computes the TextEdits for a text document uri
 */
async function getDocumentFixes(this: LintServer, uri: string): Promise<DocumentFixes | undefined> {
	const textDocument = this.documents.get(uri);

	if (isUndefined(textDocument)) return;

	const edits = this.documentFixes.get(uri);

	if (isUndefined(edits) || edits.size > 0) return;

	const fixes = new FixesBuilder(textDocument, edits);

	if (fixes.isEmpty()) return;

	return {
		documentVersion: fixes.getDocumentVersion(),
		edits: fixes.getTextEdits()
	};
}

export default getDocumentFixes;
