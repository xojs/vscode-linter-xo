import path from 'node:path';
import {Files} from 'vscode-languageserver/node';
import {URI} from 'vscode-uri';
import loadJsonFile from 'load-json-file';

export interface ResolvedXoLocation {
	xoUri: string;
	version: string;
}

/**
 * Resolves the XO entry point and package version without loading the module.
 * Both the extension host and language server use this boundary so status-bar
 * relevance and actual lint routing agree for normal, relative, absolute, and
 * file-URI `xo.path` values. A custom entry point without a neighboring XO
 * package manifest receives an unknown version and therefore cannot opt into
 * version-dependent defaults.
 */
export async function resolveXoLocation(
	folderPath: string,
	customPath = '',
	tracer: (message: string, verbose?: string) => void = () => undefined,
): Promise<ResolvedXoLocation> {
	let xoUri: string;

	if (customPath === '') {
		const xoFilePath = await Files.resolve('xo', undefined, folderPath, tracer);
		xoUri = URI.file(xoFilePath).toString();
	} else if (customPath.startsWith('file://')) {
		xoUri = customPath;
	} else if (path.isAbsolute(customPath)) {
		xoUri = URI.file(customPath).toString();
	} else {
		xoUri = URI.file(path.join(folderPath, customPath)).toString();
	}

	const {findUp} = await import('find-up');
	const packagePath = await findUp('package.json', {
		cwd: path.dirname(URI.parse(xoUri).fsPath),
	});
	const packageInfo = packagePath === undefined
		? {name: '', version: 'custom'}
		: await loadJsonFile<{name?: string; version?: string}>(packagePath);
	const version = packageInfo.name === 'xo' ? packageInfo.version ?? 'custom' : 'custom';

	return {xoUri, version};
}
