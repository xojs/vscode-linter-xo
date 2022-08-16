const {TextEdit, Range} = require('vscode-languageserver/node');
const FixesBuilder = require('./fixes-builder');

async function getDocumentFixes(uri) {
	let result = null;
	const textDocument = this.documents.get(uri);
	const edits = this.documentEdits.get(uri);
	if (edits && edits.size > 0) {
		const fixes = new FixesBuilder(edits);
		if (!fixes.isEmpty()) {
			result = {
				documentVersion: fixes.getDocumentVersion(),
				edits: fixes
					.getOverlapFree()
					.map((editInfo) =>
						TextEdit.replace(
							Range.create(
								textDocument.positionAt(editInfo.edit.range[0]),
								textDocument.positionAt(editInfo.edit.range[1])
							),
							editInfo.edit.text || ''
						)
					)
			};
		}
	}

	return result;
}

module.exports = getDocumentFixes;
