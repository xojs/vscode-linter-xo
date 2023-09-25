# vscode-linter-xo

![Travis (.com)](https://img.shields.io/travis/com/xojs/vscode-linter-xo)

> Linter for [XO](https://github.com/sindresorhus/xo)

## Usage

Install [XO](https://github.com/sindresorhus/xo) like you normally would in your project. The extension will pickup the configuration in your workspace just like running [XO](https://github.com/sindresorhus/xo) in your terminal would. You will be able to see your linter work as you type and easily format your code.

```shell
$ npm install --save-dev xo
```

or

```shell
$ yarn add -D xo
```

## How it works

The xo extension searches up when you open a file for a package.json with `xo` listed as a dependency.

## Auto Format JS/TS Files XO

You can enable XO as a formatter for TypeScript and JavaScript.

In either your workspace or user settings add the following settings. Linter xo now supports `editor.formatOnSaveMode` set to `"modifications"` :tada:.

> optionally turn on "editor.formatOnSave"

```json
{
	"editor.formatOnSave": true,
	"xo.enable": true,
	"xo.format.enable": true,
	"[javascript]": {
		"editor.defaultFormatter": "samverschueren.linter-xo"
	},
	"[javascriptreact]": {
		"editor.defaultFormatter": "samverschueren.linter-xo"
	},
	"[typescript]": {
		"editor.defaultFormatter": "samverschueren.linter-xo"
	},
	"[typescriptreact]": {
		"editor.defaultFormatter": "samverschueren.linter-xo"
	}
}
```

## Commands

To use: pull up the command pallete (usually `F1` or `Ctrl + Shift + P`) and start typing `xo`.

![](media/fix.gif)

#### Fix all fixable problems

Fixes all fixable problems in the open document, regardless of configuration.

#### Restart Server

Reloads XO server.

## Settings

| Setting               | Type                      | Default                                                                                         | Description                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `xo.enable`           | `boolean`                 | `true`                                                                                          | Turn the `xo` extension on and off in your workspace                                                                                                                                                                                                                                                                                                                                                                                                   |
| `xo.format.enable`    | `boolean`                 | `false`                                                                                         | Enable the `xo` extension to format documents. Requires `xo.enable` to be turned on.                                                                                                                                                                                                                                                                                                                                                                   |
| `xo.validate`         | `string[]`                | "javascript", <br/> "javascriptreact", <br/> "typescript", <br/> "typescriptreact", <br/> "vue" | By default, the XO extension is configured to activate for Javascript, Javascript + React, Typescript, and Typescript + React. You may add more languages in the VS Code Settings.                                                                                                                                                                                                                                                                     |
| `xo.options`          | `object`                  | `null`                                                                                          | Supply any [xo option](https://github.com/xojs/xo#config). The options set here will override any configurations found by `xo` in your local workspace                                                                                                                                                                                                                                                                                                 |
| `xo.overrideSeverity` | `info\|warning\|error`    | `null`                                                                                          | XO extension will report all diagnostics in VSCode as the desired severity type. By default `xo` reports the severity type based on the linting rules set up in the local workspace                                                                                                                                                                                                                                                                    |
| `xo.debounce`         | `number`                  | 0                                                                                               | You can adjust a debounce (in milliseconds) that helps optimize performance for large files. If you notice that lint results are jumping all over the place, or a long delay in fixing files, turn this up. The max is 350ms.                                                                                                                                                                                                                          |
| `xo.path`             | `string`                  | `null`                                                                                          | If you want to resolve xo from a custom path - such as a global node_modules folder, supply an absolute or relative path (with respect to the workspace folder directory). Could use with Deno, yarn pnp, or to have the xo library lint itself. By default xo is resolved from the workspace folders node_modules directory. <br/><br/>examples:<br/>`"xo.path": "/path/to/node_modules/xo/index.js"` <br/> `"xo.path": "./node_modules/xo/index.js"` |
| `xo.runtime`          | `string`                  | `null`                                                                                          | By default, VSCode starts xo with its own bundled nodejs version. This may cause different results from the cli if you are using a different version of node. You can set a runtime path so that you are always using the same node version. <br/><br/>example:<br/>`"xo.runtime": "/usr/local/bin/node"`                                                                                                                                              |
| `xo.statusBar`        | `Relevant\|Always\|Never` | `"Relevant"`                                                                                    | When to show the status bar icon.                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Known Issues

- Turning on the setting "files.trimTrailingWhitespace" to true can cause a race condition with xo that causes code to get erroneously trimmed when formatting on save. This typically only occurs when debounce is turned (above 0 ms). Avoid using both "files.trimTrailingWhitespace" and "xo.debounce" options at the same time.

## License

MIT © [Sam Verschueren](http://github.com/SamVerschueren)
