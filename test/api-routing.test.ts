import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.js';

process.env.HOME = tempHome();
delete process.env.SUNTROPY_API_KEY;
delete process.env.SUNTROPY_GATEWAY_URL;
const { createApiClient } = await import('../src/client.js');

const server = 'https://api.enerlence.com';
const both = { v1: { service: 'satvolt' as const, suffix: '/api/v1' }, v2: { prefix: '/api/v2/leadgen' } };

test('a sun_ key goes to v2 when the command supports it', () => {
  const { client, api } = createApiClient(both, { server, token: 'sun_k' });
  assert.equal(api, 'v2');
  assert.equal(client.defaults.baseURL, 'https://api.suntropy.ai/api/v2/leadgen');
});

test('a JWT goes to v1 when the command supports it', () => {
  const { client, api } = createApiClient(both, { server, token: 'eyJ.jwt' });
  assert.equal(api, 'v1');
  assert.equal(client.defaults.baseURL, 'https://api.enerlence.com/satvolt/api/v1');
});

test('a JWT on a v2-only command fails with V1_AUTH_NOT_SUPPORTED', () => {
  assert.throws(
    () => createApiClient({ v2: { prefix: '/api/v2/x' } }, { server, token: 'eyJ.jwt' }),
    (err: any) => err.code === 'V1_AUTH_NOT_SUPPORTED' && /auth login --web/.test(err.message),
  );
});

test('a sun_ key on a v1-only command fails with V2_KEY_NOT_SUPPORTED', () => {
  assert.throws(
    () => createApiClient({ v1: { service: 'solar' } }, { server, token: 'sun_k' }),
    (err: any) => err.code === 'V2_KEY_NOT_SUPPORTED',
  );
});
