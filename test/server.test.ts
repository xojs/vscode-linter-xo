import {test, describe, type TestContext} from 'node:test';
import Server from '../server/server.ts';

describe('Server', () => {
	test('Server is a function', (t: TestContext) => {
		t.assert.strictEqual(typeof Server, 'function');
	});

	test('Server can instantiate', (t: TestContext) => {
		const server = new Server({isTest: true});
		t.assert.strictEqual(typeof server, 'object');
	});
});
