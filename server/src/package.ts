import * as path from 'path';
import * as loadJsonFile from 'load-json-file';

interface PackageJSON {
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
}

export class Package {
	constructor(
		private readonly workspaceRoot: string,
	) {}

	isDependency(name: string) {
		try {
			const pkg = loadJsonFile.sync<PackageJSON>(path.join(this.workspaceRoot, 'package.json'));
			const deps = pkg.dependencies || {};
			const devDeps = pkg.devDependencies || {};

			return Boolean(deps[name] || devDeps[name]);
		} catch (error) {
			if (error.code === 'ENOENT') {
				return false;
			}

			throw error;
		}
	}
}
