/* eslint-disable import-x/no-unassigned-import, node-test/no-import-test-files -- This entrypoint imports the test suite explicitly. */
// since globs are not fully supported in node v18 and v20 we import the files manually here
import process from 'node:process';
// TODO: remove this file once node v21 is LTS
import './server.test.ts';
import './lsp/document-sync.test.ts';
import './lsp/initialization.test.ts';
import './lsp/code-actions.test.ts';
import './code-actions-builder.test.ts';

process.on('unhandledRejection', error => {
	console.error(error);
	process.exit(1);
});
