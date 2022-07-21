const utils = require('./utils');

class Fixes {
	constructor(edits) {
		this.edits = edits;
	}

	static overlaps(lastEdit, newEdit) {
		return Boolean(lastEdit) && lastEdit.edit.range[1] > newEdit.edit.range[0];
	}

	static sameRange(a, b) {
		return (
			a.edit.range[0] === b.edit.range[0] && a.edit.range[1] === b.edit.range[1]
		);
	}

	isEmpty() {
		return this.edits.sizes === 0;
	}

	getDocumentVersion() {
		if (this.isEmpty()) {
			throw new Error('No edits recorded.');
		}

		return this.edits.values().next().value.documentVersion;
	}

	getScoped(diagnostics) {
		const result = [];

		for (const diagnostic of diagnostics) {
			const key = utils.computeKey(diagnostic);
			const editInfo = this.edits.get(key);
			if (editInfo) {
				result.push(editInfo);
			}
		}

		return result;
	}

	getAllSorted() {
		const result = [];

		for (const edit of this.edits.values())
			if (edit.edit !== undefined) result.push(edit);

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
			if (!Fixes.overlaps(last, current) && !Fixes.sameRange(last, current)) {
				result.push(current);
				last = current;
			}
		}

		return result;
	}
}

module.exports = Fixes;
