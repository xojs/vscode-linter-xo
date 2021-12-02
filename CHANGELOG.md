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
