import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeServer, profileWith, readConfig, runCli, tempHome } from './helpers.js';

const lines = (s: string) => s.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

const APPROVED = {
  token_type: 'api_key',
  api_key: 'sun_fromweb',
  key_id: 'k-9',
  label: 'CLI · ci-box · 2026-10-28',
  client_uid: 'client-9',
  scopes: ['leadgen:read', 'leadgen:write', 'credits:read'],
};

function deviceGateway(tokenAnswers: Array<{ status: number; body: unknown }>) {
  let i = 0;
  return fakeServer((req) => {
    if (req.url === '/api-gateway/device/code') {
      return {
        body: {
          device_code: 'dc',
          user_code: 'BCDF-GHJK',
          verification_uri: 'https://app.suntropy.ai/cli',
          verification_uri_complete: 'https://app.suntropy.ai/cli?code=BCDF-GHJK',
          expires_in: 600,
          interval: 0,
        },
      };
    }
    return tokenAnswers[Math.min(i++, tokenAnswers.length - 1)];
  });
}

test('auth login --web --format json: one line with the code, another when approved; key saved', async () => {
  const gw = await deviceGateway([
    { status: 400, body: { error: 'authorization_pending' } },
    { status: 200, body: APPROVED },
  ]);
  const home = tempHome(profileWith('eyJ.old.jwt', 'https://api.enerlence.com', { authMethod: 'login', email: 'a@b.c', userUID: 'u1' }));
  try {
    const r = await runCli(['auth', 'login', '--web', '--device-name', 'ci-box', '--format', 'json'], {
      HOME: home,
      SUNTROPY_GATEWAY_URL: gw.url,
    });
    assert.equal(r.code, 0, r.stderr);
    const [first, last, ...rest] = lines(r.stdout);
    assert.equal(rest.length, 0);
    assert.deepEqual(first, {
      verification_uri: 'https://app.suntropy.ai/cli',
      verification_uri_complete: 'https://app.suntropy.ai/cli?code=BCDF-GHJK',
      user_code: 'BCDF-GHJK',
      expires_in: 600,
    });
    assert.deepEqual(last, { status: 'approved', label: APPROVED.label, clientUID: 'client-9', scopes: APPROVED.scopes });
    assert.equal(gw.requests[0].body.device_name, 'ci-box');
    const p = readConfig(home).profiles.default;
    assert.equal(p.token, 'sun_fromweb');
    assert.equal(p.authMethod, 'api-key-v2');
    assert.equal(p.clientUID, 'client-9');
    assert.equal(p.keyLabel, APPROVED.label);
    assert.equal(p.gatewayUrl, gw.url, 'a gateway forced by env sticks to the key');
    assert.equal(p.email, undefined);
    assert.equal(p.userUID, undefined);
    assert.equal(p.server, 'https://api.enerlence.com');
  } finally {
    await gw.close();
  }
});

test('auth login --web: denied → {status:"denied"} and exit 1, nothing saved', async () => {
  const gw = await deviceGateway([{ status: 400, body: { error: 'access_denied' } }]);
  const home = tempHome(profileWith('eyJ.old.jwt'));
  try {
    const r = await runCli(['auth', 'login', '--web'], { HOME: home, SUNTROPY_GATEWAY_URL: gw.url });
    assert.equal(r.code, 1);
    const out = lines(r.stdout);
    assert.equal(out.length, 2);
    assert.equal(out[1].status, 'denied');
    assert.match(out[1].message, /rejected/);
    assert.equal(readConfig(home).profiles.default.token, 'eyJ.old.jwt');
  } finally {
    await gw.close();
  }
});

test('auth login --web: expired → {status:"expired"}', async () => {
  const gw = await deviceGateway([{ status: 400, body: { error: 'expired_token' } }]);
  try {
    const r = await runCli(['auth', 'login', '--web'], { HOME: tempHome(), SUNTROPY_GATEWAY_URL: gw.url });
    assert.equal(r.code, 1);
    assert.equal(lines(r.stdout)[1].status, 'expired');
  } finally {
    await gw.close();
  }
});

