import {
	CodeAction,
	Diagnostic,
	Range,
	Position,
	DiagnosticSeverity,
	CodeActionKind,
	uinteger,
	type CodeActionParams
} from 'vscode-languageserver';

export const getTextDocument = () => ({uri: 'uri'});
export const getZeroPosition = () => Position.create(0, 0);
export const getZeroRange = () => Range.create(getZeroPosition(), getZeroPosition());
export const getXoDiagnostic = () =>
	Diagnostic.create(getZeroRange(), 'test message', DiagnosticSeverity.Error, 'test', 'XO');
export const getCodeActionParams = (): CodeActionParams => ({
	textDocument: getTextDocument(),
	range: getZeroRange(),
	context: {diagnostics: [getXoDiagnostic()]}
});

export const getIgnoreSameLineCodeAction = () => ({
	...CodeAction.create(
		'Ignore Rule test: Same Line',
		{
			changes: {
				uri: [
					{
						range: Range.create(
							Position.create(0, uinteger.MAX_VALUE),
							Position.create(0, uinteger.MAX_VALUE)
						),
						newText: ' // eslint-disable-line test'
					}
				]
			}
		},
		CodeActionKind.QuickFix
	),
	diagnostics: [getXoDiagnostic()]
});

export const getIgnoreNextLineCodeAction = () => ({
	...CodeAction.create(
		'Ignore Rule test: Line Above',
		{
			changes: {
				uri: [
					{
						range: getZeroRange(),
						newText: '// eslint-disable-next-line test\n'
					}
				]
			}
		},
		CodeActionKind.QuickFix
	),
	diagnostics: [getXoDiagnostic()]
});

export const getIgnoreFileCodeAction = () => ({
	...CodeAction.create(
		'Ignore Rule test: Entire File',
		{
			changes: {
				uri: [
					{
						range: getZeroRange(),
						newText: '/* eslint-disable test */\n'
					}
				]
			}
		},
		CodeActionKind.QuickFix
	),
	diagnostics: [getXoDiagnostic()]
});
