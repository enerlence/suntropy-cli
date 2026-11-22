import axios, { type AxiosInstance } from 'axios';
import { spawn } from 'child_process';
import { hostname } from 'os';

/**
 * Browser login (`suntropy auth login --web`): OAuth 2.0 device authorization
 * grant (RFC 8628) against the API gateway. The CLI asks for a code, the user
 * approves it in the Suntropy app with their own session, and the CLI receives
 * an API v2 key (`sun_…`) for that account. Nobody types or copies a secret.
 *
 *   POST <gateway>/api-gateway/device/code   → device_code, user_code, URLs
 *   POST <gateway>/api-gateway/device/token  → authorization_pending | slow_down
 *                                              | access_denied | expired_token
 *                                              | invalid_grant | 200 { api_key }
 */

export const DEVICE_CLIENT_ID = 'suntropy-cli';
export const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

/** RFC 8628 §3.5: on `slow_down` the interval grows by 5 seconds. */
export const SLOW_DOWN_STEP_SECONDS = 5;
/** Interval when the server does not send one (RFC 8628 default). */
export const DEFAULT_INTERVAL_SECONDS = 5;
/** Consecutive network failures tolerated while polling before giving up. */
const MAX_NETWORK_FAILURES = 3;

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval?: number;
}

export interface DeviceTokenResponse {
  token_type: string;
  api_key: string;
  key_id: string;
  label: string;
  client_uid: string;
  scopes: string[];
}

export type DeviceFlowFailure = 'denied' | 'expired' | 'error';

export class DeviceFlowError extends Error {
  constructor(readonly status: DeviceFlowFailure, message: string, readonly code?: string) {
    super(message);
  }
}

function gatewayHttp(gatewayUrl: string): AxiosInstance {
  return axios.create({
    baseURL: `${gatewayUrl.replace(/\/+$/, '')}/api-gateway`,
    timeout: 15000,
    headers: { 'Content-Type': 'application/json' },
    // Every answer of the device endpoints is meaningful (RFC errors are 400s).
    validateStatus: () => true,
  });
}

function rfcError(data: unknown): { error?: string; error_description?: string } {
  return data && typeof data === 'object' ? (data as { error?: string; error_description?: string }) : {};
}

/** Default device name: the hostname, printable characters only, max 40. */
export function defaultDeviceName(): string {
  const name = hostname().replace(/[^\x20-\x7e]/g, '').trim().slice(0, 40).trim();
  return name || 'CLI';
}

/** "a, b" → ["a", "b"]; undefined when nothing is given (gateway defaults). */
export function parseScopes(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const scopes = value.split(',').map((s) => s.trim()).filter(Boolean);
  return scopes.length ? scopes : undefined;
}

export async function requestDeviceCode(
  gatewayUrl: string,
  input: { deviceName?: string; scopes?: string[] },
): Promise<DeviceCodeResponse> {
  let res;
  try {
    res = await gatewayHttp(gatewayUrl).post('/device/code', {
      client_id: DEVICE_CLIENT_ID,
      ...(input.deviceName ? { device_name: input.deviceName } : {}),
      ...(input.scopes ? { scopes: input.scopes } : {}),
    });
  } catch (err) {
    throw new DeviceFlowError('error', `Could not reach the API gateway at ${gatewayUrl}: ${(err as Error).message}`);
  }
  const body = res.data as Partial<DeviceCodeResponse>;
  if (res.status === 200 && body?.device_code && body.user_code && body.verification_uri) {
    return body as DeviceCodeResponse;
  }
  const { error, error_description } = rfcError(res.data);
  if (error === 'invalid_scope') {
    throw new DeviceFlowError('error', `Unknown scope requested${error_description ? `: ${error_description}` : ''}. Check --scopes.`, error);
  }
  if (res.status === 404) {
    throw new DeviceFlowError('error', `The API gateway at ${gatewayUrl} does not support browser login yet (404 on /api-gateway/device/code).`);
  }
  if (res.status === 429) {
    throw new DeviceFlowError('error', 'Too many login attempts from this IP. Wait a few minutes and try again.', 'rate_limited');
  }
  throw new DeviceFlowError(
    'error',
    `The API gateway refused the login request (HTTP ${res.status}${error ? `, ${error}` : ''})${error_description ? `: ${error_description}` : ''}.`,
    error,
  );
}

