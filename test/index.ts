/* eslint-disable import-x/no-unassigned-import */
// since globs are not fully supported in node v18 and v20 we import the files manually here
import process from 'node:process';
// TODO: remove this file once node v21 is LTS
import './server.test.js';
import './lsp/document-sync.test.js';
import './lsp/initialization.test.js';
import './lsp/code-actions.test.js';
import './code-actions-builder.test.js';

process.on('unhandledRejection', (error) => {
	console.error(error);
	process.exit(1);
});
