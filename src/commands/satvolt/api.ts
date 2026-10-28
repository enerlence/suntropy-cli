import axios, { AxiosInstance } from 'axios';
import { readFileSync } from 'fs';
import type { Command } from 'commander';
import { createGatewayClient, createServiceClient, handleApiError, resolveCredential, type ApiError } from '../../client.js';
import type { OutputOptions } from '../../output.js';

export type GlobalOpts = OutputOptions & {
  server?: string;
  token?: string;
  profile?: string;
  verbose?: boolean;
};

export function getGlobalOpts(cmd: Command): GlobalOpts {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as GlobalOpts;
}

/** Satvolt public API behind the gateway, for API v2 keys (`sun_…`). */
export const LEADGEN_V2_PREFIX = '/api/v2/leadgen';

/**
 * Client for the Satvolt public API. The route paths are the same either way:
 * - API v2 key (`sun_…`): `<gateway>/api/v2/leadgen` (see `resolveGatewayUrl`);
 * - user JWT or legacy key: `<server>/satvolt/api/v1` by `getServiceUrl`, like
 *   any other service (`localhost:8099/api/v1` locally). `SUNTROPY_SATVOLT_URL`
 *   points it elsewhere, for local development.
 */
export function satvoltClient(global: GlobalOpts, timeout = 60000): AxiosInstance {
  const client =
    resolveCredential(global).kind === 'v2'
      ? createGatewayClient(LEADGEN_V2_PREFIX, global)
      : legacySatvoltClient(global);
  client.defaults.timeout = timeout;
  return client;
}

function legacySatvoltClient(global: GlobalOpts): AxiosInstance {
  const client = createServiceClient('satvolt', global);
  const override = process.env.SUNTROPY_SATVOLT_URL?.trim();
  const base = override ? override.replace(/\/+$/, '') : client.defaults.baseURL ?? '';
  client.defaults.baseURL = `${base}/api/v1`;
  return client;
}

/**
 * Envelope of every JSON endpoint. Satvolt answers `{ code, data, error }`; the
 * gateway (API v2) re-wraps it as `{ data, pagination?, requestId }` or
 * `{ error: { code, message }, requestId }`. The payload is `data` in both.
 */
interface Envelope<T> {
  code?: number;
  data?: T;
  pagination?: unknown;
  requestId?: string;
  error?: { code?: string; message?: string; details?: unknown };
}

/**
 * What to do about the error codes an agent can hit, appended to the server's
 * message so the user knows the next step instead of a bare status.
 */
const ERROR_HINTS: Record<string, string> = {
  INVALID_KEY: 'The API key is revoked or expired: run `suntropy auth login --web` again.',
  API_KEY_REQUIRED: 'This route needs an API v2 key: run `suntropy auth login --web`.',
  INSUFFICIENT_SCOPE:
    'The API key lacks the scope for this action (leadgen:read, leadgen:write or credits:read). ' +
    'Create one with the right scopes: `suntropy auth login --web`.',
  SATVOLT_NOT_ENABLED:
    'LeadGen is not enabled for this account. Request access at https://www.suntropy.ai/leadgen/#acceso.',
  ACCESS_CHECK_UNAVAILABLE: 'The account check is temporarily unavailable. Try again in a few minutes.',
  UNAUTHORIZED: 'The session expired or the token is not valid: log in again (`suntropy auth login --web`).',
  V2_REQUIRED: 'API v2 keys only work on /api/v2 routes.',
  UPSTREAM_TIMEOUT: 'The service took too long to answer. Try again.',
};

function withHint(code: string | undefined, message: string): string {
  const hint = code ? ERROR_HINTS[code] : undefined;
  if (!hint) return message;
  return message && message !== code && !message.includes(hint) ? `${hint} (${message})` : hint;
}

export async function call<T = any>(
  client: AxiosInstance,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: string,
  options: { params?: Record<string, unknown>; data?: unknown } = {},
): Promise<T> {
  const res = await client.request<Envelope<T>>({
    method,
    url: path,
    params: dropEmpty(options.params),
    data: options.data,
  });
  return res.data?.data as T;
}

/**
 * Same as `call`, for the endpoints that take a file: the Excel goes as the
 * multipart field `file` and the rest of the body as a JSON string in `payload`.
 */
export async function callMultipart<T = any>(
  client: AxiosInstance,
  path: string,
  filePath: string,
  payload?: Record<string, unknown>,
  params?: Record<string, unknown>,
): Promise<T> {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', readFileSync(filePath), { filename: filePath.split('/').pop() });
  if (payload) form.append('payload', JSON.stringify(payload));
  const res = await client.request<Envelope<T>>({
    method: 'post',
    url: path,
    params: dropEmpty(params),
    data: form,
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
  });
  return res.data?.data as T;
}

function dropEmpty(params?: Record<string, unknown>) {
  if (!params) return undefined;
  return Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''),
  );
}

/**
 * Turns API failures into the CLI error shape, keeping the machine-readable
 * `code` and validation `details` from the envelope (e.g. which step and field
 * failed) instead of axios' generic status text.
 */
export function satvoltError(err: unknown): ApiError & { code?: string } {
  if (axios.isAxiosError(err)) {
    let body = err.response?.data as unknown;
    // Downloads use responseType arraybuffer: decode the JSON error body.
    if (body instanceof ArrayBuffer || Buffer.isBuffer(body)) {
      try {
        body = JSON.parse(Buffer.from(body as ArrayBuffer).toString('utf-8'));
      } catch {
        body = undefined;
      }
    }
    const envelope = body as Envelope<unknown> | undefined;
    if (envelope?.error && typeof envelope.error === 'object') {
      const code = envelope.error.code;
      return {
        error: true,
        status: err.response?.status ?? 0,
        code,
        message: withHint(code, envelope.error.message || code || 'Request failed'),
        details: envelope.error.details ?? (envelope.requestId ? { requestId: envelope.requestId } : undefined),
      };
    }
    // NestJS errors (e.g. payments): { statusCode, message, error }.
    const nest = body as { message?: unknown } | undefined;
    if (nest && typeof nest === 'object' && (typeof nest.message === 'string' || Array.isArray(nest.message))) {
      return {
        error: true,
        status: err.response?.status ?? 0,
        message: Array.isArray(nest.message) ? nest.message.join('; ') : (nest.message as string),
        details: body,
      };
    }
    return {
      error: true,
      status: err.response?.status ?? 0,
      message:
        err.response?.status === 404 && !envelope
          ? 'Endpoint not found: is the Satvolt public API (or the API v2 gateway) deployed on this server?'
          : err.response?.statusText || err.message,
      details: body,
    };
  }
  return handleApiError(err);
}

/**
 * Reads a JSON argument: inline JSON, `@path/to/file.json`, or `-` for stdin.
 */
export function readJsonArg(value: string, label: string): any {
  let raw: string;
  if (value === '-') {
    raw = readFileSync(0, 'utf-8');
  } else if (value.startsWith('@')) {
    raw = readFileSync(value.slice(1), 'utf-8');
  } else {
    raw = value;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${label} is not valid JSON: ${(err as Error).message}`);
  }
}

export function parseId(value: string, label = 'id'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${label} must be a positive integer, got "${value}"`);
  }
  return n;
}

export function parseIntOption(value: string | undefined, label: string): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${label} must be a non-negative integer`);
  return n;
}

/** "lat,lng" → [lat, lng] */
export function parseLatLng(value: string, label: string): [number, number] {
  const parts = value.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`${label} must be "lat,lng", got "${value}"`);
  }
  return [parts[0], parts[1]];
}
