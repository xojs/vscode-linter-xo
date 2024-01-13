/* eslint-disable @typescript-eslint/no-floating-promises */
import {test, describe} from 'node:test';
import assert from 'node:assert';
import Server from '../../server/server.js';

describe('Server', () => {
	test('Server is a function', (t) => {
		assert.strictEqual(typeof Server, 'function');
	});

	test('Server can instantiate', (t) => {
		const server = new Server({isTest: true});
		assert.strictEqual(typeof server, 'object');
	});
});
