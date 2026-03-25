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
  const token = opts.token || profile.token;
  if (!token) {
    throw new Error('Not authenticated. Run: suntropy auth set-key --key <jwt> or suntropy auth login');
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
