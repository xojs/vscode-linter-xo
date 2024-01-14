/* eslint-disable import/no-unassigned-import */
// since globs are not fully supported in node v18 and v20 we import the files manually here

// TODO: remove this file once node v21 is LTS
import './server.js';
import './lsp/document-sync.js';
import './lsp/initialization.js';
