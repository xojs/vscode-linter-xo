import {test, describe} from 'node:test';
import assert from 'node:assert';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {
	CodeAction,
	Diagnostic,
	Range,
	Position,
	DiagnosticSeverity,
	CodeActionKind
} from 'vscode-languageserver';
import {QuickFixCodeActionsBuilder} from '../server/code-actions-builder';

const testTextDocument: TextDocument = TextDocument.create(
	'file:///test.js',
	'javascript',
	1,
	'const foo = 1;\nconst bar = 2;\n'
);

describe('QuickFixCodeActionsBuilder:', () => {
	test('Server is a function', (t) => {
		assert.strictEqual(typeof QuickFixCodeActionsBuilder, 'function');
	});

	test('ignores non xo code actions', (t) => {
		const diagnostic = Diagnostic.create(
			Range.create(Position.create(0, 0), Position.create(0, 0)),
			'test message',
			DiagnosticSeverity.Error,
			'test',
			'non-xo'
		);

		const builder = new QuickFixCodeActionsBuilder(
			testTextDocument,
			[diagnostic],
			undefined,
			undefined
		);

		const codeAction = builder.build();

		assert.deepStrictEqual(codeAction, []);
	});

	describe('Disable rule actions:', () => {
		const diagnostic = Diagnostic.create(
			Range.create(Position.create(0, 0), Position.create(0, 0)),
			'test message',
			DiagnosticSeverity.Error,
			'test-rule',
			'XO'
		);

		const builder = new QuickFixCodeActionsBuilder(
			testTextDocument,
			[diagnostic],
			undefined,
			undefined
		);
		test('Creates ignore same line code action', (t) => {
			const codeActions = builder.build();
			assert.equal(Array.isArray(codeActions) && codeActions.length === 3, true);
			const codeAction = codeActions.find(
				(action) => action.title === `Ignore Rule ${diagnostic.code}: Same Line`
			);
			assert.strictEqual(codeAction?.kind, CodeActionKind.QuickFix);
			assert.strictEqual(
				codeAction?.edit?.changes?.[testTextDocument.uri]?.[0].newText,
				` // eslint-disable-line ${diagnostic.code}`
			);
		});

		test('Creates ignore line above code action', (t) => {
			const codeActions = builder.build();
			const codeAction = codeActions.find(
				(action) => action.title === `Ignore Rule ${diagnostic.code}: Line Above`
			);
			assert.strictEqual(codeAction?.kind, CodeActionKind.QuickFix);
			assert.strictEqual(
				codeAction?.edit?.changes?.[testTextDocument.uri]?.[0].newText,
				`// eslint-disable-next-line ${diagnostic.code}\n`
			);
		});

		test('Creates ignore entire file code action', (t) => {
			const codeActions = builder.build();
			const codeAction = codeActions.find(
				(action) => action.title === `Ignore Rule ${diagnostic.code}: Entire File`
			);
			assert.strictEqual(codeAction?.kind, CodeActionKind.QuickFix);
			assert.strictEqual(
				codeAction?.edit?.changes?.[testTextDocument.uri]?.[0].newText,
				`/* eslint-disable ${diagnostic.code} */\n`
			);
		});
	});
});
