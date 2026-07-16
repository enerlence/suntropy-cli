import axios, { AxiosInstance, AxiosError } from 'axios';
import { loadConfig, getActiveProfile, getServiceUrl, type SuntropyProfile } from './config.js';

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
  details?: unknown;
}

function resolveAuth(opts: ClientOptions): { server: string; token: string } {
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
  return { server, token };
}

export function createServiceClient(service: 'security' | 'solar' | 'templates' | 'profiles' | 'periods', opts: ClientOptions): AxiosInstance {
  const { server, token } = resolveAuth(opts);
  const baseURL = getServiceUrl(server, service);

  const client = axios.create({
    baseURL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  if (opts.verbose) {
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
    return {
      error: true,
      status: ae.response?.status || 0,
      message: ae.response?.statusText || ae.message,
      details: ae.response?.data,
    };
  }
  return {
    error: true,
    status: 0,
    message: err instanceof Error ? err.message : String(err),
  };
}
