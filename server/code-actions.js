const {
	TextEdit,
	Range,
	Position,
	CodeActionKind
} = require('vscode-languageserver/node');

class CodeActionsBuilder {
	constructor({diagnostic, textDocument, edit}) {
		const {code} = diagnostic || {};
		this.code = code;
		this.edit = edit;
		this.diagnostic = diagnostic;
		this.textDocument = textDocument;
		this.lineText = textDocument.getText({
			start: {
				line: diagnostic.range.start.line,
				character: 0
			},
			end: {
				line: diagnostic.range.start.line,
				character: Number.MAX_SAFE_INTEGER
			}
		});
		this.lineAboveText = textDocument.getText({
			start: {
				line: diagnostic.range.start.line - 1,
				character: 0
			},
			end: {
				line: diagnostic.range.start.line - 1,
				character: Number.MAX_SAFE_INTEGER
			}
		});
		this.codeActions = [];
	}

	build() {
		this.getFix();
		this.getDisableNextLine();
		this.getDisableEntireFile();

		return this.codeActions;
	}

	getDisableNextLine() {
		let changes = [];
		const ignoreRange = {
			line: this.diagnostic.range.start.line,
			character: 0
		};

		const matchedForIgnoreComment =
			this.lineAboveText &&
			this.lineAboveText.match(
				// eslint-disable-next-line prefer-regex-literals
				new RegExp(`// eslint-disable-next-line`)
			);

		if (matchedForIgnoreComment && matchedForIgnoreComment.length > 0) {
			const textEdit = TextEdit.insert(
				Position.create(
					this.diagnostic.range.start.line - 1,
					Number.MAX_SAFE_INTEGER
				),
				`, ${this.code}`
			);

			changes.push(textEdit);
		}

		if (changes.length === 0) {
			const matches = /^([ |\t]*)/.exec(this.lineText);

			const indentation =
				Array.isArray(matches) && matches.length > 0 ? matches[0] : '';

			const newedit = {
				range: {
					start: ignoreRange,
					end: ignoreRange
				},
				newText: `${indentation}// eslint-disable-next-line ${this.code}\n`
			};

			changes = [newedit];
		}

		const ignoreAction = {
			title: `Ignore Rule ${this.code}`,
			kind: CodeActionKind.QuickFix,
			diagnostic: this.diagnostic,
			edit: {
				changes: {
					[this.textDocument.uri]: changes
				}
			}
		};

		this.codeActions.push(ignoreAction);
	}

	getDisableEntireFile() {
		const shebang = this.textDocument.getText(
			Range.create(Position.create(0, 0), Position.create(0, 2))
		);

		const line = shebang === '#!' ? 1 : 0;

		const ignoreFileAction = {
			title: `Ignore Rule ${this.code} for entire file`,
			kind: CodeActionKind.QuickFix,
			diagnostic: this.diagnostic,
			edit: {
				changes: {
					[this.textDocument.uri]: [
						TextEdit.insert(
							Position.create(line, 0),
							`/* eslint-disable ${this.code} */\n`
						)
					]
				}
			}
		};

		this.codeActions.push(ignoreFileAction);
	}

	getFix() {
		if (!this.edit) return;

		this.codeActions.push({
			title: 'Fix with XO',
			kind: CodeActionKind.Refactor,
			diagnostic: this.diagnostic,
			edit: {
				changes: {
					[this.textDocument.uri]: [
						TextEdit.replace(
							Range.create(
								this.textDocument.positionAt(this.edit?.edit?.range?.[0]),
								this.textDocument.positionAt(this.edit?.edit?.range?.[1])
							),
							this.edit.edit.text || ''
						)
					]
				}
			}
		});
	}
}

module.exports = CodeActionsBuilder;
