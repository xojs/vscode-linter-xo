# vscode-linter-xo

[![Build Status](https://travis-ci.org/SamVerschueren/vscode-linter-xo.svg?branch=master)](https://travis-ci.org/SamVerschueren/vscode-linter-xo)

> Linter for [XO](https://github.com/sindresorhus/xo)

## Usage

Just set up [XO](https://github.com/sindresorhus/xo) like you normally would in your project. This extensions requires that [XO](https://github.com/sindresorhus/xo) is installed locally in your workspace folder and listed in your `package.json`. It will not load a globally installed XO version. The extension will pickup the configuration in your workspace just like running [XO](https://github.com/sindresorhus/xo) in your terminal would. You will be able to see your linter work as you type and easily format your code if you want it to!

```shell
$ npm install --save-dev xo
```

or

```shell
$ yarn add -D xo
```

## Usage Notes + Future Improvements

- If you upgrade XO while using the extension, you will need to reload vscode for extension to get the upgraded package from your node_modules. The fastest way is to use the command pallete and select `Developer: reload window`.

- The linter XO extension will not currently load xo if it is not listed in your package.json and found in your local node_modules. However, we are planning on adding a global option in the near future, check back soon if this is a requirement.

- The linter XO extension currently does not support multi-root workspaces (although we plan to soon). It will lint all TS and JS files in a single workspace with the instance of XO in the top folder, due to the way vscode works. Don't worry, we plan to support multiroot/multifolder workspaces fully soon. As a workaround - configure xo the way you want it for every folder in your workspace and put that folder at the top of the workspace.

- XO v0.40.0 and above were released as [pure ESM](https://gist.github.com/sindresorhus/a39789f98801d908bbc7ff3ecc99d99c). Therefore, it is required that Node.js versions 12+ be used to use this extension. If you are using an older version of Node.js please install an earlier version of XO.

## Auto Fix Issues With XO

The XO extension ships with a fix command that accessible from the command pallete.

Pull up the command pallete (usually `F1` or `Ctrl + Shift + P`) and choose `XO: Fix all auto-fixable problems`.

You can also use enable XO as your default formatter for TypeScript and JavaScript and have vscode run `xo --fix` on save or on type. We reccomend setting it up as follows:

In either your workspace or user settings add the following. It's generally best to make xo the default formatter for JavaScript and TypeScript files specifically as it will not be able to format any other document types, even if prettier is enabled.

```json
{
	"xo.format.enable": true,
	"[javascript]": {
		"editor.defaultFormatter": "spence-s.linter-xo"
	},
	"[typescript]": {
		"editor.defaultFormatter": "spence-s.linter-xo"
	}
}
```

![](media/fix.gif)

## Settings

Enable the linter in the VS Code Settings.

```json
{
	"xo.enable": true
}
```

You can also pass in extra options via vscode's settings. Note that these settings will override any configurations that xo finds in your local workspace.

```json
{
	"xo.enable": true,
	"xo.options": {
		"semicolon": false
	}
}
```

You can enable the formatter integration to use `xo --fix` as formatter. Requires `xo.enable` to be true.

```json
{
	"xo.format.enable": true
}
```

## License

MIT © [Sam Verschueren](http://github.com/SamVerschueren)
