/**
 * Operations with a route per API version.
 *
 * Each command operation declares how it runs against the internal services
 * (`v1`: user JWT or legacy API key) and against the public API v2 (`v2`: a
 * `sun_…` key, through the gateway). `invoke` picks the side from the
 * credential, so command code never branches on the version: it builds a
 * version-agnostic input, calls `invoke`, and prints what comes back. Both
 * sides return the same shape; the per-version translations (unwrapping
 * `data`, pagination, delete normalisation, field renames…) live next to the
 * routes in `src/api/ops/*`, with the helpers in `src/api/translate.ts`.
 */
import type { AxiosInstance } from 'axios';
import {
  createApiClient,
  resolveCredential,
  type ApiRoutes,
  type ClientOptions,
  type ServiceName,
} from '../client.js';
import type { SuntropyProfile } from '../config.js';

export type Api = 'v1' | 'v2';
export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Global CLI options as commands receive them (output options + client options). */
export type GlobalOptions = ClientOptions & { [key: string]: any };

/** Everything a route side may need while it runs. */
export interface Ctx {
  api: Api;
  /** Axios bound to `<server>/<service>` (v1) or `<gateway>/api/v2` (v2). */
  http: AxiosInstance;
  opts: GlobalOptions;
  profile: SuntropyProfile;
  token: string;
}

export interface Side<I, O> {
  /** v1 only: the internal service the route belongs to (default `solar`). */
  service?: ServiceName;
  run(ctx: Ctx, input: I): Promise<O>;
}

export interface Operation<I = any, O = any> {
  /** Stable id, used in tests, the parity harness and docs (`studies.list`). */
  id: string;
  v1?: Side<I, O>;
  v2?: Side<I, O>;
}

/** Path prefix of every API v2 route in the gateway. */
export const V2_PREFIX = '/api/v2';

export function operation<I = any, O = any>(id: string, sides: { v1?: Side<I, O>; v2?: Side<I, O> }): Operation<I, O> {
  return { id, ...sides };
}

/** The routes `createApiClient` needs to pick a client for `op`. */
export function routesOf(op: Operation): ApiRoutes {
  return {
    ...(op.v1 ? { v1: { service: op.v1.service ?? 'solar' } } : {}),
    ...(op.v2 ? { v2: { prefix: V2_PREFIX } } : {}),
  };
}

/**
 * Runs `op` with the credential in `opts`. An API v2 key runs the `v2` side, a
 * JWT or legacy key the `v1` side; a missing side fails before any request with
 * `V2_KEY_NOT_SUPPORTED` / `V1_AUTH_NOT_SUPPORTED`.
 */
export async function invoke<I, O>(op: Operation<I, O>, opts: GlobalOptions, input: I): Promise<O> {
  const { client, api } = createApiClient(routesOf(op), opts);
  const { profile, token } = resolveCredential(opts);
  const side = op[api] as Side<I, O>;
  return side.run({ api, http: client, opts, profile, token }, input);
}

// ─── Declarative route sides ──────────────────────────────────────────────

type Val<I, T> = T | ((input: I, ctx: Ctx) => T);
const value = <I, T>(v: Val<I, T> | undefined, input: I, ctx: Ctx): T | undefined =>
  typeof v === 'function' ? (v as (i: I, c: Ctx) => T)(input, ctx) : v;

export interface RequestSpec<I> {
  query?: Val<I, Record<string, unknown> | undefined>;
  body?: (input: I, ctx: Ctx) => unknown;
  headers?: Val<I, Record<string, string> | undefined>;
}

/** Sends one request and returns the response body. Drops `undefined` query values. */
export async function send(
  ctx: Ctx,
  method: Method,
  path: string,
  spec: { query?: Record<string, unknown>; body?: unknown; headers?: Record<string, string> } = {},
): Promise<any> {
  const params = spec.query
    ? Object.fromEntries(Object.entries(spec.query).filter(([, v]) => v !== undefined))
    : undefined;
  const res = await ctx.http.request({ method, url: path, params, data: spec.body, headers: spec.headers });
  return res.data;
}

/**
 * A v1 route: one request, the body as is (or through `out`).
 */
export function v1<I = any, O = any>(
  method: Method,
  path: Val<I, string>,
  spec: RequestSpec<I> & { service?: ServiceName; out?: (data: any, input: I, ctx: Ctx) => O } = {},
): Side<I, O> {
  return {
    service: spec.service,
    async run(ctx, input) {
      const data = await send(ctx, method, value(path, input, ctx)!, {
        query: value(spec.query, input, ctx),
        body: value(spec.body, input, ctx),
        headers: value(spec.headers, input, ctx),
      });
      return spec.out ? spec.out(data, input, ctx) : data;
    },
  };
}

/** The API v2 response envelope. */
export interface V2Envelope<T = any> {
  data: T;
  pagination?: { limit: number; offset: number; total: number; hasMore: boolean; nextOffset: number | null };
  warning?: unknown;
  requestId?: string;
}

/**
 * A v2 route: one request; `out` receives `data` already unwrapped (and the
 * whole envelope, for the pagination). Without `out`, the result is `data`.
 */
export function v2<I = any, O = any>(
  method: Method,
  path: Val<I, string>,
  spec: RequestSpec<I> & { out?: (data: any, input: I, ctx: Ctx, envelope: V2Envelope) => O } = {},
): Side<I, O> {
  return {
    async run(ctx, input) {
      const raw = await send(ctx, method, value(path, input, ctx)!, {
        query: value(spec.query, input, ctx),
        body: value(spec.body, input, ctx),
        headers: value(spec.headers, input, ctx),
      });
      const envelope: V2Envelope = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : { data: raw };
      return spec.out ? spec.out(envelope.data, input, ctx, envelope) : envelope.data;
    },
  };
}

/** A side written as a function, for flows with more than one request. */
export function custom<I = any, O = any>(run: (ctx: Ctx, input: I) => Promise<O>, service?: ServiceName): Side<I, O> {
  return { service, run };
}
