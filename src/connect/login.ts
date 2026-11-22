import type { ConnectPendingLogin } from '../config.js';
import {
  CLIENT_ID,
  ConnectError,
  DEVICE_GRANT,
  credentialsFromToken,
  errorText,
  gatewayRequest,
  readCredentials,
  updateCredentials,
  type GatewayContext,
  type TokenResponse,
} from './gateway.js';
import { sleep } from './prompt.js';

/**
 * Login en Suntropy Connect sin contraseña, en dos variantes sobre el mismo
 * `device_code` (RFC 8628):
 *
 * - **Enlace y código**: el usuario abre `verification_uri_complete` con su
 *   sesión de Suntropy (o se da de alta allí) y aprueba; la CLI sondea `/token`.
 * - **Código por correo**: el gateway manda un código de 6 dígitos al correo del
 *   usuario (alta sin contraseña si no tiene cuenta), el usuario se lo dicta al
 *   agente y la CLI lo verifica; el gateway aprueba el `device_code` y la CLI lo
 *   canjea en `/token`.
 *
 * Entre invocaciones, el login a medias se guarda en el perfil (`connect.pending`)
 * para que un agente sin stdin pueda hacerlo en dos pasos (`--email`, luego `--code`).
 */

export interface Notice {
  (line: string): void;
}

function pendingValid(p: ConnectPendingLogin | undefined): p is ConnectPendingLogin {
  return Boolean(p && Date.parse(p.expiresAt) - Date.now() > 30_000);
}

export function getPending(ctx: GatewayContext): ConnectPendingLogin | undefined {
  const p = readCredentials(ctx.profileName)?.pending;
  return pendingValid(p) ? p : undefined;
}

function savePending(ctx: GatewayContext, pending: ConnectPendingLogin | undefined): void {
  updateCredentials(ctx.profileName, ctx.gateway, (c) => {
    c.gateway = ctx.gateway;
    if (pending) c.pending = pending;
    else delete c.pending;
    return c;
  });
}

export function clearPending(ctx: GatewayContext): void {
  savePending(ctx, undefined);
}

/** Pide un `device_code` nuevo y lo guarda como login pendiente. */
export async function startDevice(ctx: GatewayContext, resource?: string): Promise<ConnectPendingLogin> {
  const r = await gatewayRequest(ctx, 'POST', '/device_authorization', {
    body: { client_id: CLIENT_ID, ...(resource ? { resource } : {}) },
  });
  if (r.status !== 200 || !r.data?.device_code) {
    throw new ConnectError(
      `No se pudo empezar el login: ${errorText(r.data, `HTTP ${r.status}`)}`,
      String(r.data?.error ?? 'device_authorization_failed'),
      r.status,
    );
  }
  const d = r.data;
  const pending: ConnectPendingLogin = {
    deviceCode: d.device_code,
    userCode: d.user_code,
    verificationUri: d.verification_uri,
    verificationUriComplete: d.verification_uri_complete ?? d.verification_uri,
    expiresAt: new Date(Date.now() + Number(d.expires_in ?? 1800) * 1000).toISOString(),
    interval: Number(d.interval ?? 5),
  };
  savePending(ctx, pending);
  return pending;
}

export async function getOrStartDevice(ctx: GatewayContext, resource?: string): Promise<ConnectPendingLogin> {
  return getPending(ctx) ?? startDevice(ctx, resource);
}

export interface LoginResult {
  authenticated: boolean;
  status: 'authenticated' | 'pending' | 'code_sent';
  [k: string]: unknown;
}

function successResult(ctx: GatewayContext): LoginResult {
  const c = readCredentials(ctx.profileName);
  const scope = c?.scope ?? '';
  return {
    authenticated: true,
    status: 'authenticated',
    profile: ctx.profileName,
    gateway: ctx.gateway,
    ...(c?.email ? { email: c.email } : {}),
    scope,
    canAddConnectionsDirectly: scope.split(/\s+/).includes('connections:write'),
    expiresAt: c?.expiresAt,
    next: 'suntropy connect summary',
  };
}