test('auth login without --web nor credentials explains both ways', async () => {
  const r = await runCli(['auth', 'login'], { HOME: tempHome() });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /auth login --web/);
});

test('auth set-key sun_… marks the profile as API v2 key, auth status asks /api/v2/me', async () => {
  const gw = await fakeServer((req) =>
    req.url === '/api/v2/me'
      ? { body: { data: { clientUID: 'c-1', keyId: 'k-1', label: 'CLI · x', scopes: ['leadgen:read'], expiresAt: null }, requestId: 'r' } }
      : { status: 404, body: {} },
  );
  const home = tempHome(profileWith('eyJ.old.jwt', 'https://api.enerlence.com', { clientUID: 'old', userUID: 'old' }));
  try {
    const set = await runCli(['auth', 'set-key', '--key', 'sun_manual'], { HOME: home });
    assert.equal(set.code, 0, set.stderr);
    assert.equal(JSON.parse(set.stdout).method, 'api-key-v2');
    const p = readConfig(home).profiles.default;
    assert.equal(p.authMethod, 'api-key-v2');
    assert.equal(p.clientUID, undefined, 'identity of the old key is dropped');

    const st = await runCli(['auth', 'status'], { HOME: home, SUNTROPY_GATEWAY_URL: gw.url });
    assert.equal(st.code, 0, st.stderr);
    const s = JSON.parse(st.stdout);
    assert.equal(s.authenticated, true);
    assert.equal(s.credential, 'sun_');
    assert.equal(s.label, 'CLI · x');
    assert.deepEqual(s.scopes, ['leadgen:read']);
    assert.equal(s.clientUID, 'c-1');
    assert.equal(s.expiresAt, null);
    assert.equal(gw.requests[0].headers.authorization, 'Bearer sun_manual');
  } finally {
    await gw.close();
  }
});

test('auth status with a revoked sun_ key says how to get a new one', async () => {
  const gw = await fakeServer(() => ({ status: 401, body: { error: { code: 'INVALID_KEY', message: 'Invalid API key' } } }));
  try {
    const st = await runCli(['auth', 'status'], { HOME: tempHome(profileWith('sun_revoked')), SUNTROPY_GATEWAY_URL: gw.url });
    const s = JSON.parse(st.stdout);
    assert.equal(s.authenticated, false);
    assert.equal(s.code, 'INVALID_KEY');
    assert.match(s.message, /auth login --web/);
  } finally {
    await gw.close();
  }
});

test('auth refresh does not apply to sun_ keys; auth logout clears them', async () => {
  const home = tempHome(profileWith('sun_x', 'https://api.enerlence.com', { authMethod: 'api-key-v2', keyId: 'k', keyLabel: 'l' }));
  const rf = await runCli(['auth', 'refresh'], { HOME: home });
  assert.equal(rf.code, 1);
  assert.match(rf.stderr, /not refreshed/);
  const lo = await runCli(['auth', 'logout'], { HOME: home });
  assert.equal(lo.code, 0);
  const p = readConfig(home).profiles.default;
  assert.equal(p.token, undefined);
  assert.equal(p.keyId, undefined);
  assert.equal(p.keyLabel, undefined);
  assert.equal(p.server, 'https://api.enerlence.com');
});

test('satvolt with a sun_ key goes to /api/v2/leadgen and unwraps { data, requestId }', async () => {
  const gw = await fakeServer(() => ({
    body: { data: { items: [{ idCampaign: 1, name: 'A' }], total: 1, limit: 50, offset: 0 }, requestId: 'req-1' },
  }));
  try {
    const r = await runCli(['satvolt', 'campaigns', 'list'], { HOME: tempHome(profileWith('sun_k')), SUNTROPY_GATEWAY_URL: gw.url });
    assert.equal(r.code, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.data, [{ idCampaign: 1, name: 'A' }]);
    assert.equal(out.total, 1);
    assert.equal(gw.requests[0].method, 'GET');
    assert.match(gw.requests[0].url, /^\/api\/v2\/leadgen\/campaigns\?/);
    assert.equal(gw.requests[0].headers.authorization, 'Bearer sun_k');
  } finally {
    await gw.close();
  }
});

