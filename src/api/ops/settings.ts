/**
 * Projects, SolarForm, tenant settings, shares, templates and geocoding
 * (contract §3.1, §3.4, §3.5, dominio C; plus the three routes that already
 * had a v2 equivalent).
 */
import { CliError } from '../../client.js';
import { custom, operation, send, v1, v2 } from '../core.js';
import { numericId, omit, parseQueryString, tenantOf, v2All, type Json } from '../translate.js';

// ─── Theme (§3.1) ─────────────────────────────────────────────────────────

/** Fields of the theme the v2 does not take in a PATCH (read-only or internal). */
const THEME_READ_ONLY = ['idClientThemeConfig', 'customURL', 'client'];

export const THEME = {
  /**
   * v1 reads a client's theme by uid (`--client-uid`, the session's own by
   * default). v2 reads the key's own theme; a `--client-uid` that is not the
   * key's account fails before the request with `CLIENT_UID_MISMATCH`.
   */
  get: operation<{ clientUid?: string }, unknown>('config.theme.get', {
    v1: custom(async (ctx, i) => {
      const uid = i.clientUid ?? tenantOf(ctx);
      if (!uid) throw new Error('Pass --client-uid <uid>: the session does not say which account it belongs to.');
      return send(ctx, 'get', `/clients/config/clientThemeByClientUID/${encodeURIComponent(uid)}`);
    }, 'security'),
    v2: custom(async (ctx, i) => {
      if (i.clientUid) {
        const me = await send(ctx, 'get', '/me');
        if (me?.data?.clientUID !== i.clientUid) {
          throw new CliError(
            `--client-uid ${i.clientUid} is not the account of this API key (${me?.data?.clientUID}). ` +
              'An API v2 key only reads its own theme: drop --client-uid.',
            'CLIENT_UID_MISMATCH',
          );
        }
      }
      return (await send(ctx, 'get', '/settings/theme'))?.data;
    }),
  }),
  update: operation<{ payload: Json }, unknown>('config.theme.set', {
    v1: v1('post', '/clients/config/updateTheme', { service: 'security', body: (i) => i.payload }),
    v2: v2('patch', '/settings/theme', { body: (i) => omit(i.payload, THEME_READ_ONLY) }),
  }),
};

// ─── SolarForm configuration (§3.4, C10–C16) ──────────────────────────────

export const SOLARFORM_CONFIG = {
  /** C10: what the public form sees. */
  publicView: operation<void, unknown>('solarform.config', {
    v1: v1('get', '/solar-form/solar-form-config'),
    v2: v2('get', '/settings/solar-form/public-view'),
  }),
  /** C11 */
  get: operation<{ withParameters?: boolean }, unknown>('config.solarform.get', {
    v1: v1('get', '/solar-form/get-solar-form-config', { query: (i) => ({ getParameters: i.withParameters ? 'true' : undefined }) }),
    v2: v2('get', '/settings/solar-form', { query: (i) => ({ includeParameters: i.withParameters ? 'true' : undefined }) }),
  }),
  /** C12 */
  create: operation<{ payload: Json; withParameters?: boolean }, unknown>('config.solarform.create', {
    v1: v1('post', '/solar-form/solar-form-config', {
      query: (i) => ({ getParameters: i.withParameters ? 'true' : undefined }),
      body: (i) => i.payload,
    }),
    v2: v2('post', '/settings/solar-form', {
      query: (i) => ({ includeParameters: i.withParameters ? 'true' : undefined }),
      body: (i) => omit(i.payload, ['idSolarFormConfig', 'clientUID']),
    }),
  }),
  /** C13: v2 has one configuration per tenant; the id travels in the body as an identity check. */
  update: operation<{ id: string | number; payload: Json }, unknown>('config.solarform.update', {
    v1: v1('put', (i) => `/solar-form/solar-form-config/${i.id}`, { body: (i) => i.payload }),
    v2: v2('patch', '/settings/solar-form', {
      body: (i) => ({ ...omit(i.payload, ['clientUID']), idSolarFormConfig: numericId(i.id) }),
    }),
  }),
};

export const ADVANCED = {
  /** C14 */
  get: operation<void, Json>('config.solarform.advanced.get', {
    v1: v1('get', '/solar-form/config/advanced'),
    v2: v2('get', '/settings/solar-form/advanced'),
  }),
  /** C15: the whole merged object, as today. */
  put: operation<{ payload: Json }, unknown>('config.solarform.advanced.update', {
    v1: v1('put', '/solar-form/config/advanced', { body: (i) => i.payload }),
    v2: v2('patch', '/settings/solar-form/advanced', { body: (i) => i.payload }),
  }),
  /** C16: `{ success: true }` in both. */
  delete: operation<void, { success: true }>('config.solarform.advanced.delete', {
    v1: v1('delete', '/solar-form/config/advanced', { out: () => ({ success: true as const }) }),
    v2: v2('delete', '/settings/solar-form/advanced', { out: () => ({ success: true as const }) }),
  }),
  /** Excluded from v2 (§4): superadmin, acts on another tenant. */
  initDefault: operation<{ clientUid: string; email?: string; url?: string }, unknown>('config.solarform.advanced.init-default', {
    v1: v1('post', (i) => `/solar-form/config/default/advanced/${i.clientUid}`, {
      query: (i) => ({ email: i.email, url: i.url }),
      body: () => ({}),
      headers: (i) => ({ 'suntropy-auth': i.clientUid }),
    }),
  }),
};

// ─── SolarForm estimates and statistics (C8, C9, §4) ──────────────────────