export function pendingResult(ctx: GatewayContext, p: ConnectPendingLogin): LoginResult {
  return {
    authenticated: false,
    status: 'pending',
    profile: ctx.profileName,
    userCode: p.userCode,
    verificationUriComplete: p.verificationUriComplete,
    expiresAt: p.expiresAt,
    message:
      `Pide al usuario que abra ${p.verificationUriComplete} (inicia sesión o crea la cuenta en Suntropy) ` +
      `y apruebe el acceso comprobando que el código es ${p.userCode}.`,
    next: 'suntropy connect login --continue',
  };
}

/**
 * Sondea `/token` respetando `interval` (y `slow_down`) hasta que el usuario
 * aprueba, deniega, caduca el código o se acaba `timeoutMs`.
 */
export async function pollToken(
  ctx: GatewayContext,
  pending: ConnectPendingLogin,
  timeoutMs: number,
  extra: { email?: string } = {},
): Promise<LoginResult> {
  const deadline = Math.min(Date.now() + timeoutMs, Date.parse(pending.expiresAt));
  let interval = Math.max(1, pending.interval || 5);
  for (;;) {
    const r = await gatewayRequest(ctx, 'POST', '/token', {
      body: { grant_type: DEVICE_GRANT, device_code: pending.deviceCode, client_id: CLIENT_ID },
    });
    if (r.status === 200 && r.data?.access_token) {
      updateCredentials(ctx.profileName, ctx.gateway, (c) => {
        const next = credentialsFromToken({ ...c, gateway: ctx.gateway, clientId: CLIENT_ID }, r.data as TokenResponse, {
          ...(extra.email || pending.email ? { email: extra.email ?? pending.email } : {}),
        });
        delete next.pending;
        return next;
      });
      return successResult(ctx);
    }
    const err = String(r.data?.error ?? '');
    if (err === 'authorization_pending') {
      // sigue esperando
    } else if (err === 'slow_down') {
      interval = Math.max(interval + 5, Number(r.data?.interval) || 0);
    } else {
      if (['access_denied', 'expired_token', 'invalid_grant'].includes(err)) clearPending(ctx);
      const msg =
        err === 'access_denied'
          ? 'El usuario ha denegado el acceso en Suntropy.'
          : err === 'expired_token'
            ? 'El código de login ha caducado (30 min). Vuelve a ejecutar `suntropy connect login`.'
            : `No se pudo completar el login: ${errorText(r.data, `HTTP ${r.status}`)}`;
      throw new ConnectError(msg, err || 'token_failed', r.status);
    }
    if (Date.now() + interval * 1000 > deadline) {
      if (Date.now() >= Date.parse(pending.expiresAt) - 1000) {
        clearPending(ctx);
        throw new ConnectError(
          'El código de login ha caducado (30 min). Vuelve a ejecutar `suntropy connect login`.',
          'expired_token',
        );
      }
      return pendingResult(ctx, pending);
    }
    await sleep(interval * 1000);
  }
}

export interface EmailOptions {
  email: string;
  utm?: Record<string, string | undefined>;
  resource?: string;
}

/**
 * Pide al gateway que mande el código al correo. Reutiliza el `device_code`
 * pendiente (pedir otro correo con el mismo invalida el código anterior; hay 3
 * correos por `device_code`); si ha caducado, empieza otro.
 */
export async function sendEmailCode(ctx: GatewayContext, opts: EmailOptions): Promise<ConnectPendingLogin> {
  let pending = await getOrStartDevice(ctx, opts.resource);
  for (let attempt = 0; attempt < 2; attempt++) {
    const utm = Object.fromEntries(Object.entries(opts.utm ?? {}).filter(([, v]) => v));
    const r = await gatewayRequest(ctx, 'POST', '/device_authorization/email', {
      body: { device_code: pending.deviceCode, client_id: CLIENT_ID, email: opts.email, ...utm },
    });
    if (r.status === 202 || r.status === 200) {
      pending = {
        ...pending,
        email: opts.email,
        emailCodeExpiresAt: new Date(Date.now() + Number(r.data?.expires_in ?? 900) * 1000).toISOString(),
      };
      savePending(ctx, pending);
      return pending;
    }
    const err = String(r.data?.error ?? '');
    if ((err === 'invalid_grant' || err === 'expired_token' || err === 'already_decided') && attempt === 0) {
      // El device_code guardado ya no vale: uno nuevo y se repite.
      pending = await startDevice(ctx, opts.resource);
      continue;
    }
    if (err === 'invalid_email') {
      throw new ConnectError(errorText(r.data, 'Correo no válido.'), 'invalid_email', r.status);
    }
    if (r.status === 429) {
      throw new ConnectError(
        `${errorText(r.data, 'Demasiados correos.')} Se pueden pedir 3 correos por login y 3 por dirección y hora: ` +
          'espera unos minutos, o usa el enlace (`suntropy connect login` sin --email).',
        'rate_limited',
        429,
        { retryAfter: r.headers.get('retry-after') ?? undefined },
      );
    }
    throw new ConnectError(
      `No se pudo enviar el código: ${errorText(r.data, `HTTP ${r.status}`)}`,
      err || 'email_failed',
      r.status,
    );
  }
  throw new ConnectError('No se pudo enviar el código.', 'email_failed');
}

