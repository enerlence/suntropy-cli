import {
  loadConfig,
  saveConfig,
  type ConnectCredentials,
  type SuntropyConfig,
  type SuntropyProfile,
} from '../config.js';

/**
 * Cliente del gateway de Suntropy Connect (https://connect-gateway.suntropy.ai).
 *
 * El gateway es su propio servidor OAuth: emite tokens `pvo_…` con refresh
 * rotatorio para el MCP de monitorización. No tiene nada que ver con el JWT de
 * la API de Suntropy (`auth set-key`), así que las credenciales se guardan
 * aparte, en `profiles.<perfil>.connect` de ~/.suntropy/config.json.
 *
 * Nunca se escriben tokens ni credenciales de fabricantes en stdout, stderr ni
 * en el modo `--verbose`: sólo método, URL y código de estado.
 */

export const DEFAULT_GATEWAY = 'https://connect-gateway.suntropy.ai';
export const CLIENT_ID = 'suntropy-cli';
export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
export const MCP_PROTOCOL_VERSION = '2026-07-28';
export const MONITORING_MCP_PATH = '/monitoring/mcp';

/** Variable de entorno con un access token ya emitido (sin refresco). */
export const ENV_TOKEN = 'SUNTROPY_CONNECT_TOKEN';
/** Variable de entorno para apuntar a otro gateway (pruebas). */
export const ENV_GATEWAY = 'SUNTROPY_CONNECT_GATEWAY';

export interface GatewayContext {
  /** Perfil de la CLI (global `--profile` o el activo). */
  profileName: string;
  /** Raíz del gateway, sin barra final. */
  gateway: string;
  verbose: boolean;
}

/** Un fallo con un código estable para que el agente sepa qué hacer. */
export class ConnectError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status?: number,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function normalizeGateway(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export function resolveGateway(explicit?: string, stored?: string): string {
  return normalizeGateway(explicit || process.env[ENV_GATEWAY] || stored || DEFAULT_GATEWAY);
}

// ─── Perfil ───────────────────────────────────────────────────────────────

export function profileNameOf(config: SuntropyConfig, override?: string): string {
  return override || config.activeProfile;
}

function ensureProfile(config: SuntropyConfig, name: string): SuntropyProfile {
  if (!config.profiles[name]) config.profiles[name] = { server: 'https://api.enerlence.com' };
  return config.profiles[name];
}

export function readCredentials(profileName: string): ConnectCredentials | undefined {
  const config = loadConfig();
  return config.profiles[profileName]?.connect;
}

/** Modifica y guarda las credenciales de Connect de un perfil. */
export function updateCredentials(
  profileName: string,
  gateway: string,
  mutate: (c: ConnectCredentials) => ConnectCredentials | undefined,
): ConnectCredentials | undefined {
  const config = loadConfig();
  const profile = ensureProfile(config, profileName);
  const current: ConnectCredentials = profile.connect ?? { gateway, clientId: CLIENT_ID };
  const next = mutate({ ...current });
  if (next) profile.connect = next;
  else delete profile.connect;
  saveConfig(config);
  return next;
}

// ─── HTTP ─────────────────────────────────────────────────────────────────

export interface GatewayResponse {
  status: number;
  data: any;
  headers: Headers;
}

export async function gatewayRequest(
  ctx: GatewayContext,
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: unknown; token?: string; headers?: Record<string, string> } = {},
): Promise<GatewayResponse> {
  const url = `${ctx.gateway}${path}`;
  const headers: Record<string, string> = { accept: 'application/json', ...(opts.headers ?? {}) };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
  if (ctx.verbose) process.stderr.write(`→ ${method} ${url}\n`);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new ConnectError(
      `No se pudo contactar con el gateway de Suntropy Connect (${ctx.gateway}): ${(err as Error).message}`,
      'network_error',
    );
  }
  const text = await res.text();
  let data: any = text;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('text/event-stream')) {
    data = parseSse(text);
  } else if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // se queda como texto
    }
  }
  if (ctx.verbose) process.stderr.write(`← ${res.status}\n`);
  return { status: res.status, data, headers: res.headers };
}

