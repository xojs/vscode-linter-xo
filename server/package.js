const path = require('path');
const loadJsonFile = require('load-json-file');

class Package {
	constructor(workspaceRoot) {
		this.workspaceRoot = workspaceRoot;

		try {
			this.pkg = loadJsonFile.sync(
				path.join(this.workspaceRoot, 'package.json')
			);
		} catch {}
	}

	getVersion(name) {
		const {pkg} = this;
		const deps = pkg.dependencies || {};
		const devDeps = pkg.devDependencies || {};

		return deps[name] ?? devDeps[name] ?? false;
	}

	isDependency(name) {
		try {
			if (!this.package)
				this.pkg = loadJsonFile.sync(
					path.join(this.workspaceRoot, 'package.json')
				);

			const {pkg} = this;
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

module.exports = Package;
