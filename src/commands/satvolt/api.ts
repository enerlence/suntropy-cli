import axios, { AxiosInstance } from 'axios';
import { readFileSync } from 'fs';
import type { Command } from 'commander';
import { createServiceClient, type ApiError } from '../../client.js';
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

/**
 * Client for the Satvolt public API (`/api/v1` on the satvolt service:
 * `<server>/satvolt/api/v1` in production, `localhost:8099/api/v1` locally).
 */
export function satvoltClient(global: GlobalOpts, timeout = 60000): AxiosInstance {
  const client = createServiceClient('satvolt', global);
  client.defaults.baseURL = `${client.defaults.baseURL}/api/v1`;
  client.defaults.timeout = timeout;
  return client;
}

/** Envelope returned by every JSON endpoint of the public API. */
interface Envelope<T> {
  code?: number;
  data?: T;
  error?: { code?: string; message?: string; details?: unknown };
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
    if (envelope?.error) {
      return {
        error: true,
        status: err.response?.status ?? 0,
        code: envelope.error.code,
        message: envelope.error.message || envelope.error.code || 'Request failed',
        details: envelope.error.details,
      };
    }
    return {
      error: true,
      status: err.response?.status ?? 0,
      message:
        err.response?.status === 404 && !envelope
          ? 'Endpoint not found: is the Satvolt public API deployed on this server?'
          : err.response?.statusText || err.message,
      details: body,
    };
  }
  return { error: true, status: 0, message: err instanceof Error ? err.message : String(err) };
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
