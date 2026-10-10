import path from 'node:path';
import endent from 'endent';
import type {TextDocument} from 'vscode-languageserver-textdocument';
import {resolveXoLocation} from '../shared/resolve-xo-location.ts';
import type {ResolvedXo, Xo} from './types.ts';
import {uriToPath} from './utils.ts';
import type LintServer from './server.ts';

/**
 * Returns the cached XO module and package version for a document, or resolves
 * both from the workspace when needed. The version travels with the module so
 * downstream lint routing can preserve legacy defaults while enabling XO 5's
 * broader file support. Custom entry paths use their nearest `xo` package
 * manifest; paths without one deliberately receive an unknown version.
 */
async function resolveXo(this: LintServer, document: TextDocument): Promise<ResolvedXo> {
	const [{uri: folderUri = ''} = {}, config] = await Promise.all([
		this.getDocumentFolder(document),
		this.getDocumentConfig(document),
	]);
	const customPath = config.path ?? '';

	const xoCacheKey = path.dirname(document.uri);

	const cachedXo = this.xoCache.get(xoCacheKey);

	if (typeof cachedXo?.xo.lintText === 'function') {
		return cachedXo;
	}

	const folderPath = uriToPath(folderUri);
	const {xoUri, version} = await resolveXoLocation(
		folderPath,
		customPath,
		this.connection.tracer.log,
	);
	const {default: xo} = await import(xoUri) as {default: Xo};

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
	const resolvedXo = {xo, version};
	this.xoCache.set(xoCacheKey, resolvedXo);

	return resolvedXo;
}

export default resolveXo;