test('satvolt v2 errors keep the code and say what to do', async () => {
  const answers: Record<string, { status: number; body: unknown }> = {
    INVALID_KEY: { status: 401, body: { error: { code: 'INVALID_KEY', message: 'Invalid API key' }, requestId: 'r1' } },
    SATVOLT_NOT_ENABLED: { status: 401, body: { error: { code: 'SATVOLT_NOT_ENABLED', message: 'Satvolt is not enabled' }, requestId: 'r2' } },
    INSUFFICIENT_SCOPE: { status: 403, body: { error: { code: 'INSUFFICIENT_SCOPE', message: 'Missing scope leadgen:write' }, requestId: 'r3' } },
  };
  for (const [code, answer] of Object.entries(answers)) {
    const gw = await fakeServer(() => answer);
    try {
      const r = await runCli(['satvolt', 'usage'], { HOME: tempHome(profileWith('sun_k')), SUNTROPY_GATEWAY_URL: gw.url });
      assert.equal(r.code, 1);
      const err = JSON.parse(r.stderr.trim().split('\n').pop()!);
      assert.equal(err.code, code);
      assert.equal(err.status, answer.status);
      if (code === 'INVALID_KEY') assert.match(err.message, /revoked or expired.*auth login --web/);
      if (code === 'SATVOLT_NOT_ENABLED') assert.match(err.message, /not enabled/);
      if (code === 'INSUFFICIENT_SCOPE') assert.match(err.message, /scope/);
    } finally {
      await gw.close();
    }
  }
});

test('a v1-only command (§4 exclusions) with a sun_ key fails before calling, with a clear message', async () => {
  const srv = await fakeServer(() => ({ body: {} }));
  try {
    const r = await runCli(['--server', `${srv.url}/`, 'solarform', 'statistics', '--create'], { HOME: tempHome(profileWith('sun_k')) });
    assert.equal(r.code, 1);
    const err = JSON.parse(r.stderr.trim());
    assert.equal(err.code, 'V2_KEY_NOT_SUPPORTED');
    assert.match(err.message, /needs `suntropy auth login`/);
    assert.equal(srv.requests.length, 0);
  } finally {
    await srv.close();
  }
});

test('credits with a sun_ key: balance, packs and checkout through /api/v2/leadgen', async () => {
  const gw = await fakeServer((req) => {
    if (req.url === '/api/v2/leadgen/credits') return { body: { data: { balance: 2000, held: 0, available: 2000 }, requestId: 'r' } };
    if (req.url === '/api/v2/leadgen/credit-packs')
      return { body: { data: [{ id: 'credits-10k', credits: 10000, bonus: 0, totalCredits: 10000, amount: 50, currency: 'eur', eurPerCredit: 0.005 }], requestId: 'r' } };
    if (req.url === '/api/v2/leadgen/credit-packs/credits-10k/checkout' && req.method === 'POST')
      return { body: { data: { url: 'https://checkout.stripe.com/c/pay/cs_test_1', pack: {} }, requestId: 'r' } };
    return { status: 404, body: { error: { code: 'NOT_FOUND', message: 'nope' } } };
  });
  const env = { HOME: tempHome(profileWith('sun_k')), SUNTROPY_GATEWAY_URL: gw.url };
  try {
    const bal = await runCli(['satvolt', 'credits', 'balance'], env);
    assert.equal(bal.code, 0, bal.stderr);
    assert.equal(JSON.parse(bal.stdout).available, 2000);

    const packs = await runCli(['satvolt', 'credits', 'packs'], env);
    assert.equal(packs.code, 0, packs.stderr);
    assert.equal(JSON.parse(packs.stdout)[0].id, 'credits-10k');

    const co = await runCli(['satvolt', 'credits', 'checkout', 'credits-10k'], env);
    assert.equal(co.code, 0, co.stderr);
    assert.deepEqual(JSON.parse(co.stdout), { url: 'https://checkout.stripe.com/c/pay/cs_test_1' });

    const human = await runCli(['--format', 'human', 'satvolt', 'credits', 'checkout', 'credits-10k'], env);
    assert.equal(human.stdout, 'https://checkout.stripe.com/c/pay/cs_test_1\n');
  } finally {
    await gw.close();
  }
});