/**
 * Verifica el código de 6 dígitos que el usuario ha recibido. Si es bueno, el
 * gateway aprueba el `device_code` y aquí mismo se canjea por los tokens.
 */
export async function verifyEmailCode(ctx: GatewayContext, code: string, timeoutMs: number): Promise<LoginResult> {
  const pending = getPending(ctx);
  if (!pending) {
    throw new ConnectError(
      'No hay ningún login pendiente (o ha caducado). Empieza con `suntropy connect login --email <correo>`.',
      'no_pending_login',
    );
  }
  if (!pending.email) {
    throw new ConnectError(
      'Este login no ha pedido código por correo. Usa `suntropy connect login --email <correo>` o `--continue`.',
      'no_email_code',
    );
  }
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) {
    throw new ConnectError('El código son 6 dígitos (el que ha llegado al correo).', 'invalid_code');
  }
  const r = await gatewayRequest(ctx, 'POST', '/device_authorization/email/verify', {
    body: { device_code: pending.deviceCode, client_id: CLIENT_ID, code: clean },
  });
  if (r.status === 200 && r.data?.approved) {
    const result = await pollToken(ctx, pending, Math.max(timeoutMs, 30_000), { email: pending.email });
    if (r.data.trial) result.trial = r.data.trial;
    return result;
  }
  const err = String(r.data?.error ?? '');
  if (err === 'invalid_code') {
    const left = r.data?.attempts_left;
    throw new ConnectError(
      `Código incorrecto.${left !== undefined ? ` Quedan ${left} intentos.` : ''} Compruébalo con el usuario.`,
      'invalid_code',
      r.status,
      left !== undefined ? { attemptsLeft: left } : {},
    );
  }
  if (err === 'too_many_attempts') {
    savePending(ctx, { ...pending, email: undefined, emailCodeExpiresAt: undefined });
    throw new ConnectError(
      `Demasiados intentos: el código ya no vale. Pide otro con \`suntropy connect login --email ${pending.email}\`.`,
      'too_many_attempts',
      r.status,
    );
  }
  if (err === 'expired_token' || r.status === 410) {
    if (Date.parse(pending.expiresAt) <= Date.now()) clearPending(ctx);
    else savePending(ctx, { ...pending, email: undefined, emailCodeExpiresAt: undefined });
    throw new ConnectError(
      `El código ha caducado (15 min). Pide otro con \`suntropy connect login --email ${pending.email}\`.`,
      'expired_token',
      r.status,
    );
  }
  if (err === 'licence_inactive' || r.status === 402) {
    const url = r.data?.verification_uri_complete ?? pending.verificationUriComplete;
    throw new ConnectError(
      'El código es correcto, pero la cuenta no tiene licencia de Suntropy Connect activa' +
        (r.data?.trialEligible ? ' (puede empezar la prueba gratuita de 7 días)' : '') +
        `. Pide al usuario que abra ${url} en el navegador, ` +
        (r.data?.trialEligible ? 'empiece la prueba de 7 días' : 'active o contrate la licencia') +
        ' y apruebe el acceso allí. Después ejecuta `suntropy connect login --continue`.',
      'licence_inactive',
      402,
      { trialEligible: r.data?.trialEligible ?? null, verificationUriComplete: url, next: 'suntropy connect login --continue' },
    );
  }
  if (err === 'invalid_grant') clearPending(ctx);
  throw new ConnectError(`No se pudo verificar el código: ${errorText(r.data, `HTTP ${r.status}`)}`, err || 'verify_failed', r.status);
}
