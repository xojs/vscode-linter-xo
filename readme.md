# vscode-linter-xo

[![Build Status](https://travis-ci.org/SamVerschueren/vscode-linter-xo.svg?branch=master)](https://travis-ci.org/SamVerschueren/vscode-linter-xo)

> Linter for [XO](https://github.com/sindresorhus/xo)


## Usage

Install [XO](https://github.com/sindresorhus/xo) in your workspace folder.

```
$ npm install --save-dev xo
```

In Visual Studio Code, press <kbd>F1</kbd> and narrow down the list of commands by typing `extension`. Pick `Extensions: Install Extension`.

![](https://github.com/SamVerschueren/vscode-linter-xo/raw/master/screenshot.png)

Simply search for the `linter-xo` extension from the list and install it.


## Fix issues

Press `F1` and choose `XO: Fix all auto-fixable problems`

![](https://github.com/SamVerschueren/vscode-linter-xo/raw/master/xo/media/fix.gif)

> Tip: Bind a keyboard shortcut to `xo.fix`


## Settings

Enable the linter in the VS Code Settings.

```json
{
  "xo.enable": true
}
```

You can also pass in extra options via the settings file.

```json
{
  "xo.enable": true,
  "xo.options": {
    "semicolon": false
  }
}
```

Or via the `package.json` file.

```json
{
  "name": "my-pkg",
  "xo": {
    "semicolon": false
  }
}
```

You can enable the formatter integration to use `xo --fix` as formatter. Requires `xo.enable` to be true. It is disabled by default.

```json
{
  "xo.enable": true,
  "xo.format.enable": true
}
```

## License

MIT © [Sam Verschueren](http://github.com/SamVerschueren)
