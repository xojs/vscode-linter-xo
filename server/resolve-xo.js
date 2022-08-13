const path = require('path');
const {Files} = require('vscode-languageserver/node');
const {URI} = require('vscode-uri');
const loadJsonFile = require('load-json-file');
const isSANB = require('is-string-and-not-blank');

/**
 * Get xo from cache if it is there.
 * Attempt to resolve from node_modules relative
 * to the current working directory if it is not
 * @param {TextDocument} document
 */
async function resolveXO(document) {
	const {folder: {uri: folderUri} = {}, config: {path: customPath} = {}} =
		await this.getDocumentConfig(document);

	const xoFolder = path.dirname(document.uri);

	let xo = this.xoCache.get(xoFolder);

	if (typeof xo?.lintText === 'function') return xo;

	// determine whether we should show resolution errors first
	await this.getDocumentErrorOptions(document);
	const folderPath = URI.parse(folderUri).fsPath;

	let xoUri;
	let xoFilePath;
	const useCustomPath = isSANB(customPath);
	if (!useCustomPath) {
		xoFilePath = await Files.resolve('xo', undefined, folderPath);
		this.log('xoFilePath', xoFilePath);
		xoUri = URI.file(xoFilePath).toString();
	} else if (useCustomPath && customPath.startsWith('file://')) {
		xoUri = customPath;
		this.connection.console.warn(
			'Using a file uri for "xo.path" setting is deprecated and will be removed in the future, please provide an absolute or relative path to the file.'
		);
	} else if (useCustomPath && path.isAbsolute(customPath)) {
		xoUri = URI.file(customPath).toString();
	} else if (useCustomPath && !path.isAbsolute(customPath)) {
		xoUri = URI.file(path.join(folderPath, customPath)).toString();
	} else {
		throw new Error(`Unknown path format “${customPath}”: Needs to start with “/”, “./”, or "../"`);
	}

	let version;

	[xo, {version}] = await Promise.all([
		import(xoUri),
		xoFilePath
			? loadJsonFile(path.join(path.dirname(xoFilePath), 'package.json'))
			: Promise.resolve({version: 'custom'})
	]);

	if (!xo?.default?.lintText) throw new Error("The XO library doesn't export a lintText method.");

	xo.default.version = version;

	await this.connection.console.info(
		`XO Library ${xo.default.version} was successfully resolved and cached for ${xoFolder}.`
	);

	this.xoCache.set(xoFolder, xo.default);

	return xo.default;
}

module.exports = resolveXO;
