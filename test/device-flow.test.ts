import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeServer } from './helpers.js';
import { canOpenBrowser, pollDeviceToken, requestDeviceCode, DeviceFlowError, type DeviceCodeResponse } from '../src/device-flow.js';

const APPROVED = {
  token_type: 'api_key',
  api_key: 'sun_secret',
  key_id: 'k-1',
  label: 'CLI · laptop · 2026-10-28',
  client_uid: 'client-1',
  scopes: ['leadgen:read', 'leadgen:write', 'credits:read'],
};

const code = (over: Partial<DeviceCodeResponse> = {}): DeviceCodeResponse => ({
  device_code: 'dc',
  user_code: 'BCDF-GHJK',
  verification_uri: 'https://app.suntropy.ai/cli',
  verification_uri_complete: 'https://app.suntropy.ai/cli?code=BCDF-GHJK',
  expires_in: 600,
  interval: 5,
  ...over,
});

/** Answers /device/token from a script, one entry per call. */
async function scripted(answers: Array<{ status: number; body: unknown }>) {
  let i = 0;
  return fakeServer(() => answers[Math.min(i++, answers.length - 1)]);
}

test('device code request sends client_id, device_name and scopes', async () => {
  const srv = await fakeServer(() => ({ body: code() }));
  try {
    const res = await requestDeviceCode(srv.url, { deviceName: 'laptop', scopes: ['leadgen:read'] });
    assert.equal(res.user_code, 'BCDF-GHJK');
    assert.equal(srv.requests[0].method, 'POST');
    assert.equal(srv.requests[0].url, '/api-gateway/device/code');
    assert.deepEqual(srv.requests[0].body, { client_id: 'suntropy-cli', device_name: 'laptop', scopes: ['leadgen:read'] });
  } finally {
    await srv.close();
  }
});

test('device code: invalid_scope is reported clearly', async () => {
  const srv = await fakeServer(() => ({ status: 400, body: { error: 'invalid_scope' } }));
  try {
    await assert.rejects(requestDeviceCode(srv.url, { scopes: ['nope'] }), /Unknown scope/);
  } finally {
    await srv.close();
  }
});

test('polling: pending → slow_down → approved, respecting interval and +5 s', async () => {
  const srv = await scripted([
    { status: 400, body: { error: 'authorization_pending' } },
    { status: 400, body: { error: 'slow_down' } },
    { status: 400, body: { error: 'authorization_pending' } },
    { status: 200, body: APPROVED },
  ]);
  const sleeps: number[] = [];
  try {
    const res = await pollDeviceToken(srv.url, code(), { sleep: async (ms) => void sleeps.push(ms) });
    assert.equal(res.api_key, 'sun_secret');
    assert.deepEqual(sleeps, [5000, 5000, 10000, 10000]);
    assert.equal(srv.requests.length, 4);
    for (const r of srv.requests) {
      assert.equal(r.url, '/api-gateway/device/token');
      assert.deepEqual(r.body, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: 'dc',
        client_id: 'suntropy-cli',
      });
    }
  } finally {
    await srv.close();
  }
});

for (const [error, status] of [
  ['access_denied', 'denied'],
  ['expired_token', 'expired'],
  ['invalid_grant', 'error'],
] as const) {
  test(`polling stops on ${error} (${status})`, async () => {
    const srv = await scripted([
      { status: 400, body: { error: 'authorization_pending' } },
      { status: 400, body: { error } },
      { status: 200, body: APPROVED },
    ]);
    try {
      await assert.rejects(pollDeviceToken(srv.url, code(), { sleep: async () => {} }), (err: unknown) => {
        assert.ok(err instanceof DeviceFlowError);
        assert.equal(err.status, status);
        assert.equal(err.code, error);
        return true;
      });
      assert.equal(srv.requests.length, 2, 'stops polling right away');
    } finally {
      await srv.close();
    }
  });
}

test('polling gives up locally once expires_in has passed', async () => {
  const srv = await scripted([{ status: 400, body: { error: 'authorization_pending' } }]);
  let clock = 0;
  try {
    await assert.rejects(
      pollDeviceToken(srv.url, code({ expires_in: 12 }), {
        now: () => clock,
        sleep: async (ms) => void (clock += ms),
      }),
      (err: unknown) => err instanceof DeviceFlowError && err.status === 'expired',
    );
    assert.equal(srv.requests.length, 2);
  } finally {
    await srv.close();
  }
});

test('browser: only with a TTY and a display, never in CI', () => {
  assert.equal(canOpenBrowser({}, 'darwin', true), true);
  assert.equal(canOpenBrowser({}, 'win32', true), true);
  assert.equal(canOpenBrowser({ CI: 'true' }, 'darwin', true), false);
  assert.equal(canOpenBrowser({}, 'darwin', false), false);
  assert.equal(canOpenBrowser({}, 'linux', true), false);
  assert.equal(canOpenBrowser({ DISPLAY: ':0' }, 'linux', true), true);
  assert.equal(canOpenBrowser({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux', true), true);
});
