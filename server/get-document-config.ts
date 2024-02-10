import path from 'node:path';
import {type TextDocumentIdentifier} from 'vscode-languageserver';
import {type XoConfig} from './types';
import type LintServer from './server';

/**
 * Gets document config
 * and caches it if needed
 */
async function getDocumentConfig(
	this: LintServer,
	document: TextDocumentIdentifier
): Promise<XoConfig> {
	if (this.configurationCache.has(document.uri)) {
		const config: XoConfig = this.configurationCache.get(document.uri)!;

		if (config !== undefined) return config;

		return {};
	}

	// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
	const config: XoConfig = await this.connection.workspace.getConfiguration({
		scopeUri: document.uri,
		section: 'xo'
	});

	this.configurationCache.set(document.uri, config);

	return config;
}

export default getDocumentConfig;
