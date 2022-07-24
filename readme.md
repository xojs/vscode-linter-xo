# vscode-linter-xo

![Travis (.com)](https://img.shields.io/travis/com/xojs/vscode-linter-xo)

> Linter for [XO](https://github.com/sindresorhus/xo)

## Usage

Just set up [XO](https://github.com/sindresorhus/xo) like you normally would in your project. The extension will pickup the configuration in your workspace just like running [XO](https://github.com/sindresorhus/xo) in your terminal would. You will be able to see your linter work as you type and easily format your code if you want it to!

```shell
$ npm install --save-dev xo
```

or

```shell
$ yarn add -D xo
```

## Auto Format JS/TS Files XO

You can enable XO as a formatter for TypeScript and JavaScript. We recommend setting it up as follows:

In either your workspace or user settings add the following. It's generally best to make xo the default formatter for JavaScript and TypeScript files specifically as it will not be able to format other document types.

> optionally turn on "editor.formatOnSave"

```json
{
	"editor.formatOnSave": true,
	"xo.enable": true,
	"xo.format.enable": true,
	"[javascript]": {
		"editor.defaultFormatter": "samverschueren.linter-xo"
	},
	"[typescript]": {
		"editor.defaultFormatter": "samverschueren.linter-xo"
	}
}
```

The XO extension also ships with a fix command that is accessible from the command pallete. This command will apply xo fixes to your JS or TS file regardless of any configuration.

To use: pull up the command pallete (usually `F1` or `Ctrl + Shift + P`) and choose `XO: Fix all auto-fixable problems`.

![](media/fix.gif)

## Additional Languages

By default, the XO extension is configured to activate for Javascript, Javascript + React, Typescript, and Typescript + React. You may add more languages in the VS Code Settings. For example, to add Vue, you could do the following:

```json
{
	"xo.validate": [
		"javascript",
		"javascriptreact",
		"typescript",
		"typescriptreact",
		"vue"
	]
}
```

## Settings

Enable the linter in the VS Code Settings, this is on by default.

```json
{
	"xo.enable": true
}
```

You can also pass in extra options via vscode's settings. Note that these settings will override any configurations that xo finds in your local workspace.

```json
{
	"xo.options": {
		"rules": {
			"semicolon": false
		}
	}
}
```

You can enable the formatter integration to use `xo --fix` as formatter. Requires `xo.enable` to be true.

```json
{
	"xo.format.enable": true
}
```

You can override the severity of found issues, e.g. to make them stand out less than TypeScript errors.

```json
{
	"xo.overrideSeverity": "info"
}
```

Since linting occurs on any file change, large files with complex configurations can get laggy. You can adjust a debounce (in milliseconds) that helps optimize performance for large files. If you notice that lint results are jumping all over the place, or a long delay in fixing files, turn this up. The max is 350ms.

```json
{
	"xo.debounce": 0
}
```

If you want to resolve xo from a custom path - such as a global node_modules folder, supply an absolute or relative path (with respect to the workspace folder directory). Could use with Deno, yarn pnp, or to have the xo library lint itself. By default xo is resolved from the workspace folders node_modules directory.

```json
{
	"xo.path": "/path/to/node_modules/xo/index.js",
}
{
	"xo.path": "./node_modules/xo/index.js"
}
```

By default, VSCode starts xo with its own bundled nodejs version. This may cause different results from the cli if you are using a different version of node. You can set a runtime path so that you are always using the same node version.

```json
{
	"xo.runtime": "/usr/local/bin/node"
}
```

## Recent Updates

- v3.11.0

  - Adds validate option to allow formatting more file types

- v3.10.0

  - Adds ignore rule Code Actions for both single line or file.
  - Adds logic to use metaResults from xo .51+ and fallback to eslint-rule-docs for older versions
  - Internal improves fixing logic for overlapping rules
  - Move from objects to Maps for rule caching

- v3.9.0

  - Adds links to rule documents

- v3.8.1

  - Diagnostics now underline the entire diagnostic, rather than only the first character (closes #87)

- v3.8.0

  - If a file is opened without a workspace folder, linter-xo will attempt to resolve the project root and lint appropriately.

- v3.7.0

  - Configuration for a custom "xo.path" now accepts an absolute or relative path. File uris deprecated.

- v3.6.0

  - Adds a configuration for custom nodejs runtime for running the xo server.

- v3.5.0
  - Adds a configuration for a custom xo path for xo to resolve from.

## Known Issues

- Turning on the setting "files.trimTrailingWhitespace" to true can cause a race condition with xo that causes code to get erroneously trimmed when formatting on save. This typically only occurs when debounce is turned (above 0 ms). Avoid using both "files.trimTrailingWhitespace" and "xo.debounce" options at the same time.

## License

MIT © [Sam Verschueren](http://github.com/SamVerschueren)
