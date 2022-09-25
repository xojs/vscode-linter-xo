import {Range, TextEdit} from 'vscode-languageserver/node';

import isUndefined from 'lodash/isUndefined';
import {TextDocument} from 'vscode-languageserver-textdocument';

class Fix {
	static overlaps(lastEdit: XoFix, newEdit: XoFix) {
		return Boolean(lastEdit) && lastEdit.edit.range[1] > newEdit.edit.range[0];
	}

	static sameRange(a: XoFix, b: XoFix) {
		return a.edit.range[0] === b.edit.range[0] && a.edit.range[1] === b.edit.range[1];
	}

	edits: Map<string, XoFix>;
	textDocument: TextDocument;
	hasOverlaps: boolean;

	constructor(_textDocument: TextDocument, _edits: Map<string, XoFix>) {
		this.hasOverlaps = false;
		this.edits = _edits;
		this.textDocument = _textDocument;
	}

	isEmpty() {
		return this.edits.size === 0;
	}

	getDocumentVersion(): string | number {
		if (this.isEmpty()) {
			throw new Error('No edits recorded.');
		}

		const {documentVersion} = [...this.edits.values()][0];

		return documentVersion;
	}

	/**
	 * getAllSorted
	 *
	 * gets all the edits sorted by location in an array
	 */
	getAllSorted() {
		const result = [];

		for (const edit of this.edits.values()) if (!isUndefined(edit.edit)) result.push(edit);

		return result.sort((a, b) => {
			const d = a.edit.range[0] - b.edit.range[0];
			if (d !== 0) return d;
			const aLen = a.edit.range[1] - a.edit.range[0];
			const bLen = b.edit.range[1] - b.edit.range[0];
			if (aLen !== bLen) return 0;
			if (aLen === 0) return -1;
			if (bLen === 0) return 1;
			return aLen - bLen;
		});
	}

	/**
	 * getOverlapFree
	 *
	 * returns the sorted results in an array
	 * with all illegal overlapping results filtered out
	 */
	getOverlapFree() {
		const sorted = this.getAllSorted();
		if (sorted.length <= 1) {
			return sorted;
		}

		const result = [];
		let last = sorted[0];
		result.push(last);
		for (let i = 1; i < sorted.length; i++) {
			const current = sorted[i];
			if (!Fix.overlaps(last, current) && !Fix.sameRange(last, current)) {
				this.hasOverlaps = true;
				result.push(current);
				last = current;
			}
		}

		return result;
	}

	/**
	 * getTextEdits
	 *
	 * get the vscode array of text edits
	 */
	getTextEdits() {
		const overlapFree = this.getOverlapFree();

		return overlapFree.map((editInfo) =>
			TextEdit.replace(
				Range.create(
					this.textDocument.positionAt(editInfo.edit.range[0]),
					this.textDocument.positionAt(editInfo.edit.range[1])
				),
				editInfo.edit.text || ''
			)
		);
	}
}

export default Fix;
