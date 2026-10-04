import path from 'node:path';
import {Files} from 'vscode-languageserver/node';
import {URI} from 'vscode-uri';
import endent from 'endent';
import loadJsonFile from 'load-json-file';
import type {TextDocument} from 'vscode-languageserver-textdocument';
import type {Xo} from './types.ts';
import {uriToPath, pathToUri} from './utils.ts';
import type LintServer from './server.ts';

/**
 * Get xo from cache if it is there.
 * Attempt to resolve from node_modules relative
 * to the current working directory if it is not
 */
async function resolveXo(this: LintServer, document: TextDocument): Promise<Xo> {
	const [{uri: folderUri = ''} = {}, config] = await Promise.all([
		this.getDocumentFolder(document),
		this.getDocumentConfig(document),
	]);
	const customPath = config.path ?? '';

	const xoCacheKey = path.dirname(document.uri);

	let xo = this.xoCache.get(xoCacheKey);

	if (typeof xo?.lintText === 'function') {
		return xo;
	}

	const folderPath = uriToPath(folderUri);

	let xoUri: string;
	let xoFilePath: string | undefined;

	if (customPath === '') {
		xoFilePath = await Files.resolve('xo', undefined, folderPath, this.connection.tracer.log);
		xoUri = URI.file(xoFilePath).toString();
	} else if (customPath.startsWith('file://')) {
		xoUri = customPath;
	} else if (path.isAbsolute(customPath)) {
		xoUri = pathToUri(customPath);
	} else {
		xoUri = pathToUri(path.join(folderPath, customPath));
	}

	let packageInfo: Promise<{version: string}> | {version: string} = {version: 'custom'};
	if (xoFilePath !== undefined && xoFilePath !== '') {
		const xoEntryDirectory = path.dirname(xoFilePath);
		const xoPackageDirectory = xoFilePath.includes('dist')
			? path.dirname(xoEntryDirectory)
			: xoEntryDirectory;
		packageInfo = loadJsonFile<{version: string}>(path.join(xoPackageDirectory, 'package.json'));
	}

	let version: string;
	[{default: xo}, {version}] = await Promise.all([
		import(xoUri) as Promise<{default: Xo}>,
		packageInfo,
	]);

	if (typeof xo?.lintText !== 'function') {
		throw new TypeError('The XO library doesn\'t export a lintText method.');
	}

	this.log(
		endent`
			XO Library ${version} Loaded
			Resolved in Workspace ${folderPath}
			Cached for Folder ${uriToPath(xoCacheKey)}
			`,
	);
	this.xoCache.set(xoCacheKey, xo);

	return xo;
}

export default resolveXo;
