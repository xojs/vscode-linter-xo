import path from 'node:path';
import type {LogOutputChannel} from 'vscode';
import loadJsonFile from 'load-json-file';
import {resolveXoLocation} from './resolve-xo-location.ts';

interface XoRootCacheEntry {
	folderPath?: string;
	versions: Map<string, string>;
}

/**
 * Caches the XO root and resolved versions associated with open documents. The
 * client mirrors the server package’s resolution behavior so UI state
 * reflects the XO installation that will actually lint each document.
 */
export class XoRootCache {
	private readonly cache: Map<string, XoRootCacheEntry>;

	logger?: LogOutputChannel;

	/**
	 * Creates an empty document cache. The logger remains replaceable because the
	 * singleton is constructed before extension activation creates its output
	 * channel.
	 */
	constructor({logger}: {logger?: LogOutputChannel} = {}) {
		this.cache = new Map();
		this.logger = logger;
	}

	/**
	 * Reports whether a document belongs to a package that declares XO. Root
	 * discovery is cached per document because active-editor and startup checks
	 * commonly request the same path in quick succession. Packages without XO are
	 * skipped so nested projects can inherit an installation from a parent.
	 */
	async get(uri?: string): Promise<boolean | undefined> {
		try {
			if (uri === undefined || uri === '') {
				return;
			}

			const cached = this.cache.get(uri);
			if (cached !== undefined) {
				return cached.folderPath !== undefined;
			}

			const {findUpSync} = await import('find-up');
			let searchDirectory = uri;
			let folderPath: string | undefined;

			while (true) {
				const pkgPath = findUpSync('package.json', {cwd: searchDirectory});
				if (pkgPath === undefined) {
					break;
				}

				const pkgJson = loadJsonFile.sync<{
					dependencies?: Record<string, string>;
					devDependencies?: Record<string, string>;
				}>(pkgPath);
				const dependencies = {...pkgJson.dependencies, ...pkgJson.devDependencies};
				if (dependencies.xo !== undefined && dependencies.xo !== '') {
					folderPath = path.dirname(pkgPath);
					break;
				}

				const parentDirectory = path.resolve(path.dirname(pkgPath), '..');
				if (parentDirectory === path.dirname(pkgPath)) {
					break;
				}

				searchDirectory = parentDirectory;
			}

			this.cache.set(uri, {folderPath, versions: new Map()});

			return folderPath !== undefined;
		} catch (error) {
			if (error instanceof Error) {
				this.logger?.error(error);
			}
		}
	}

	/**
	 * Resolves the installed XO version for a document and optional custom entry
	 * path. Version results are cached separately for each `xo.path` value so a
	 * settings change cannot reuse metadata for the previous module.
	 */
	async getVersion(uri: string, customPath = ''): Promise<string | undefined> {
		try {
			await this.get(uri);
			const cached = this.cache.get(uri);
			if (cached?.folderPath === undefined) {
				return;
			}

			const cachedVersion = cached.versions.get(customPath);
			if (cachedVersion !== undefined) {
				return cachedVersion;
			}

			const {version} = await resolveXoLocation(
				cached.folderPath,
				customPath,
				(message, verbose) => {
					this.logger?.debug(message, verbose ?? '');
				},
			);
			cached.versions.set(customPath, version);
			return version;
		} catch (error) {
			if (error instanceof Error) {
				this.logger?.error(error);
			}
		}
	}

	/**
	 * Removes all cached metadata for a closed document so dependency changes are
	 * observed if that path is opened again later.
	 */
	delete(uri: string): void {
		this.cache.delete(uri);
	}

	/**
	 * Invalidates every root and version after package or configuration changes.
	 * Resolution remains lazy, so only subsequently inspected documents incur
	 * filesystem work.
	 */
	clear(): void {
		this.cache.clear();
	}
}

export const xoRootCache = new XoRootCache();
