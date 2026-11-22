import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tempHome } from './helpers.js';

// config.ts computes ~/.suntropy at import time: point HOME somewhere empty first.
process.env.HOME = tempHome();
const { resolveGatewayUrl, isV2Key, getServiceUrl } = await import('../src/config.js');
const { satvoltClient } = await import('../src/commands/satvolt/api.js');

test('isV2Key tells sun_ keys from JWTs', () => {
  assert.equal(isV2Key('sun_abc'), true);
  assert.equal(isV2Key('eyJhbGciOi.x.y'), false);
  assert.equal(isV2Key(undefined), false);
});

test('gateway: prod server → api.suntropy.ai, dev server → api-dev.enerlence.com', () => {
  delete process.env.SUNTROPY_GATEWAY_URL;
  assert.deepEqual(resolveGatewayUrl('https://api.enerlence.com'), { url: 'https://api.suntropy.ai', source: 'prod' });
  assert.deepEqual(resolveGatewayUrl('https://api.enerlence.com/'), { url: 'https://api.suntropy.ai', source: 'prod' });
  assert.deepEqual(resolveGatewayUrl('https://api-dev.enerlence.com'), { url: 'https://api-dev.enerlence.com', source: 'dev' });
  assert.deepEqual(resolveGatewayUrl('https://api-dev.suntropy.domain.eu.axebow.cloud'), {
    url: 'https://api-dev.enerlence.com',
    source: 'dev',
  });
});

test('gateway: SUNTROPY_GATEWAY_URL wins, then the profile gatewayUrl', () => {
  process.env.SUNTROPY_GATEWAY_URL = 'http://localhost:8087/';
  try {
    assert.deepEqual(resolveGatewayUrl('https://api.enerlence.com', 'https://other'), { url: 'http://localhost:8087', source: 'env' });
  } finally {
    delete process.env.SUNTROPY_GATEWAY_URL;
  }
  assert.deepEqual(resolveGatewayUrl('http://localhost', 'http://localhost:8087'), { url: 'http://localhost:8087', source: 'profile' });
});

test('gateway: a local or unknown server without configuration is an explicit error', () => {
  delete process.env.SUNTROPY_GATEWAY_URL;
  assert.throws(() => resolveGatewayUrl('http://localhost'), /SUNTROPY_GATEWAY_URL|gatewayUrl/);
  assert.throws(() => resolveGatewayUrl('https://example.com'), /No API gateway known/);
});

test('satvolt with a JWT follows the profile server (no dev pinning)', () => {
  delete process.env.SUNTROPY_SATVOLT_URL;
  const prod = satvoltClient({ server: 'https://api.enerlence.com', token: 'eyJ.jwt.x' });
  assert.equal(prod.defaults.baseURL, 'https://api.enerlence.com/satvolt/api/v1');
  const dev = satvoltClient({ server: 'https://api-dev.enerlence.com', token: 'eyJ.jwt.x' });
  assert.equal(dev.defaults.baseURL, 'https://api-dev.enerlence.com/satvolt/api/v1');
  const local = satvoltClient({ server: 'http://localhost', token: 'eyJ.jwt.x' });
  assert.equal(local.defaults.baseURL, 'http://localhost:8099/api/v1');
  assert.equal(getServiceUrl('https://api.enerlence.com', 'payments'), 'https://api.enerlence.com/payments');
});

test('SUNTROPY_SATVOLT_URL still overrides satvolt for local development', () => {
  process.env.SUNTROPY_SATVOLT_URL = 'http://127.0.0.1:9999/';
  try {
    const c = satvoltClient({ server: 'https://api.enerlence.com', token: 'eyJ.jwt.x' });
    assert.equal(c.defaults.baseURL, 'http://127.0.0.1:9999/api/v1');
  } finally {
    delete process.env.SUNTROPY_SATVOLT_URL;
  }
});

test('satvolt with a sun_ key goes to <gateway>/api/v2/leadgen', () => {
  delete process.env.SUNTROPY_GATEWAY_URL;
  const c = satvoltClient({ server: 'https://api.enerlence.com', token: 'sun_x' });
  assert.equal(c.defaults.baseURL, 'https://api.suntropy.ai/api/v2/leadgen');
  assert.equal(c.defaults.headers.Authorization, 'Bearer sun_x');
});
