import path from 'node:path';
import {TextDocumentIdentifier} from 'vscode-languageserver';
import isUndefined from 'lodash/isUndefined';
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
		const config = this.configurationCache.get(folderUri);

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
