/* eslint-disable import/no-unassigned-import */
// since globs are not fully supported in node v18 and v20 we import the files manually here

// TODO: remove this file once node v21 is LTS
import './server.test.js';
import './lsp/document-sync.test.js';
import './lsp/initialization.test.js';
import './lsp/code-actions.test.js';
import './code-actions-builder.test.js';