/** Último mensaje JSON-RPC de una respuesta en SSE. */
function parseSse(text: string): unknown {
  let last: unknown = null;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    try {
      const msg = JSON.parse(data);
      if (msg && typeof msg === 'object' && ('result' in msg || 'error' in msg)) last = msg;
    } catch {
      // ignorar
    }
  }
  return last;
}

/** Mensaje legible de una respuesta de error del gateway (OAuth o REST). */
export function errorText(data: any, fallback: string): string {
  if (data && typeof data === 'object') {
    return String(data.error_description ?? data.message ?? data.error ?? fallback);
  }
  return typeof data === 'string' && data ? data.slice(0, 300) : fallback;
}

// ─── Tokens ───────────────────────────────────────────────────────────────

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

export function credentialsFromToken(
  base: ConnectCredentials,
  tok: TokenResponse,
  extra: Partial<ConnectCredentials> = {},
): ConnectCredentials {
  const now = Date.now();
  return {
    ...base,
    ...extra,
    accessToken: tok.access_token,
    refreshToken: tok.refresh_token ?? base.refreshToken,
    expiresAt: tok.expires_in ? new Date(now + tok.expires_in * 1000).toISOString() : undefined,
    scope: tok.scope ?? base.scope,
    obtainedAt: new Date(now).toISOString(),
  };
}

const NOT_LOGGED_IN =
  'No hay sesión de Suntropy Connect. Ejecuta `suntropy connect login` (o `suntropy connect login --email <correo>`).';

/**
 * Devuelve un access token válido: el de `SUNTROPY_CONNECT_TOKEN`, o el guardado,
 * renovado con el refresh si caduca en menos de un minuto (el refresh rota: se
 * guarda el nuevo en el acto).
 */
export async function getAccessToken(ctx: GatewayContext, opts: { forceRefresh?: boolean } = {}): Promise<string> {
  const fromEnv = process.env[ENV_TOKEN];
  if (fromEnv && !opts.forceRefresh) return fromEnv;
  const creds = readCredentials(ctx.profileName);
  if (!creds?.accessToken) throw new ConnectError(NOT_LOGGED_IN, 'not_logged_in');
  const expiresAt = creds.expiresAt ? Date.parse(creds.expiresAt) : Infinity;
  if (!opts.forceRefresh && expiresAt - Date.now() > 60_000) return creds.accessToken;
  if (!creds.refreshToken) {
    if (opts.forceRefresh || expiresAt <= Date.now()) {
      throw new ConnectError('La sesión de Suntropy Connect ha caducado. ' + NOT_LOGGED_IN, 'session_expired');
    }
    return creds.accessToken;
  }
  return refresh(ctx, creds);
}

async function refresh(ctx: GatewayContext, creds: ConnectCredentials): Promise<string> {
  const gw = { ...ctx, gateway: normalizeGateway(creds.gateway || ctx.gateway) };
  const r = await gatewayRequest(gw, 'POST', '/token', {
    body: { grant_type: 'refresh_token', refresh_token: creds.refreshToken, client_id: creds.clientId || CLIENT_ID },
  });
  if (r.status !== 200 || !r.data?.access_token) {
    if (r.status === 400 && r.data?.error === 'invalid_grant') {
      // Revocado desde el panel o ya usado: la sesión no sirve.
      updateCredentials(ctx.profileName, gw.gateway, (c) => {
        delete c.accessToken;
        delete c.refreshToken;
        delete c.expiresAt;
        return c;
      });
      throw new ConnectError(
        `${errorText(r.data, 'La sesión no es válida')} ${NOT_LOGGED_IN}`,
        'session_expired',
        r.status,
      );
    }
    throw new ConnectError(`No se pudo renovar la sesión: ${errorText(r.data, `HTTP ${r.status}`)}`, 'refresh_failed', r.status);
  }
  const next = updateCredentials(ctx.profileName, gw.gateway, (c) => credentialsFromToken(c, r.data as TokenResponse));
  return next!.accessToken!;
}

/** Errores de licencia y permisos comunes al REST y al MCP. */
function authFailure(r: GatewayResponse): ConnectError | null {
  if (r.status === 402) {
    const d = r.data ?? {};
    return new ConnectError(
      `${errorText(d, 'Sin licencia de Suntropy Connect.')} La cuenta necesita la licencia de Suntropy Connect ` +
        '(o la prueba de 7 días): se activa en https://app.suntropy.ai, Configuración > Suntropy Connect.',
      'licence_inactive',
      402,
      { ...(d.trialEligible !== undefined ? { trialEligible: d.trialEligible } : {}) },
    );
  }
  return null;
}

