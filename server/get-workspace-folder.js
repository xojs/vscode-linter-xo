async function getWorkspaceFolder(document) {
	const workspaceFolders = await this.connection.workspace.getWorkspaceFolders();
	return workspaceFolders.find(({uri}) => document.uri.startsWith(uri));
}

module.exports = getWorkspaceFolder;