export const SOLARFORM = {
  simple: operation<{ body: Json; query: Json }, unknown>('solarform.simple', {
    v1: v1('post', '/api/solar-form/simple', { query: (i) => i.query, body: (i) => i.body }),
    v2: v2('post', '/solar-form/estimates/simple', { query: (i) => i.query, body: (i) => i.body }),
  }),
  calculate: operation<{ body: Json; query: Json }, unknown>('solarform.calculate', {
    v1: v1('post', '/api/solar-form', { query: (i) => i.query, body: (i) => i.body }),
    v2: v2('post', '/solar-form/estimates', { query: (i) => i.query, body: (i) => i.body }),
  }),
  /** Excluded from v2 (§4): anonymous widget telemetry. */
  statisticsCreate: operation<{ body: Json; statsId?: string }, unknown>('solarform.statistics.create', {
    v1: v1('post', '/solar-form/solar-form-statistics', { query: (i) => ({ statsId: i.statsId }), body: (i) => i.body }),
  }),
  statisticsUpdate: operation<{ body: Json | undefined }, unknown>('solarform.statistics.update', {
    v1: v1('put', '/solar-form/solar-form-statistics', { body: (i) => i.body }),
  }),
};

// ─── Projects (C1–C7) ─────────────────────────────────────────────────────

const PROJECTS_V1 = '/api/alexandria-projects';

export const PROJECTS = {
  list: operation<void, unknown>('projects.list', {
    v1: v1('get', PROJECTS_V1),
    v2: custom((ctx) => v2All(ctx, '/projects')),
  }),
  get: operation<{ id: number }, Json>('projects.get', {
    v1: v1('get', (i) => `${PROJECTS_V1}/${i.id}`),
    v2: v2('get', (i) => `/projects/${i.id}`),
  }),
  create: operation<{ body: Json }, unknown>('projects.create', {
    v1: v1('post', PROJECTS_V1, { body: (i) => i.body }),
    v2: v2('post', '/projects', { body: (i) => i.body }),
  }),
  update: operation<{ id: number; body: Json }, unknown>('projects.update', {
    v1: v1('put', (i) => `${PROJECTS_V1}/${i.id}`, { body: (i) => i.body }),
    v2: v2('patch', (i) => `/projects/${i.id}`, { body: (i) => i.body }),
  }),
  delete: operation<{ id: number }, { deleted: true; id: number }>('projects.delete', {
    v1: v1('delete', (i) => `${PROJECTS_V1}/${i.id}`, { out: (_d, i) => ({ deleted: true as const, id: i.id }) }),
    v2: v2('delete', (i) => `/projects/${i.id}`, { out: (_d, i) => ({ deleted: true as const, id: i.id }) }),
  }),
  addFile: operation<{ id: number; body: Json }, unknown>('projects.files.add', {
    v1: v1('post', (i) => `${PROJECTS_V1}/${i.id}/files`, { body: (i) => i.body }),
    v2: v2('post', (i) => `/projects/${i.id}/files`, { body: (i) => i.body }),
  }),
  removeFile: operation<{ id: number; fileId: number }, { removed: true; projectId: number; fileId: number }>('projects.files.remove', {
    v1: v1('delete', (i) => `${PROJECTS_V1}/${i.id}/files/${i.fileId}`, {
      out: (_d, i) => ({ removed: true as const, projectId: i.id, fileId: i.fileId }),
    }),
    v2: v2('delete', (i) => `/projects/${i.id}/files/${i.fileId}`, {
      out: (_d, i) => ({ removed: true as const, projectId: i.id, fileId: i.fileId }),
    }),
  }),
};

// ─── Shares (C17), templates and geocoding (already in v2) ────────────────

export const SHAREABLES = {
  /** v1 appends `--link-params` to the URL; v2 takes them as `linkParams` in the body. */
  create: operation<{ body: Json; linkParams?: string }, unknown>('shareables.create', {
    v1: v1('post', (i) => (i.linkParams ? `/shareable?${i.linkParams.replace(/^\?/, '')}` : '/shareable'), {
      service: 'templates',
      body: (i) => i.body,
    }),
    v2: v2('post', '/shares', {
      body: (i) => ({ ...i.body, ...(i.linkParams ? { linkParams: parseQueryString(i.linkParams) } : {}) }),
    }),
  }),
};

export const TEMPLATES = {
  list: operation<{ templateIdentifier?: string }, unknown>('templates.list', {
    v1: v1('get', '/api/templates', { query: (i) => ({ templateIdentifier: i.templateIdentifier }) }),
    v2: v2('get', '/templates', { query: (i) => ({ templateIdentifier: i.templateIdentifier }) }),
  }),
};

/**
 * Both return the public-API envelope `{ data }`: v1 as Solar answers it
 * (`{ code, data, error }`), v2 rebuilt from the unwrapped `data`.
 */
export const GEOCODE = {
  resolve: operation<{ address: string; country?: string }, Json>('geocode.resolve', {
    v1: v1('get', '/api/geocode', { query: (i) => ({ address: i.address, country: i.country }) }),
    v2: v2('get', '/reference/geocode', { query: (i) => ({ address: i.address, country: i.country }), out: (data) => ({ data }) }),
  }),
  reverse: operation<{ lat: string; lng: string }, Json>('geocode.reverse', {
    v1: v1('get', '/api/reverse-geocode', { query: (i) => ({ lat: i.lat, lng: i.lng }) }),
    v2: v2('get', '/reference/reverse-geocode', { query: (i) => ({ lat: i.lat, lng: i.lng }), out: (data) => ({ data }) }),
  }),
};
