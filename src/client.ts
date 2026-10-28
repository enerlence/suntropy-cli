import axios, { AxiosInstance, AxiosError } from 'axios';
import { loadConfig, getActiveProfile, getServiceUrl, isV2Key, resolveGatewayUrl, type SuntropyProfile } from './config.js';

export interface ClientOptions {
  server?: string;
  token?: string;
  profile?: string;
  verbose?: boolean;
}

export interface ApiError {
  error: true;
  status: number;
  message: string;
  code?: string;
  details?: unknown;
}

/** An error with a machine-readable `code`, kept by `handleApiError`. */
export class CliError extends Error {
  constructor(message: string, readonly code: string, readonly status?: number) {
    super(message);
  }
}

export const V2_KEY_NOT_SUPPORTED_MESSAGE =
  'This command needs `suntropy auth login` (a user session): it has no API v2 route, so an API v2 key ' +
  '(sun_…) cannot run it. See docs/v2-gaps.md for the commands that stay on v1.';

export interface ResolvedCredential {
  server: string;
  token: string;
  /** `v2`: an API v2 key (`sun_…`) for the gateway; `legacy`: user JWT or old API key. */
  kind: 'v2' | 'legacy';
  profile: SuntropyProfile;
}

/**
 * Resolves the credential in use and tells its kind. Same precedence as
 * always: --token > SUNTROPY_API_KEY > stored profile token.
 */
export function resolveCredential(opts: ClientOptions): ResolvedCredential {
  const { server, token, profile } = resolveAuth(opts);
  return { server, token, profile, kind: isV2Key(token) ? 'v2' : 'legacy' };
}

function resolveAuth(opts: ClientOptions): { server: string; token: string; profile: SuntropyProfile } {
  const config = loadConfig();
  const profile = getActiveProfile(config, opts.profile);
  const server = opts.server || profile.server;
  // Auth token resolution order: explicit --token flag > SUNTROPY_API_KEY env var > stored profile token.
  // The env var fallback lets host runtimes (e.g. ShellPilot) inject a just-in-time credential
  // without requiring a prior `auth login` / `auth set-key` to write the config file.
  const token = opts.token || process.env.SUNTROPY_API_KEY || profile.token;
  if (!token) {
    throw new Error('Not authenticated. Run: suntropy auth set-key --key <jwt> or suntropy auth login, or set the SUNTROPY_API_KEY env var.');
  }
  return { server, token, profile };
}

export type ServiceName = 'security' | 'solar' | 'templates' | 'profiles' | 'periods' | 'notifications' | 'satvolt' | 'payments';

export const V1_AUTH_NOT_SUPPORTED_MESSAGE =
  'This command needs an API v2 key. Run `suntropy auth login --web` (or `suntropy auth set-key --key sun_…`); ' +
  'a user session or a legacy API key does not work with it.';

/**
 * Where a command can send its requests. A command declares the API versions
 * it supports and `createApiClient` picks one from the credential at request
 * time: an API v2 key (`sun_…`) goes to `v2`, a user JWT or legacy key to `v1`.
 * When the command does not support the version of the credential, it fails
 * before any request with `V2_KEY_NOT_SUPPORTED` or `V1_AUTH_NOT_SUPPORTED`.
 */
export interface ApiRoutes {
  /** Internal service route: `<server>/<service><suffix>`. */
  v1?: { service: ServiceName; suffix?: string; baseUrlOverride?: string };
  /** API gateway route: `<gateway><prefix>` (e.g. `/api/v2/leadgen`). */
  v2?: { prefix: string };
}

export interface ApiClient {
  client: AxiosInstance;
  api: 'v1' | 'v2';
}

export function createApiClient(routes: ApiRoutes, opts: ClientOptions): ApiClient {
  const { server, token, profile } = resolveAuth(opts);
  if (isV2Key(token)) {
    if (!routes.v2) throw new CliError(V2_KEY_NOT_SUPPORTED_MESSAGE, 'V2_KEY_NOT_SUPPORTED');
    const gateway = resolveGatewayUrl(server, profile.gatewayUrl);
    return { client: buildClient(`${gateway.url}${routes.v2.prefix}`, token, opts.verbose), api: 'v2' };
  }
  if (!routes.v1) throw new CliError(V1_AUTH_NOT_SUPPORTED_MESSAGE, 'V1_AUTH_NOT_SUPPORTED');
  const base = routes.v1.baseUrlOverride || getServiceUrl(server, routes.v1.service);
  return { client: buildClient(`${base}${routes.v1.suffix ?? ''}`, token, opts.verbose), api: 'v1' };
}

/**
 * Client for an internal service route (`<server>/<service>`), for commands
 * that only exist in v1. Same as `createApiClient({ v1: { service } })`: an
 * API v2 key is refused before any request with `V2_KEY_NOT_SUPPORTED`.
 */
export function createServiceClient(service: ServiceName, opts: ClientOptions): AxiosInstance {
  return createApiClient({ v1: { service } }, opts).client;
}

