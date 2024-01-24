import {
	TextEdit,
	uinteger,
	Range,
	Position,
	CodeActionKind,
	type Diagnostic,
	type CodeAction
} from 'vscode-languageserver/node';
import {type TextDocument} from 'vscode-languageserver-textdocument';
import {type XoFix} from './types';
import * as utils from './utils.js';

export class QuickFixCodeActionsBuilder {
	constructor(
		private readonly textDocument: TextDocument,
		private readonly diagnostics: Diagnostic[],
		private readonly fixCache: Map<string, XoFix> | undefined
	) {
		this.textDocument = textDocument;
		this.diagnostics = diagnostics;
		this.fixCache = fixCache;
	}

	build(): CodeAction[] {
		return this.diagnostics
			.filter((diagnostic) => diagnostic.source === 'XO')
			.flatMap<CodeAction>((diagnostic) => {
				const diagnosticCodeActions: CodeAction[] = [];

				const disableSameLineCodeAction = this.getDisableSameLine(diagnostic);
				if (disableSameLineCodeAction) diagnosticCodeActions.push(disableSameLineCodeAction);

				const disableNextLineCodeAction = this.getDisableNextLine(diagnostic);
				if (disableNextLineCodeAction) diagnosticCodeActions.push(disableNextLineCodeAction);

				const disableFileCodeAction = this.getDisableEntireFile(diagnostic);
				if (disableFileCodeAction) diagnosticCodeActions.push(disableFileCodeAction);

				const fix = this.getFix(diagnostic, CodeActionKind.QuickFix);
				if (fix) diagnosticCodeActions.push(fix);

				return diagnosticCodeActions;
			});
	}

	getDisableSameLine(diagnostic: Diagnostic) {
		let changes = [];

		const startPosition: Position = {
			line: diagnostic.range.start.line,
			character: uinteger.MAX_VALUE
		};

		const lineText = this.textDocument.getText({
			start: Position.create(diagnostic.range.start.line, 0),
			end: Position.create(diagnostic.range.start.line, uinteger.MAX_VALUE)
		});

		const matchedForIgnoreComment = lineText && /\/\/ eslint-disable-line/.exec(lineText);

		if (matchedForIgnoreComment && matchedForIgnoreComment.length > 0) {
			const textEdit = TextEdit.insert(startPosition, `, ${diagnostic.code}`);

			changes.push(textEdit);
		}

		if (changes.length === 0) {
			const newedit: TextEdit = {
				range: {
					start: startPosition,
					end: startPosition
				},
				newText: `  // eslint-disable-line ${diagnostic.code}`
			};

			changes = [newedit];
		}

		const ignoreAction: CodeAction = {
			title: `Add Ignore Rule ${diagnostic.code}: Same Line`,
			kind: CodeActionKind.QuickFix,
			diagnostics: [diagnostic],
			edit: {
				changes: {
					[this.textDocument.uri]: changes
				}
			}
		};

		return ignoreAction;
	}

	getDisableNextLine(diagnostic: Diagnostic) {
		let changes = [];

		const ignoreRange = {
			line: diagnostic.range.start.line,
			character: 0
		};

		const lineText = this.textDocument.getText({
			start: Position.create(diagnostic.range.start.line, 0),
			end: Position.create(diagnostic.range.start.line, uinteger.MAX_VALUE)
		});

		const lineAboveText = this.textDocument.getText({
			start: Position.create(diagnostic.range.start.line - 1, 0),
			end: Position.create(diagnostic.range.start.line - 1, uinteger.MAX_VALUE)
		});

		const matchedForIgnoreComment =
			lineAboveText && /\/\/ eslint-disable-next-line/.exec(lineAboveText);

		if (matchedForIgnoreComment && matchedForIgnoreComment.length > 0) {
			const textEdit = TextEdit.insert(
				Position.create(diagnostic.range.start.line - 1, uinteger.MAX_VALUE),
				`, ${diagnostic.code}`
			);

			changes.push(textEdit);
		}

		if (changes.length === 0) {
			const matches = /^([ |\t]*)/.exec(lineText);

			const indentation = Array.isArray(matches) && matches.length > 0 ? matches[0] : '';

			const newedit = {
				range: {
					start: ignoreRange,
					end: ignoreRange
				},
				newText: `${indentation}// eslint-disable-next-line ${diagnostic.code}\n`
			};

			changes = [newedit];
		}

		const ignoreAction: CodeAction = {
			title: `Add Ignore Rule ${diagnostic.code}: Next Line`,
			kind: CodeActionKind.QuickFix,
			diagnostics: [diagnostic],
			edit: {
				changes: {
					[this.textDocument.uri]: changes
				}
			}
		};

		return ignoreAction;
	}

	getDisableEntireFile(diagnostic: Diagnostic) {
		const shebang = this.textDocument.getText(
			Range.create(Position.create(0, 0), Position.create(0, 2))
		);

		const line = shebang === '#!' ? 1 : 0;

		const ignoreFileAction = {
			title: `Add Ignore Rule ${diagnostic.code}: Entire File`,
			kind: CodeActionKind.QuickFix,
			diagnostics: [diagnostic],
			edit: {
				changes: {
					[this.textDocument.uri]: [
						TextEdit.insert(Position.create(line, 0), `/* eslint-disable ${diagnostic.code} */\n`)
					]
				}
			}
		};

		return ignoreFileAction;
	}

	getFix(diagnostic: Diagnostic, codeActionKind: CodeActionKind) {
		const edit = this.fixCache?.get(utils.computeKey(diagnostic));

		if (!edit) return;

		return {
			title: `Fix ${diagnostic.code} with XO`,
			kind: codeActionKind,
			diagnostics: [diagnostic],
			edit: {
				changes: {
					[this.textDocument.uri]: [
						TextEdit.replace(
							Range.create(
								this.textDocument.positionAt(edit?.edit?.range?.[0]),
								this.textDocument.positionAt(edit?.edit?.range?.[1])
							),
							edit.edit.text || ''
						)
					]
				}
			}
		};
	}
}
