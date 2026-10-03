import {test, describe, type TestContext} from 'node:test';
import {TextDocument} from 'vscode-languageserver-textdocument';
import {
	CodeAction,
	Diagnostic,
	Range,
	Position,
	DiagnosticSeverity,
	CodeActionKind,
} from 'vscode-languageserver';
import {QuickFixCodeActionsBuilder} from '../server/code-actions-builder.ts';

const testTextDocument: TextDocument = TextDocument.create(
	'file:///test.ts',
	'javascript',
	1,
	'const foo = 1;\nconst bar = 2;\n',
);

describe('QuickFixCodeActionsBuilder:', () => {
	test('Server is a function', (t: TestContext) => {
		t.assert.strictEqual(typeof QuickFixCodeActionsBuilder, 'function');
	});

	test('ignores non xo code actions', (t: TestContext) => {
		const diagnostic = Diagnostic.create(
			Range.create(Position.create(0, 0), Position.create(0, 0)),
			'test message',
			DiagnosticSeverity.Error,
			'test',
			'non-xo',
		);

		const builder = new QuickFixCodeActionsBuilder(
			testTextDocument,
			[diagnostic],
			undefined,
			undefined,
		);

		const codeAction = builder.build();

		t.assert.deepStrictEqual(codeAction, []);
	});

	describe('Disable rule actions:', () => {
		const diagnostic = Diagnostic.create(
			Range.create(Position.create(0, 0), Position.create(0, 0)),
			'test message',
			DiagnosticSeverity.Error,
			'test-rule',
			'XO',
		);

		const builder = new QuickFixCodeActionsBuilder(
			testTextDocument,
			[diagnostic],
			undefined,
			undefined,
		);
		test('Creates ignore same line code action', (t: TestContext) => {
			const codeActions = builder.build();
			t.assert.strictEqual(Array.isArray(codeActions) && codeActions.length === 3, true);
			const codeAction = codeActions.find(
				action => action.title === `Ignore Rule ${diagnostic.code}: Same Line`,
			);
			t.assert.strictEqual(codeAction?.kind, CodeActionKind.QuickFix);
			t.assert.strictEqual(
				codeAction?.edit?.changes?.[testTextDocument.uri]?.[0].newText,
				` // eslint-disable-line ${diagnostic.code}`,
			);
		});

		test('Creates ignore line above code action', (t: TestContext) => {
			const codeActions = builder.build();
			const codeAction = codeActions.find(
				action => action.title === `Ignore Rule ${diagnostic.code}: Line Above`,
			);
			t.assert.strictEqual(codeAction?.kind, CodeActionKind.QuickFix);
			t.assert.strictEqual(
				codeAction?.edit?.changes?.[testTextDocument.uri]?.[0].newText,
				`// eslint-disable-next-line ${diagnostic.code}\n`,
			);
		});

		test('Creates ignore entire file code action', (t: TestContext) => {
			const codeActions = builder.build();
			const codeAction = codeActions.find(
				action => action.title === `Ignore Rule ${diagnostic.code}: Entire File`,
			);
			t.assert.strictEqual(codeAction?.kind, CodeActionKind.QuickFix);
			t.assert.strictEqual(
				codeAction?.edit?.changes?.[testTextDocument.uri]?.[0].newText,
				`/* eslint-disable ${diagnostic.code} */\n`,
			);
		});
	});
});
