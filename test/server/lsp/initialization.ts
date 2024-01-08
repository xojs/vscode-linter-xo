import test from 'ava';
import Server from '../../../server/server.js';

const server = new Server({isTest: true});

test('Server.handleInitialize is a function', (t) => {
	t.is(typeof server.handleInitialize, 'function');
});

test('InitializeResult matches snapshot', async (t) => {
	t.snapshot(await server.handleInitialize());
});
