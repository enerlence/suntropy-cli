import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface SuntropyProfile {
  server: string;
  token?: string;
  /**
   * How the stored token was obtained:
   * - `login`: user session JWT from `auth login` (email + password);
   * - `api-key`: legacy security API key (a JWT) from `auth set-key`;
   * - `api-key-v2`: API v2 key (`sun_…`) issued by the API gateway, from
   *   `auth login --web` or `auth set-key sun_…`. It only works against the
   *   gateway (`/api/v2`), never against the internal service routes.
   */
  authMethod?: 'api-key' | 'login' | 'api-key-v2';
  email?: string;
  clientUID?: string;
  userUID?: string;
  /** API v2 key id and label (only for `api-key-v2`). */
  keyId?: string;
  keyLabel?: string;
  /**
   * API gateway origin for this profile (API v2 and `/api-gateway`). Optional:
   * derived from `server` for prod and dev; set it for local or custom servers
   * (`suntropy config set gatewayUrl http://localhost:8087`).
   */
  gatewayUrl?: string;
}

export interface SuntropyConfig {
  activeProfile: string;
  profiles: Record<string, SuntropyProfile>;
  /**
   * Command access profile (permission tier). Gates which commands are
   * registered/visible. Cumulative: read ⊂ write ⊂ delete. Absent → 'delete'
   * (full access, preserves legacy behavior). Managed via the hidden
   * `command-profile` admin command or the SUNTROPY_COMMAND_PROFILE env var.
   */
  commandProfile?: 'read' | 'write' | 'delete';
}

const CONFIG_DIR = join(homedir(), '.suntropy');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: SuntropyConfig = {
  activeProfile: 'default',
  profiles: {
    default: {
      server: 'https://api.enerlence.com',
    },
  },
};

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): SuntropyConfig {
  ensureConfigDir();
  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));
    return { ...DEFAULT_CONFIG };
  }
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
}

export function saveConfig(config: SuntropyConfig): void {
  ensureConfigDir();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

export function getActiveProfile(config: SuntropyConfig, profileOverride?: string): SuntropyProfile {
  const name = profileOverride || config.activeProfile;
  const profile = config.profiles[name];
  if (!profile) {
    throw new Error(`Profile "${name}" not found. Available: ${Object.keys(config.profiles).join(', ')}`);
  }
  return profile;
}

export function setConfigValue(key: string, value: string, profileName?: string): void {
  const config = loadConfig();
  const name = profileName || config.activeProfile;
  if (!config.profiles[name]) {
    config.profiles[name] = { server: 'https://api.enerlence.com' };
  }
  const profile = config.profiles[name] as unknown as Record<string, unknown>;
  profile[key] = value;
  saveConfig(config);
}

export function getConfigValue(key: string, profileName?: string): unknown {
  const config = loadConfig();
  const profile = getActiveProfile(config, profileName);
  return (profile as unknown as Record<string, unknown>)[key];
}

/** Service path mapping */
const SERVICE_PATHS: Record<string, string> = {
  security: '/security',
  solar: '/solar',
  templates: '/templates',
  profiles: '/profiles',
  periods: '/periods',
  notifications: '/notifications',
  satvolt: '/satvolt',
  payments: '/payments',
};

const LOCAL_PORTS: Record<string, number> = {
  security: 8080,
  solar: 8086,
  templates: 8090,
  profiles: 8085,
  periods: 8084,
  notifications: 8093,
  satvolt: 8099,
  payments: 8098,
};

export function getServiceUrl(baseServer: string, service: keyof typeof SERVICE_PATHS): string {
  // If baseServer looks like localhost without path, use port-based routing
  if (baseServer.includes('localhost') || baseServer.match(/:\d+$/)) {
    const port = LOCAL_PORTS[service];
    const host = baseServer.replace(/:\d+$/, '').replace(/\/$/, '');
    return `${host}:${port}`;
  }
  // Production: path-based routing
  return `${baseServer.replace(/\/$/, '')}${SERVICE_PATHS[service]}`;
}

// ─── API v2 (gateway) ─────────────────────────────────────────────────────

/** API v2 keys issued by the gateway start with this prefix. */
export const V2_KEY_PREFIX = 'sun_';

export function isV2Key(token: string | undefined | null): boolean {
  return typeof token === 'string' && token.startsWith(V2_KEY_PREFIX);
}

/** Gateway origins by environment. */
export const PROD_GATEWAY_URL = 'https://api.suntropy.ai';
export const DEV_GATEWAY_URL = 'https://api-dev.enerlence.com';

const PROD_SERVER_HOSTS = new Set(['api.enerlence.com', 'api.suntropy.ai']);
const DEV_SERVER_HOSTS = new Set(['api-dev.enerlence.com', 'api-dev.suntropy.domain.eu.axebow.cloud']);

export const GATEWAY_ENV_VAR = 'SUNTROPY_GATEWAY_URL';

export interface ResolvedGateway {
  url: string;
  source: 'env' | 'profile' | 'prod' | 'dev';
}

/**
 * Resolves the API gateway origin (where `/api/v2` and `/api-gateway` live).
 * Precedence: `SUNTROPY_GATEWAY_URL` > the profile's `gatewayUrl` > derived
 * from the API server (prod `api.enerlence.com` → `https://api.suntropy.ai`,
 * dev → `https://api-dev.enerlence.com`). Any other server (localhost, a
 * custom host) needs one of the first two: there is no safe guess.
 */
export function resolveGatewayUrl(server: string | undefined, profileGatewayUrl?: string): ResolvedGateway {
  const strip = (u: string) => u.trim().replace(/\/+$/, '');
  const env = process.env[GATEWAY_ENV_VAR]?.trim();
  if (env) return { url: strip(env), source: 'env' };
  if (profileGatewayUrl?.trim()) return { url: strip(profileGatewayUrl), source: 'profile' };
  let host = '';
  try {
    host = new URL(server ?? '').hostname.toLowerCase();
  } catch {
    // not a URL: falls through to the error
  }
  if (PROD_SERVER_HOSTS.has(host)) return { url: PROD_GATEWAY_URL, source: 'prod' };
  if (DEV_SERVER_HOSTS.has(host)) return { url: DEV_GATEWAY_URL, source: 'dev' };
  throw new Error(
    `No API gateway known for server "${server ?? ''}". Set ${GATEWAY_ENV_VAR}=<url> ` +
      `or run: suntropy config set gatewayUrl <url> (e.g. http://localhost:8087 for a local gateway).`,
  );
}
