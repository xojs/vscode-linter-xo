import * as path from 'path';
import * as loadJsonFile from 'load-json-file';

interface PackageJSON {
	dependencies?: {
		[key: string]: string;
	};
	devDependencies?: {
		[key: string]: string;
	};
}

export class Package {
	constructor(
		private readonly workspaceRoot: string
	) { }

	isDependency(name: string) {
		try {
			const pkg = loadJsonFile.sync(path.join(this.workspaceRoot, 'package.json')) as PackageJSON;
			const deps = pkg.dependencies || {};
			const devDeps = pkg.devDependencies || {};

			return Boolean(deps[name] || devDeps[name]);
		} catch (err) {
			if (err.code === 'ENOENT') {
				return false;
			}

			throw err;
		}
	}
}
