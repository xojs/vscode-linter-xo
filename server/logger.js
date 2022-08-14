/**
 * log a message to the client console
 * in a console.log type of way - primarily used
 * for development and debugging
 * @param  {...any} messages
 */
function log(...messages) {
	const d = new Date();
	const ts = `${d.getHours()}:${d.getMinutes()}:${d.getSeconds()}:${d.getMilliseconds()}`;
	this.connection.console.log(
		// eslint-disable-next-line unicorn/no-array-reduce
		messages.reduce((acc, message) => {
			if (message instanceof Map)
				message = `Map(${JSON.stringify([...message.entries()], null, 2)})`;
			if (typeof message === 'object') message = JSON.stringify(message, null, 2);
			// eslint-disable-next-line unicorn/prefer-spread
			return acc.concat(message + ' ');
		}, `[${ts}] `)
	);
}

function logError(error) {
	this.log(error?.message ? error.message : 'Unknown Error');
	this.log(error?.stack);
}

module.exports = {
	log,
	logError
};
