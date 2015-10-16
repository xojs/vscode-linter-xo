# vscode-linter-xo

> Linter for [XO](https://github.com/sindresorhus/xo)


## Install

Press <kbd>F1</kbd> and narrow down the list commands by typing `extension`. Pick `Extensions: Install Extension`.

![](https://github.com/SamVerschueren/vscode-linter-xo/raw/master/screenshot.png)

Simply pick the `linter-xo` extension from the list

## Usage

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

Settings can also be set in the `package.json` file.

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
