import test from 'ava';
import Server from '../../server/server.js';

test('Server is a function', (t) => {
	t.is(typeof Server, 'function');
});

test('Server can instantiate', (t) => {
	const server = new Server({isTest: true});
	t.is(typeof server, 'object');
});
