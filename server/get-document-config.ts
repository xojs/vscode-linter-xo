import path from 'node:path';
import isUndefined from 'lodash/isUndefined';
import type {TextDocumentIdentifier} from 'vscode-languageserver';
import type {XoConfig} from './types';
import type LintServer from './server';

/**
 * Gets document config
 * and caches it if needed
 */
async function getDocumentConfig(
	this: LintServer,
	document: TextDocumentIdentifier
): Promise<XoConfig> {
	const folderUri = path.dirname(document.uri);

	if (this.configurationCache.has(folderUri)) {
		const config: XoConfig = this.configurationCache.get(folderUri)!;

		if (!isUndefined(config)) return config;

		return {};
	}

	const config: XoConfig = (await this.connection.workspace.getConfiguration({
		scopeUri: folderUri,
		section: 'xo'
	})) as XoConfig;

	this.configurationCache.set(folderUri, config);

	return config;
}

export default getDocumentConfig;
