/**
 * v1 ↔ v2 routing tests: the same command runs once with a user JWT and once
 * with a `sun_` key against a fake server that answers both route trees. Each
 * case checks the requests of each version (method, path, query and body) and
 * that the JSON printed is the same.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeServer, profileWith, runCli, tempHome, type RecordedRequest } from './helpers.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

/** Sample responses of a group (`test/fixtures/<name>.json`). */
export function fixtures(name: string): Record<string, any> {
  return JSON.parse(readFileSync(join(FIXTURES, `${name}.json`), 'utf-8'));
}

/** A JWT the CLI can read the tenant from (not signed: the fake server does not check it). */
export const JWT = [
  Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
  Buffer.from(JSON.stringify({ clientUID: 'client-1', userUID: 'u1' })).toString('base64url'),
  'sig',
].join('.');
export const V2_KEY = 'sun_test_key';

/** v2 envelopes. */
export const env = (data: unknown) => ({ data, requestId: 'r-1' });
export const page = (data: unknown[], total: number, limit: number, offset: number) => ({
  data,
  pagination: { limit, offset, total, hasMore: offset + data.length < total, nextOffset: offset + data.length < total ? offset + data.length : null },
  requestId: 'r-1',
});

export type Reply = unknown | { status: number; body?: unknown };
export type Route = Reply | ((req: RecordedRequest, url: URL) => Reply);
const isReply = (r: unknown): r is { status: number; body?: unknown } =>
  !!r && typeof r === 'object' && !Array.isArray(r) && typeof (r as { status?: unknown }).status === 'number' && Object.keys(r as object).every((k) => k === 'status' || k === 'body');

export interface Expect {
  method: string;
  path: string;
  /** Query parameters that must be there, as strings. `null` = must be absent. */
  query?: Record<string, string | null>;
  body?: unknown;
}

export interface Case {
  name: string;
  args: string[];
  /** `"METHOD /path"` → answer, for the v1 run (paths with the service prefix: `/solar/...`). */
  v1: Record<string, Route>;
  v2: Record<string, Route>;
  /** Requests each run must make, in order (other requests may come in between). */
  expectV1: Expect[];
  expectV2: Expect[];
  /** Exit code of both runs (default 0). */
  code?: number;
  /** Compare stdout after this (for the differences §1.8 allows). */
  normalize?: (out: any) => any;
  /** Check the stdout of the v1 run (it is also the v2 one). */
  check?: (out: any) => void;
  /** Extra profile fields for both runs. */
  profile?: Record<string, unknown>;
  /** Runs before each of the two runs (e.g. writes a fresh local study file). */
  prepare?: () => void | Promise<void>;
}

function router(routes: Record<string, Route>) {
  return (req: RecordedRequest) => {
    const url = new URL(req.url, 'http://x');
    const route = routes[`${req.method} ${url.pathname}`];
    if (route === undefined) return { status: 404, body: { error: { code: 'NOT_FOUND', message: `no fixture for ${req.method} ${url.pathname}` } } };
    const reply = typeof route === 'function' ? (route as (r: RecordedRequest, u: URL) => Reply)(req, url) : route;
    return isReply(reply) ? reply : { status: 200, body: reply };
  };
}

function assertRequests(requests: RecordedRequest[], expected: Expect[], label: string) {
  let at = 0;
  for (const e of expected) {
    const i = requests.findIndex((r, idx) => idx >= at && r.method === e.method && new URL(r.url, 'http://x').pathname === e.path);
    assert.ok(i >= 0, `${label}: no ${e.method} ${e.path}. Requests: ${requests.map((r) => `${r.method} ${r.url}`).join(', ')}`);
    const r = requests[i];
    const url = new URL(r.url, 'http://x');
    for (const [k, v] of Object.entries(e.query ?? {})) {
      assert.equal(url.searchParams.get(k), v, `${label}: ${e.method} ${e.path} query ${k}`);
    }
    if ('body' in e) assert.deepEqual(r.body, e.body, `${label}: ${e.method} ${e.path} body`);
    at = i + 1;
  }
}

async function runWith(c: Case, token: string, routes: Record<string, Route>) {
  await c.prepare?.();
  const srv = await fakeServer(router(routes));
  try {
    const home = tempHome(profileWith(token, 'https://api.enerlence.com', c.profile ?? {}));
    const r = await runCli(['--server', `${srv.url}/`, ...c.args, '--format', 'json'], {
      HOME: home,
      SUNTROPY_GATEWAY_URL: srv.url,
    });
    return { ...r, requests: [...srv.requests] };
  } finally {
    await srv.close();
  }
}

/** Runs a case with both credentials and checks routes and output. */
export async function parity(c: Case) {
  const r1 = await runWith(c, JWT, c.v1);
  const r2 = await runWith(c, V2_KEY, c.v2);
  const code = c.code ?? 0;
  assert.equal(r1.code, code, `v1 exit: ${r1.stderr}`);
  assert.equal(r2.code, code, `v2 exit: ${r2.stderr}`);
  assertRequests(r1.requests, c.expectV1, 'v1');
  assertRequests(r2.requests, c.expectV2, 'v2');
  for (const r of r1.requests) assert.equal(r.headers.authorization, `Bearer ${JWT}`);
  for (const r of r2.requests) {
    assert.equal(r.headers.authorization, `Bearer ${V2_KEY}`);
    assert.ok(new URL(r.url, 'http://x').pathname.startsWith('/api/v2/'), `v2 request outside /api/v2: ${r.url}`);
  }
  if (code !== 0) return { v1: r1, v2: r2 };
  const parse = (s: string) => JSON.parse(s);
  const out1 = parse(r1.stdout);
  const out2 = parse(r2.stdout);
  const n = c.normalize ?? ((x: any) => x);
  assert.deepEqual(n(out2), n(out1), 'the JSON printed by v1 and v2 differs');
  c.check?.(out1);
  return { v1: r1, v2: r2, out: out1 };
}
