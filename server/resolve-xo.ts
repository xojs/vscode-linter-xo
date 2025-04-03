import path from 'node:path';
import {Files} from 'vscode-languageserver/node';
import {URI} from 'vscode-uri';
import endent from 'endent';
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

	const folderPath = uriToPath(folderUri);

	let xoUri;
	let xoFilePath;
	const useCustomPath = typeof customPath === 'string';

	if (!useCustomPath) {
		xoFilePath = await Files.resolve('xo', undefined, folderPath, this.connection.tracer.log);
		xoUri = URI.file(xoFilePath).toString();
	} else if (useCustomPath && customPath.startsWith('file://')) {
		xoUri = customPath;
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
			? loadJsonFile<{version: string}>(
					path.join(
						xoFilePath.includes('dist')
							? path.dirname(path.resolve(xoFilePath, '..'))
							: path.dirname(xoFilePath),
						'package.json'
					)
				)
			: {version: 'custom'}
	]);

	if (typeof xo?.lintText !== 'function')
		throw new Error("The XO library doesn't export a lintText method.");

	this.log(
		endent`
			XO Library ${version} Loaded
			Resolved in Workspace ${folderPath}
			Cached for Folder ${uriToPath(xoCacheKey)}
			`
	);
	this.xoCache.set(xoCacheKey, xo);

	return xo;
}

export default resolveXo;
