/**
 * Reference data, consumption and notifications (contract §3.2, A12–A20).
 * The v1 routes go to the periods, profiles and notifications services; the
 * v2 ones to Solar through the gateway.
 */
import { readFileSync } from 'fs';
import axios from 'axios';
import { custom, operation, send, v1, v2, type Ctx } from '../core.js';
import { v2ErrorBody } from '../../client.js';
import { tenantOf, type Json } from '../translate.js';

export interface PeriodsInput {
  tariffId: number;
  zoneId: number;
  startDate: string;
  endDate: string;
  market?: string;
}

export interface EstimateInput {
  startDate: string;
  endDate: string;
  tariff: string;
  type: string;
  annualConsumption: string | number;
  market?: string;
  consumptionType?: string;
  customProfileId?: string;
  consumptionByMonth?: unknown;
  dailyCurve?: unknown;
}

/** Profiles reads `clientId` (the tenant); the CLI never sent it (§0.1). */
function clientId(ctx: Ctx): Json {
  const id = tenantOf(ctx);
  if (!id) throw new Error('Could not tell the account (clientUID) of the session. Run `suntropy auth login` again.');
  return { clientId: id };
}

async function multipartZip(ctx: Ctx, path: string, file: string): Promise<any> {
  const FormData = (await import('form-data')).default;
  const form = new FormData();
  form.append('file', readFileSync(file), { filename: file.split('/').pop(), contentType: 'application/zip' });
  const res = await ctx.http.post(path, form, { headers: form.getHeaders() });
  return res.data;
}

export const REFERENCE = {
  /** A12 */
  periods: operation<PeriodsInput, unknown>('reference.periods', {
    v1: v1('get', '/periodos', {
      service: 'periods',
      query: (i) => ({ idTarifa: i.tariffId, idZona: i.zoneId, fechaInicio: i.startDate, fechaFin: i.endDate, market: i.market }),
    }),
    v2: v2('get', '/reference/periods', {
      query: (i) => ({ tariffId: i.tariffId, zoneId: i.zoneId, startDate: i.startDate, endDate: i.endDate, market: i.market }),
    }),
  }),

  /** A13. v1 corrected: periods reads `pais`, not `market` (§0.1). */
  tariffs: operation<{ market?: string }, unknown>('reference.tariffs', {
    v1: v1('get', '/tarifas-atr', { service: 'periods', query: (i) => ({ pais: i.market }) }),
    v2: v2('get', '/reference/tariffs', { query: (i) => ({ market: i.market }) }),
  }),

  /** A14 */
  zones: operation<{ market?: string }, unknown>('reference.zones', {
    v1: v1('get', '/zonas', { service: 'periods', query: (i) => ({ market: i.market }) }),
    v2: v2('get', '/reference/zones', { query: (i) => ({ market: i.market }) }),
  }),

  /** A15 */
  reeProfiles: operation<{ startDate: string; endDate: string; tariff: string; type: string; market?: string }, unknown>(
    'reference.ree-profiles',
    {
      v1: v1('get', '/ree-profiles', { service: 'profiles', query: (i) => ({ ...i }) }),
      v2: v2('get', '/reference/ree-profiles', { query: (i) => ({ ...i }) }),
    },
  ),

  /** A16: v1 query + body, v2 one JSON body (`anualConsumption` → `annualConsumption`). */
  estimate: operation<EstimateInput, unknown>('consumption.estimate', {
    v1: v1('post', '/consumption-estimation', {
      service: 'profiles',
      query: (i) => ({
        startDate: i.startDate,
        endDate: i.endDate,
        tariff: i.tariff,
        type: i.type,
        anualConsumption: i.annualConsumption,
        market: i.market,
        consumptionType: i.consumptionType,
        customProfileId: i.customProfileId,
      }),
      body: (i) => ({
        ...(i.consumptionByMonth !== undefined ? { consumptionByMonth: i.consumptionByMonth } : {}),
        ...(i.dailyCurve !== undefined ? { dailyCurve: i.dailyCurve } : {}),
      }),
    }),
    v2: v2('post', '/calculations/consumption-estimation', {
      body: (i) => {
        const { annualConsumption, ...rest } = i;
        const body: Json = { ...rest, annualConsumption: Number(annualConsumption) };
        for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
        return body;
      },
    }),
  }),

  /** A17. v1 corrected: `clientId` of the session. */
  customTags: operation<void, unknown>('consumption.custom-tags', {
    v1: v1('get', '/custom-profiles/getTags', { service: 'profiles', query: (_i, ctx) => clientId(ctx) }),
    v2: v2('get', '/reference/custom-profiles/tags'),
  }),

  /** A18. v1 corrected: `clientId`, and the profile picked by id in the client. Both: array of 0 or 1. */
  customProfileInfo: operation<{ id: string }, unknown>('consumption.custom-profile-info', {
    v1: v1('get', '/custom-profiles/getInfo', {
      service: 'profiles',
      query: (_i, ctx) => clientId(ctx),
      out: (data, { id }) =>
        (Array.isArray(data) ? data : data ? [data] : []).filter(
          (p: Json) => String(p?._id ?? p?.id ?? p?.idCustomProfile) === String(id),
        ),
    }),
    v2: v2('get', '/reference/custom-profiles', { query: (i) => ({ id: i.id }) }),
  }),

  /** A19 */
  eredesZip: operation<{ file: string }, unknown>('consumption.from-file', {
    v1: custom((ctx, i) => multipartZip(ctx, '/consumption-files-processor/portugal/eredes-zip', i.file), 'profiles'),
    v2: custom(async (ctx, i) => (await multipartZip(ctx, '/calculations/consumption-files/eredes-zip', i.file))?.data),
  }),
};

export type NotificationResult = { sent: true; notificationId?: unknown } | { sent: false; reason: string };

const DISABLED = new Set(['NOTIFICATIONS_DISABLED_FOR_CLIENT', 'NOTIFICATION_TYPE_DISABLED']);

export const NOTIFICATIONS = {
  /**
   * A20. Notifications disabled for the client or the type is not an error in
   * either version: v1 answers 200 with the reason as a string, v2 a 422 with
   * the reason as `code`.
   */
  send: operation<{ notification: Json }, NotificationResult>('notifications.send', {
    v1: v1('post', '/notifications', {
      service: 'notifications',
      body: (i) => i.notification,
      out: (data) =>
        typeof data === 'string' ? { sent: false, reason: data } : { sent: true, notificationId: data?.idNotification },
    }),
    v2: custom(async (ctx, { notification }) => {
      const body = { ...notification };
      if (body.fromUserUid === undefined) delete body.fromUserUid;
      try {
        const env = await send(ctx, 'post', '/notifications', { body });
        return { sent: true, notificationId: env?.data?.idNotification };
      } catch (err) {
        const e = axios.isAxiosError(err) ? v2ErrorBody(err.response?.data) : undefined;
        if (e && err && axios.isAxiosError(err) && err.response?.status === 422 && DISABLED.has(e.code)) {
          return { sent: false, reason: e.code };
        }
        throw err;
      }
    }),
  }),
};
