import {TextDocument} from 'vscode-languageserver-textdocument';
import anyTest, {type TestFn} from 'ava';
import {replace, fake, restore} from 'sinon';
import Server from '../../../server/server.js';

const test = anyTest as TestFn<{
	lintDocumentTimesCalled: number;
	logTimesCalled: number;
	server: Server;
}>;

test.beforeEach((t) => {
	const server = new Server({isTest: true});
	// @ts-expect-error A Map estimates text document usage for use in tests
	server.documents = new Map([
		['uri', TextDocument.create('uri', 'javascript', 1, 'content')],
		['uri/node_modules', TextDocument.create('uri/node_modules', 'javascript', 1, 'content')]
	]);

	// @ts-expect-error Map estimates text document usage
	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	server.documents.all = server.documents.values;

	// @ts-expect-error sinon fake
	replace(server, 'lintDocumentDebounced', fake());
	replace(server, 'log', fake());

	t.context.server = server;
});

test.afterEach((t) => {
	restore();
});

test('Server.handleDocumentsOnDidChangeContent is a function', (t) => {
	t.is(typeof t.context.server.handleDocumentsOnDidChangeContent, 'function');
});

test('Server.handleDocumentsOnDidChangeContent calls lintDocument', async (t) => {
	t.context.server.handleDocumentsOnDidChangeContent({
		document: TextDocument.create('uri', 'javascript', 1, 'content')
	});
	await new Promise((resolve) => {
		t.context.server.queue.once('end', () => {
			resolve(undefined);
		});
	});
	// @ts-expect-error sinon fake
	t.is(t.context.server.lintDocumentDebounced.callCount, 1);
});

test('Server.handleDocumentsOnDidChangeContent does not lint document if version is mismatched', async (t) => {
	t.context.server.handleDocumentsOnDidChangeContent({
		document: TextDocument.create('uri', 'javascript', 2, 'content')
	});
	await new Promise((resolve) => {
		t.context.server.queue.once('end', () => {
			resolve(undefined);
		});
	});
	// @ts-expect-error sinon fake
	t.is(t.context.server.lintDocumentDebounced.callCount, 0);
});

test('Server.handleDocumentsOnDidChangeContent does not lint document if document is in node_modules and logs message', async (t) => {
	t.context.server.handleDocumentsOnDidChangeContent({
		document: TextDocument.create('uri/node_modules', 'javascript', 1, 'content')
	});
	await new Promise((resolve) => {
		t.context.server.queue.once('end', () => {
			resolve(undefined);
		});
	});
	// @ts-expect-error sinon fake
	t.is(t.context.server.log.callCount, 1);
	// @ts-expect-error sinon fake
	// eslint-disable-next-line @typescript-eslint/no-unsafe-call
	t.is(t.context.server.log.getCall(0).args[0], 'skipping node_modules file');
	// @ts-expect-error sinon fake
	t.is(t.context.server.lintDocumentDebounced.callCount, 0);
});

test('Server.handleDocumentsOnDidClose sends empty diagnostics for closed file', async (t) => {
	replace(t.context.server.connection, 'sendDiagnostics', fake());
	await t.context.server.handleDocumentsOnDidClose({
		document: TextDocument.create('uri', 'javascript', 1, 'content')
	});
	// @ts-expect-error sinon fake
	t.is(t.context.server.connection.sendDiagnostics.callCount, 1);
	// @ts-expect-error sinon fake
	// eslint-disable-next-line @typescript-eslint/no-unsafe-call
	t.deepEqual(t.context.server.connection.sendDiagnostics.getCall(0).args[0], {
		uri: 'uri',
		diagnostics: []
	});
});
