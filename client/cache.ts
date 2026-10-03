import type {LogOutputChannel} from 'vscode';
import {findXoRoot} from '../server/utils.ts';

/**
 * Cache for file fspaths that have an xo root
 * in their directory tree.
 */
export class XoRootCache {
	private readonly cache: Map<string, boolean>;

	logger?: LogOutputChannel;

	constructor({logger}: {logger?: LogOutputChannel} = {}) {
		this.cache = new Map();
		this.logger = logger;
	}

	async get(uri?: string) {
		try {
			if (uri === undefined || uri === '') {
				return;
			}

			const cached = this.cache.get(uri);
			if (cached) {
				return cached;
			}

			const xoRoot = await findXoRoot(uri);

			const isXoFile = Boolean(xoRoot?.pkgPath);

			this.cache.set(uri, isXoFile);

			return isXoFile;
		} catch (error) {
			if (error instanceof Error) {
				this.logger?.error(error);
			}
		}
	}

	delete(uri: string) {
		this.cache.delete(uri);
	}
}

export const xoRootCache = new XoRootCache();
