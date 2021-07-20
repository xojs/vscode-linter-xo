import {Diagnostic} from 'vscode-languageserver';
import {computeKey} from './utils';

interface ESLintAutoFixEdit {
	range: [number, number];
	text: string;
}

export interface ESLintProblem {
	line: number;
	column: number;
	severity: number;
	ruleId: string;
	message: string;
	fix?: ESLintAutoFixEdit;
}

export interface AutoFix {
	label: string;
	documentVersion: number;
	ruleId: string;
	edit: ESLintAutoFixEdit;
}

/**
 * Credits to vscode-eslint (https://github.com/Microsoft/vscode-eslint)
 */
export class Fixes {
	private readonly keys: string[];

	constructor(private readonly edits: Record<string, AutoFix>) {
		this.keys = Object.keys(edits);
	}

	public static overlaps(lastEdit: AutoFix, newEdit: AutoFix): boolean {
		return Boolean(lastEdit) && lastEdit.edit.range[1] > newEdit.edit.range[0];
	}

	public isEmpty(): boolean {
		return this.keys.length === 0;
	}

	public getDocumentVersion(): number {
		return this.edits[this.keys[0]].documentVersion;
	}

	public getScoped(diagnostics: Diagnostic[]): AutoFix[] {
		const result: AutoFix[] = [];
		for (const diagnostic of diagnostics) {
			const key = computeKey(diagnostic);
			const editInfo = this.edits[key];
			if (editInfo) {
				result.push(editInfo);
			}
		}

		return result;
	}

	public getAllSorted(): AutoFix[] {
		const result = this.keys.map(key => this.edits[key]);

		return result.sort((a, b) => {
			const d = a.edit.range[0] - b.edit.range[0];
			if (d !== 0) {
				return d;
			}

			if (a.edit.range[1] === 0) {
				return -1;
			}

			if (b.edit.range[1] === 0) {
				return 1;
			}

			return a.edit.range[1] - b.edit.range[1];
		});
	}

	public getOverlapFree(): AutoFix[] {
		const sorted = this.getAllSorted();
		if (sorted.length <= 1) {
			return sorted;
		}

		const result: AutoFix[] = [];
		let last = sorted[0];
		result.push(last);
		for (let i = 1; i < sorted.length; i++) {
			const current = sorted[i];
			if (!Fixes.overlaps(last, current)) {
				result.push(current);
				last = current;
			}
		}

		return result;
	}
}
