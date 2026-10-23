import {XoLanguageServer} from 'xo-language-server';

// Keep the packaged extension self-contained by bundling the dependency behind
// this launcher; the external package owns all protocol and linting behavior.
new XoLanguageServer().listen();
