# vscode-linter-xo

![Travis (.com)](https://img.shields.io/travis/com/xojs/vscode-linter-xo)

> Linter for [XO](https://github.com/sindresorhus/xo)

## Usage

Just set up [XO](https://github.com/sindresorhus/xo) like you normally would in your project. This extensions requires that [XO](https://github.com/sindresorhus/xo) is installed locally in your workspace folder. It will not load a globally installed XO version. The extension will pickup the configuration in your workspace just like running [XO](https://github.com/sindresorhus/xo) in your terminal would. You will be able to see your linter work as you type and easily format your code if you want it to!

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

If you want to resolve xo from a custom path - such as a global node_modules folder, supply an absolute file uri. Must start with file:// and end with .js and should have all of its dependencies available to work properly. Could use with Deno or to have the xo library lint itself.

```json
{
	"xo.path": "file:///path/to/node_modules/xo/index.js"
}
```

## Recent Updates

- v3.5.0

  - Adds a configuration for a custom xo path for xo to resolve from.

- v3.4.0

  - Added initial support for code action quick fixes so you can fix errors one at a time.
  - Checks for xo updates in the background to ensure version is always current.
  - Added a debounce configuration to improve performance on large files (defaults to off).
  - Added a status bar item and command to show extension output channel

- v3.3.0

  - Introduced full support for workspace folders and multi-root projects.
  - Debounces lint requests

- v3.0.0
  - Supports resolving newer xo versions (40+) as well as prior versions

## Known Issues

- Turning on the setting "files.trimTrailingWhitespace" to true can cause a race condition with xo that causes code to get erroneously trimmed when formatting on save. This typically only occurs when debounce is turned (above 0 ms). Avoid using both "files.trimTrailingWhitespace" and "xo.debounce" options at the same time.

## License

MIT © [Sam Verschueren](http://github.com/SamVerschueren)
