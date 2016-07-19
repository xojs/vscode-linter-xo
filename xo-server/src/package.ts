'use strict';
import * as fs from 'fs';
import * as path from 'path';
const loadJsonFile = require('load-json-file');

export class Package {

	constructor(
		private workspaceRoot
	) {

	}

	isDependency(name: string) {
		const pkg = JSON.parse(fs.readFileSync(path.join(this.workspaceRoot, 'package.json'), 'utf8'));
		const deps = pkg.dependencies || {};
		const devDeps = pkg.devDependencies || {};

		return Boolean(deps[name] || devDeps[name]);
	}
}
