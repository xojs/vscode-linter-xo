import * as path from 'path';
import * as loadJsonFile from 'load-json-file';

export class Package {
	constructor(
		private readonly workspaceRoot: string
	) { }

	isDependency(name: string) {
		try {
			const pkg = loadJsonFile.sync(path.join(this.workspaceRoot, 'package.json'));
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
