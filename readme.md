# vscode-linter-xo

> Linter for [XO](https://github.com/sindresorhus/xo)


## Usage

Install [XO](https://github.com/sindresorhus/xo) in your workspace folder.

```
$ npm install --save-dev xo
```


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

## License

MIT © [Sam Verschueren](http://github.com/SamVerschueren)