export interface PollOptions {
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Called on every pending answer (e.g. to show progress). */
  onPending?: (info: { intervalSeconds: number; slowDown: boolean }) => void;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Polls `/device/token` until the user approves or denies, the code expires or
 * the gateway rejects it. Waits `interval` seconds between requests (before
 * the first one too) and adds 5 s on every `slow_down`.
 */
export async function pollDeviceToken(
  gatewayUrl: string,
  code: DeviceCodeResponse,
  options: PollOptions = {},
): Promise<DeviceTokenResponse> {
  const sleep = options.sleep ?? realSleep;
  const now = options.now ?? Date.now;
  const http = gatewayHttp(gatewayUrl);
  let interval = Number.isFinite(code.interval) && (code.interval as number) >= 0 ? (code.interval as number) : DEFAULT_INTERVAL_SECONDS;
  const deadline = now() + Math.max(0, code.expires_in) * 1000;
  let networkFailures = 0;

  for (;;) {
    await sleep(interval * 1000);
    if (now() > deadline) {
      throw new DeviceFlowError('expired', 'The login code expired before it was approved. Run `suntropy auth login --web` again.', 'expired_token');
    }
    let res;
    try {
      res = await http.post('/device/token', {
        grant_type: DEVICE_GRANT_TYPE,
        device_code: code.device_code,
        client_id: DEVICE_CLIENT_ID,
      });
      networkFailures = 0;
    } catch (err) {
      networkFailures++;
      if (networkFailures >= MAX_NETWORK_FAILURES) {
        throw new DeviceFlowError('error', `Lost contact with the API gateway while waiting for approval: ${(err as Error).message}`);
      }
      continue;
    }

    const body = res.data as Partial<DeviceTokenResponse>;
    if (res.status === 200 && typeof body?.api_key === 'string') return body as DeviceTokenResponse;

    const { error, error_description } = rfcError(res.data);
    switch (error) {
      case 'authorization_pending':
        options.onPending?.({ intervalSeconds: interval, slowDown: false });
        continue;
      case 'slow_down':
        interval += SLOW_DOWN_STEP_SECONDS;
        options.onPending?.({ intervalSeconds: interval, slowDown: true });
        continue;
      case 'access_denied':
        throw new DeviceFlowError('denied', 'The login request was rejected in the browser. Nothing was saved.', error);
      case 'expired_token':
        throw new DeviceFlowError('expired', 'The login code expired before it was approved. Run `suntropy auth login --web` again.', error);
      case 'invalid_grant':
        throw new DeviceFlowError(
          'error',
          'The login code is unknown or was already used (a key is handed out only once). Run `suntropy auth login --web` again.',
          error,
        );
      default:
        if (res.status === 429) {
          // Rate limited by IP: back off like a slow_down.
          interval += SLOW_DOWN_STEP_SECONDS;
          continue;
        }
        throw new DeviceFlowError(
          'error',
          `Unexpected answer from the API gateway (HTTP ${res.status}${error ? `, ${error}` : ''})${error_description ? `: ${error_description}` : ''}.`,
          error,
        );
    }
  }
}

// ─── Browser ──────────────────────────────────────────────────────────────

function isTruthyEnv(value: string | undefined): boolean {
  return !!value && !['0', 'false', 'no', ''].includes(value.trim().toLowerCase());
}

/**
 * Only try to open a browser where there is one: an interactive terminal on
 * macOS or Windows, or on Linux with a graphical session. Never in CI.
 */
export function canOpenBrowser(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  isTTY: boolean = !!process.stdout.isTTY,
): boolean {
  if (isTruthyEnv(env.CI)) return false;
  if (!isTTY) return false;
  if (platform === 'darwin' || platform === 'win32') return true;
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') {
    return !!(env.DISPLAY || env.WAYLAND_DISPLAY);
  }
  return false;
}

/** Best effort: never throws and never waits for the browser. */
export function openBrowser(url: string): void {
  try {
    const [cmd, args] =
      process.platform === 'darwin'
        ? ['open', [url]]
        : process.platform === 'win32'
          ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
          : ['xdg-open', [url]];
    const child = spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // no browser: the URL is printed anyway
  }
}
