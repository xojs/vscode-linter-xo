### v3.17.0

- Client refactor and status bar icon only shows on relevant xo files. Server will not start until a relevant xo file is open, which helps reduce the extension overhead when a non xo repo is open.
- handles validate option change without refresh window hack.

### v3.16.0

- No longer lint node_modules. Resolves [#131](https://github.com/xojs/vscode-linter-xo/issues/131)

### v3.15.1

- fix a bug where an extra line was added when a an ignore-same-line code action was requested

### v3.15.0

- Instead of alerting user for document version mismatch, we send the correct LSP error code to the client for this information, where the language client can decide what to do with the error. Resolves [#128](https://github.com/xojs/vscode-linter-xo/issues/128).

### v3.14.0

- Internally refactored back to typescript since the compilation has been fully supported since 4.7 release.
- Now supports range formatting and `editor.formatOnSaveMode` set to `"modifications"`.

### v3.13.0

- support full formatting to match xo cli output

### v3.12.0

- Refactor and architectural changes to support better logic around xo resolution
  - Previously required xo to be in the root folder of the vscode workspace
  - Now only requires that xo is a dependency in any parent directory. The extension now looks up from the file it is linting for a package.json with xo as a dependency.
  - Caching now happens on a per folder basis and is cleaned up as files are closed and recached when they open. This helps simplify logic and able to remove a lot of supporting code and alleviates problems from stale cache.
- fixes a bug where eslint-plugins/configs without docs would throw an error

### v3.11.0

- Adds validate option to allow formatting more file types

### v3.10.0

- Adds ignore rule Code Actions for both single line or file.
- Adds logic to use metaResults from xo .51+ and fallback to eslint-rule-docs for older versions
- Internal improves fixing logic for overlapping rules
- Move from objects to Maps for rule caching

### v3.9.0

- Adds links to rule documents

### v3.8.1

- Diagnostics now underline the entire diagnostic, rather than only the first character (closes #87)

### 3.8

- If a file is opened without a workspace folder, linter-xo will attempt to resolve the project root and lint appropriately.

### 3.7

- Changes "xo.path" setting from a file uri to a path or relative path.

### 3.6

- Adds a configuration for node runtime (closes #103)

### 3.5

- Adds a configuration for a custom xo path for xo to resolve from.

### 3.4

- Make debounce configurable and default to 0
- Replace internal Queue
- Handle resolution error with more sophistication
- Initial support for quick fix code actions
- Added a status bar item and command to show the extension output
- Handle options better for per folder configurations in multi-root workspaces

### 3.3.2

- patch error message to only show once per session

### 3.3.1

- fix bug with windows path

### 3.3.0

- Support multi-root workspaces completely
- Internal refactoring for a much cleaner and clearer linter class.
- Removes the need for xo to be in package.json and will attempt to resolve xo regardless.
- Handle errors more gracefully
- Adds some debouncing to lint requests which significantly improves large file performance

### 3.2.0

- Add overrideSeverity option

### 3.1.2

- Update docs
- Remove internal options from being printed

### 3.0.0

- massive refactor
- drop TS
- fix XO compatibility issues
