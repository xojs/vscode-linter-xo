'use strict';
import * as path from 'path';
import * as loadJsonFile from 'load-json-file';

export class Package {

	constructor(
		private workspaceRoot: string
	) { }

	isDependency(name: string) {
		const pkg = loadJsonFile.sync(path.join(this.workspaceRoot, 'package.json'));
		const deps = pkg.dependencies || {};
		const devDeps = pkg.devDependencies || {};

		return Boolean(deps[name] || devDeps[name]);
	}
}