/**
 * Client for the API gateway, for commands that only exist in v2. Same as
 * `createApiClient({ v2: { prefix } })`: a user JWT or legacy key is refused
 * before any request with `V1_AUTH_NOT_SUPPORTED`.
 */
export function createGatewayClient(pathPrefix: string, opts: ClientOptions): AxiosInstance {
  return createApiClient({ v2: { prefix: pathPrefix } }, opts).client;
}

function buildClient(baseURL: string, token: string, verbose?: boolean): AxiosInstance {
  const client = axios.create({
    baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (verbose) {
    client.interceptors.request.use((req) => {
      process.stderr.write(`→ ${req.method?.toUpperCase()} ${req.baseURL}${req.url}\n`);
      if (req.data) process.stderr.write(`  Body: ${JSON.stringify(req.data).slice(0, 200)}\n`);
      return req;
    });
    client.interceptors.response.use(
      (res) => {
        process.stderr.write(`← ${res.status} (${JSON.stringify(res.data).length} bytes)\n`);
        return res;
      },
      (err: AxiosError) => {
        process.stderr.write(`← ERROR ${err.response?.status || 'NETWORK'}: ${err.message}\n`);
        return Promise.reject(err);
      },
    );
  }

  return client;
}

/** Unauthenticated client for login */
export function createUnauthClient(baseURL: string): AxiosInstance {
  return axios.create({
    baseURL,
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A MongoDB ObjectId serializes to exactly 24 hexadecimal characters. */
const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

/**
 * Guards a solar-study `_id` argument before it reaches the backend.
 *
 * `GET /solar-study/findById/:_id` runs `solarStudyModel.findOne({ _id })`,
 * which makes Mongoose cast the value to an ObjectId. A non-ObjectId string
 * (e.g. a UUID like a chat/shareable uid) throws a `CastError` server-side and
 * surfaces as an opaque **HTTP 500**, so the caller gets no hint about what
 * went wrong. Every real study `_id` is a 24-hex ObjectId, so we can reject
 * bad ids client-side with an actionable message instead.
 *
 * Throws so the caller's try/catch surfaces it via `outputError` (exit != 0).
 */
export function assertStudyObjectId(id: string): string {
  if (OBJECT_ID_RE.test(id)) return id;
  const looksLikeUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
  const hint = looksLikeUuid
    ? `It looks like a UUID (e.g. a chat or shareable uid), not a study _id.`
    : `A study _id is a 24-character hex MongoDB ObjectId.`;
  throw new Error(
    `Invalid study id: "${id}". ${hint} ` +
      `Get the correct id from \`suntropy studies list\` (the \`solarStudyId\` field).`,
  );
}

/**
 * Validates that an API response body actually contains an entity.
 *
 * The solar backend returns `200` with an EMPTY body when `findById` /
 * `addSolarStudyComment` don't match a document (wrong id, or the id belongs to
 * a different clientUID / environment). Without this guard the CLI either
 * crashes downstream (`'_id' in data`, `data.solarStudyProgress = ...` on `""`)
 * or — worse, for writes — reports `success` even though nothing was saved.
 *
 * Throws a clear, actionable error so the caller's try/catch surfaces it via
 * `outputError` with a non-zero exit code.
 */
export function assertFound<T>(data: T, entity: string, id: string): T {
  const isEmptyObject =
    data != null &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Object.keys(data as Record<string, unknown>).length === 0;
  if (data == null || typeof data !== 'object' || Array.isArray(data) || isEmptyObject) {
    throw new Error(
      `${entity} not found: ${id}. The backend returned an empty response — ` +
        `verify the id is correct and belongs to your account and environment ` +
        `(the CLI and the app must point to the same backend).`,
    );
  }
  return data;
}

export function handleApiError(err: unknown): ApiError {
  if (axios.isAxiosError(err)) {
    const ae = err as AxiosError;
    const v2 = v2ErrorBody(ae.response?.data);
    if (v2) {
      // API v2 error envelope: { error: { code, message, details? }, requestId }.
      return {
        error: true,
        status: ae.response?.status || 0,
        code: v2.code,
        message: v2.message || ae.response?.statusText || ae.message,
        ...(v2.details !== undefined ? { details: v2.details } : {}),
      };
    }
    return {
      error: true,
      status: ae.response?.status || 0,
      message: ae.response?.statusText || ae.message,
      details: ae.response?.data,
    };
  }
  return {
    error: true,
    status: err instanceof CliError ? err.status ?? 0 : 0,
    message: err instanceof Error ? err.message : String(err),
    ...(err instanceof CliError ? { code: err.code } : {}),
  };
}

/** `{ error: { code, message, details? } }`, the API v2 error body; undefined otherwise. */
export function v2ErrorBody(data: unknown): { code: string; message?: string; details?: unknown } | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const e = (data as { error?: unknown }).error;
  if (!e || typeof e !== 'object' || Array.isArray(e)) return undefined;
  const { code, message, details } = e as { code?: unknown; message?: unknown; details?: unknown };
  if (typeof code !== 'string') return undefined;
  return { code, message: typeof message === 'string' ? message : undefined, details };
}
