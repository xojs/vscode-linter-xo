import path from 'node:path';
import {Files} from 'vscode-languageserver/node';
import {URI} from 'vscode-uri';
import endent from 'endent';
import isSANB from 'is-string-and-not-blank';
import loadJsonFile from 'load-json-file';
import {type TextDocument} from 'vscode-languageserver-textdocument';
import {type Xo} from './types';
import {uriToPath, pathToUri} from './utils';
import type LintServer from './server';

/**
 * Get xo from cache if it is there.
 * Attempt to resolve from node_modules relative
 * to the current working directory if it is not
 */
async function resolveXo(this: LintServer, document: TextDocument): Promise<Xo> {
	const [{uri: folderUri = ''} = {}, {path: customPath = ''}] = await Promise.all([
		this.getDocumentFolder(document),
		this.getDocumentConfig(document)
	]);

	const xoCacheKey = path.dirname(document.uri);

	let xo = this.xoCache.get(xoCacheKey);

	if (typeof xo?.lintText === 'function') return xo;

	// determine whether we should show resolution errors first
	const folderPath = uriToPath(folderUri);

	let xoUri;
	let xoFilePath;
	const useCustomPath = isSANB(customPath);
	if (!useCustomPath) {
		xoFilePath = await Files.resolve('xo', undefined, folderPath, this.connection.tracer.log);
		xoUri = URI.file(xoFilePath).toString();
	} else if (useCustomPath && customPath.startsWith('file://')) {
		xoUri = customPath;
		this.connection.console.warn(
			'Using a file uri for "xo.path" setting is deprecated and will be removed in the future, please provide an absolute or relative path to the file.'
		);
	} else if (useCustomPath && path.isAbsolute(customPath)) {
		xoUri = pathToUri(customPath);
	} else if (useCustomPath && !path.isAbsolute(customPath)) {
		xoUri = pathToUri(path.join(folderPath, customPath));
	} else {
		throw new Error(`Unknown path format “${customPath}”: Needs to start with “/”, “./”, or "../"`);
	}

	let version: string;

	[{default: xo}, {version = ''} = {}] = await Promise.all([
		import(xoUri) as Promise<{default: Xo}>,
		xoFilePath
			? loadJsonFile<{version: string}>(path.join(path.dirname(xoFilePath), 'package.json'))
			: Promise.resolve({version: 'custom'})
	]);

	if (!xo?.lintText) throw new Error("The XO library doesn't export a lintText method.");

	this.log(
		endent`
			XO Library ${version}
				Resolved in Workspace ${folderPath}
				Cached for Folder ${uriToPath(xoCacheKey)}
		`
	);

	this.xoCache.set(xoCacheKey, xo);

	return xo;
}

export default resolveXo;