test('credits with a JWT: satvolt /credits and payments credit-packs on the profile server', async () => {
  const srv = await fakeServer((req) => {
    if (req.url === '/satvolt/api/v1/credits') return { body: { code: 200, data: { balance: 5 } } };
    if (req.url === '/payments/payments/satvolt/credit-packs') return { body: [{ id: 'credits-50k', credits: 50000 }] };
    if (req.url === '/payments/payments/satvolt/credit-packs/credits-50k/checkout')
      return { body: { url: 'https://checkout.stripe.com/c/pay/cs_test_2', pack: {} } };
    if (req.url === '/payments/payments/satvolt/credit-packs/bad/checkout')
      return { status: 400, body: { statusCode: 400, message: 'Solo un administrador de la cuenta puede comprar créditos.', error: 'Bad Request' } };
    return { status: 404 };
  });
  // Trailing slash: path-based routing like prod (no localhost port mapping).
  const env = { HOME: tempHome(profileWith('eyJ.jwt.x', `${srv.url}/`)) };
  try {
    const bal = await runCli(['satvolt', 'credits', 'balance'], env);
    assert.equal(JSON.parse(bal.stdout).balance, 5);
    const packs = await runCli(['satvolt', 'credits', 'packs'], env);
    assert.equal(JSON.parse(packs.stdout)[0].id, 'credits-50k');
    const co = await runCli(['satvolt', 'credits', 'checkout', 'credits-50k'], env);
    assert.deepEqual(JSON.parse(co.stdout), { url: 'https://checkout.stripe.com/c/pay/cs_test_2' });
    const bad = await runCli(['satvolt', 'credits', 'checkout', 'bad'], env);
    assert.equal(bad.code, 1);
    assert.match(JSON.parse(bad.stderr.trim()).message, /administrador/);
    assert.equal(srv.requests[0].headers.authorization, 'Bearer eyJ.jwt.x');
  } finally {
    await srv.close();
  }
});

test('auth login --web asks for the 17 CLI scopes by default; --scopes asks for fewer', async () => {
  const { DEFAULT_WEB_SCOPES } = await import('../src/device-flow.js');
  assert.equal(DEFAULT_WEB_SCOPES.length, 17);
  for (const s of ['settings:read', 'settings:write', 'notifications:write', 'projects:read', 'projects:write', 'calculations:read']) {
    assert.ok(DEFAULT_WEB_SCOPES.includes(s), s);
  }
  assert.ok(!DEFAULT_WEB_SCOPES.some((s) => s.startsWith('lidar:') || s === 'analytics:read'));
  for (const [extra, expected] of [
    [[], [...DEFAULT_WEB_SCOPES]],
    [['--scopes', 'studies:read'], ['studies:read']],
  ] as const) {
    const gw = await deviceGateway([{ status: 200, body: APPROVED }]);
    try {
      const r = await runCli(['auth', 'login', '--web', ...extra], { HOME: tempHome(profileWith('eyJ.a.b')), SUNTROPY_GATEWAY_URL: gw.url });
      assert.equal(r.code, 0, r.stderr);
      assert.deepEqual(gw.requests[0].body.scopes, expected);
    } finally {
      await gw.close();
    }
  }
});
