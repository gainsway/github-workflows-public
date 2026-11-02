import test from 'node:test';
import assert from 'node:assert/strict';
import { endpointKey, requestKey, mergeRequest, safeName, folderName, assertWithin } from '../lib/yaml-merge.mjs';
import path from 'node:path';

const existing = {
  info: { name: 'Get products', type: 'http', seq: 7 },
  http: {
    method: 'POST', url: '{{baseUrl}}/api/products/{productId}',
    auth: { type: 'bearer', token: '{{token}}' },
    params: [{ name: 'productId', type: 'path', value: '42' }, { name: 'debug', type: 'query', value: '1' }],
    headers: [{ name: 'X-Correlation', value: '{{correlationId}}' }],
    body: { type: 'json', data: '{"label":"kept", "nested":{"old":42}, "manual":"hello"}' }
  },
  runtime: { scripts: [{ type: 'before-request', code: 'bru.setVar("x", 1)' }] },
  examples: [{ name: '201 Response', response: { status: 201, body: { type: 'json', data: '{"token":"real"}' } } }],
  settings: { timeout: 30000 },
  extensions: { custom: { owner: 'user' } }
};
const generated = {
  info: { name: 'Renamed operation', type: 'http' },
  http: {
    method: 'POST', url: 'https://api.example.com/api/products/{{someOtherParam}}',
    auth: { type: 'none' },
    params: [{ name: 'productId', type: 'path', value: '' }, { name: 'limit', type: 'query', value: '10' }],
    headers: [{ name: 'content-type', value: 'application/json' }],
    body: { type: 'json', data: '{"label":"", "nested":{"old":0,"new":true},"newField":"default"}' }
  },
  examples: [{ name: 'fake example' }]
};

test('matches same endpoint across baseUrl and different parameter names', () => {
  assert.equal(requestKey(existing), requestKey(generated));
  assert.equal(endpointKey('GET', 'https://example.org/api/a?b=1'), 'GET /api/a');
  assert.equal(endpointKey('GET', '{{baseUrl}}/api/a/{{id}}'), 'GET /api/a/:param');
  assert.equal(endpointKey('GET', 'https://example.org'), 'GET /');
  assert.equal(endpointKey('GET', 'not-a-url'), null);
  assert.notEqual(endpointKey('POST', '/foo'), endpointKey('GET', '/foo'));
});

test('adds spec parameters and body fields, but preserves custom values and examples', () => {
  const merged = mergeRequest(existing, generated);
  assert.deepEqual(merged.info, existing.info);
  assert.deepEqual(merged.examples, existing.examples);
  assert.deepEqual(merged.runtime, existing.runtime);
  assert.deepEqual(merged.http.auth, existing.http.auth);
  assert.deepEqual(merged.settings, existing.settings);
  assert.deepEqual(merged.extensions, existing.extensions);
  assert.equal(merged.http.url, existing.http.url);
  assert.equal(merged.http.params.find(p => p.name === 'limit').value, '10');
  assert.equal(merged.http.params.find(p => p.name === 'productId').value, '42');
  assert.equal(merged.http.params.find(p => p.name === 'debug').value, '1');
  assert.equal(merged.http.headers.find(h => h.name === 'X-Correlation').value, '{{correlationId}}');
  const body = JSON.parse(merged.http.body.data);
  assert.equal(body.nested.old, 42);
  assert.equal(body.nested.new, true);
  assert.equal(body.newField, 'default');
  assert.equal(body.manual, 'hello');
  assert.deepEqual(existing.http.body.data, '{"label":"kept", "nested":{"old":42}, "manual":"hello"}');
});

test('merging again is idempotent, even with preserved custom values', () => {
  const first = mergeRequest(existing, generated);
  assert.deepEqual(mergeRequest(first, generated), first);
});

test('templated or non-JSON bodies are never destructively rewritten', () => {
  const current = structuredClone(existing); current.http.body.data = '{"some":"{{value}}"}';
  assert.equal(mergeRequest(current, generated).http.body.data, current.http.body.data);
  current.http.body.type = 'text';current.http.body.data = 'custom';
  assert.equal(mergeRequest(current, generated).http.body.data, 'custom');
});

test('filename is deterministic, bounded in UTF-8, and immune to path traversal', () => {
  const name = safeName('../' + '✅'.repeat(100) + '/get', 'POST /api/foo');
  assert.ok(Buffer.byteLength(name) < 255);
  assert.ok(!name.includes('/'));assert.ok(name.endsWith('.yml'));
  assert.equal(name, safeName('../' + '✅'.repeat(100) + '/get', 'POST /api/foo'));
  assert.notEqual(name, safeName('../' + '✅'.repeat(100) + '/get', 'GET /api/foo'));
  assert.throws(() => folderName('..'), /Invalid/);
  assert.throws(() => assertWithin('/tmp/collection', path.resolve('/tmp/other')), /outside/);
});
