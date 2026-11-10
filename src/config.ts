import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface SuntropyProfile {
  server: string;
  token?: string;
  authMethod?: 'api-key' | 'login';
  email?: string;
  clientUID?: string;
  userUID?: string;
  /** Sesión de Suntropy Connect (gateway OAuth, independiente del JWT de la API). */
  connect?: ConnectCredentials;
}

/**
 * Credenciales de Suntropy Connect guardadas por `suntropy connect login`.
 * Son tokens del gateway (`pvo_…` + refresh rotatorio), no el JWT de la API de
 * Suntropy: por eso van aparte de `token`.
 */
export interface ConnectCredentials {
  gateway: string;
  clientId: string;
  accessToken?: string;
  refreshToken?: string;
  /** ISO. Cuándo caduca el access token. */
  expiresAt?: string;
  scope?: string;
  email?: string;
  obtainedAt?: string;
  /** Login a medias: el device_code espera aprobación o el código del correo. */
  pending?: ConnectPendingLogin;
}

export interface ConnectPendingLogin {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  /** ISO. Caducidad del device_code (30 min). */
  expiresAt: string;
  interval: number;
  email?: string;
  /** ISO. Caducidad del código enviado por correo (15 min). */
  emailCodeExpiresAt?: string;
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
  // Guarda tokens: sólo legible por el usuario.
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  try {
    chmodSync(CONFIG_FILE, 0o600);
  } catch {
    // En sistemas sin permisos POSIX no pasa nada.
  }
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
};

const LOCAL_PORTS: Record<string, number> = {
  security: 8080,
  solar: 8086,
  templates: 8090,
  profiles: 8085,
  periods: 8084,
  notifications: 8093,
  satvolt: 8099,
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