/**
 * Petición autenticada al gateway: añade el Bearer, y ante un 401 renueva el
 * token una vez y repite.
 */
export async function authedRequest(
  ctx: GatewayContext,
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: unknown; headers?: Record<string, string> } = {},
): Promise<GatewayResponse> {
  let token = await getAccessToken(ctx);
  let r = await gatewayRequest(ctx, method, path, { ...opts, token });
  if (r.status === 401 && !process.env[ENV_TOKEN]) {
    token = await getAccessToken(ctx, { forceRefresh: true });
    r = await gatewayRequest(ctx, method, path, { ...opts, token });
  }
  if (r.status === 401) {
    throw new ConnectError(`${errorText(r.data, 'No autorizado.')} ${NOT_LOGGED_IN}`, 'unauthorized', 401);
  }
  const lic = authFailure(r);
  if (lic) throw lic;
  return r;
}

// ─── MCP ──────────────────────────────────────────────────────────────────

let rpcId = 0;

/**
 * Una petición JSON-RPC al MCP de monitorización con el transporte Streamable
 * HTTP de la revisión 2026-07-28 (sin estado: sin `initialize`, con cabeceras
 * espejo `Mcp-Method`/`Mcp-Name` y la versión en `_meta`).
 */
export async function mcpRequest(
  ctx: GatewayContext,
  method: string,
  params: Record<string, unknown> = {},
  mcpPath = MONITORING_MCP_PATH,
): Promise<any> {
  const id = ++rpcId;
  const headers: Record<string, string> = {
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': MCP_PROTOCOL_VERSION,
    'mcp-method': method,
  };
  const name = params['name'];
  if (method === 'tools/call' && typeof name === 'string') headers['mcp-name'] = name;
  const body = {
    jsonrpc: '2.0',
    id,
    method,
    params: {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
        'io.modelcontextprotocol/clientCapabilities': {},
        'io.modelcontextprotocol/clientInfo': { name: CLIENT_ID, version: '1' },
      },
    },
  };
  const r = await authedRequest(ctx, 'POST', mcpPath, { body, headers });
  const msg = r.data;
  if (r.status === 403) {
    throw new ConnectError(errorText(msg, 'Sin permiso.'), String(msg?.error ?? 'forbidden'), 403);
  }
  if (!msg || typeof msg !== 'object') {
    throw new ConnectError(`Respuesta inesperada del MCP (HTTP ${r.status}).`, 'bad_response', r.status);
  }
  if (msg.error) {
    const e = msg.error;
    const text = String(e.message ?? '');
    // Herramienta que este gateway aún no tiene (p. ej. una versión anterior).
    const code = /herramienta desconocida|unknown tool/i.test(text)
      ? 'tool_not_available'
      : e.code === -32601
        ? 'method_not_found'
        : 'mcp_error';
    throw new ConnectError(String(e.message ?? 'Error del MCP'), code, r.status, e.data ? { data: e.data } : {});
  }
  if (r.status >= 400) {
    throw new ConnectError(errorText(msg, `HTTP ${r.status}`), String(msg.error ?? 'http_error'), r.status);
  }
  return msg.result;
}

/** Llama a una herramienta y devuelve su `structuredContent` (o el texto, parseado si es JSON). */
export async function callTool(
  ctx: GatewayContext,
  name: string,
  args: Record<string, unknown> = {},
  mcpPath = MONITORING_MCP_PATH,
): Promise<unknown> {
  const result = await mcpRequest(ctx, 'tools/call', { name, arguments: args }, mcpPath);
  const text = Array.isArray(result?.content)
    ? result.content
        .filter((c: any) => c?.type === 'text')
        .map((c: any) => String(c.text))
        .join('\n')
    : '';
  if (result?.isError) {
    throw new ConnectError(
      text || `La herramienta ${name} ha fallado.`,
      'tool_error',
      undefined,
      { tool: name },
    );
  }
  if (result?.structuredContent !== undefined) return result.structuredContent;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
