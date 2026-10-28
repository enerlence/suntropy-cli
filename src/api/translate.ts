/**
 * Translations between the v1 and v2 shapes (contract §3.0). Everything a
 * route side needs to make both versions print the same JSON.
 */
import { send, type Ctx, type V2Envelope } from './core.js';

/** A page of items with the total of the collection: what `outputPaginated` prints. */
export interface Page<T = unknown> {
  items: T[];
  total: number;
}

/** Largest `limit` the API v2 accepts. */
export const V2_MAX_LIMIT = 100;

/**
 * v1 list bodies come as `[items, total]`, a plain array, or `{ data, total }`.
 */
export function parseV1List(data: unknown): Page {
  if (Array.isArray(data) && data.length >= 2 && Array.isArray(data[0]) && typeof data[1] === 'number') {
    return { items: data[0], total: data[1] };
  }
  if (Array.isArray(data)) return { items: data, total: data.length };
  const d = (data ?? {}) as { data?: unknown; total?: number; count?: number };
  const items = Array.isArray(d.data) ? d.data : [];
  return { items, total: d.total ?? d.count ?? items.length };
}

/** v1 array that is the whole collection → page in the client. */
export function pageInClient<T>(all: T[], limit: number, offset: number): Page<T> {
  return { items: all.slice(offset, offset + limit), total: all.length };
}

/** v2 `{ data, pagination }` → `Page`. */
export function v2Page(env: V2Envelope): Page {
  const items = Array.isArray(env.data) ? env.data : [];
  return { items, total: env.pagination?.total ?? items.length };
}

/**
 * A v2 collection range of any size: one request when `limit` ≤ 100, several
 * otherwise (the v2 caps `limit` at 100, the CLI never did).
 */
export async function v2Range(
  ctx: Ctx,
  method: 'get' | 'post',
  path: string,
  query: Record<string, unknown>,
  limit: number,
  offset: number,
  body?: unknown,
): Promise<Page> {
  const items: unknown[] = [];
  let total = 0;
  let at = offset;
  do {
    const take = Math.min(V2_MAX_LIMIT, limit - items.length);
    const env: V2Envelope = await send(ctx, method, path, { query: { ...query, limit: take, offset: at }, body });
    const page = v2Page(env);
    items.push(...page.items);
    total = page.total;
    if (!env.pagination?.hasMore || page.items.length === 0) break;
    at = env.pagination.nextOffset ?? at + page.items.length;
  } while (items.length < limit);
  return { items, total };
}

/**
 * Every item of a v2 collection, following `nextOffset` with `limit=100`: for
 * the commands whose v1 route returns the whole collection (contract §1.2).
 */
export async function v2All(ctx: Ctx, path: string, query: Record<string, unknown> = {}): Promise<unknown[]> {
  const all: unknown[] = [];
  let offset = 0;
  for (;;) {
    const env: V2Envelope = await send(ctx, 'get', path, { query: { ...query, limit: V2_MAX_LIMIT, offset } });
    const items = Array.isArray(env.data) ? env.data : [];
    all.push(...items);
    if (!env.pagination?.hasMore || items.length === 0) return all;
    offset = env.pagination.nextOffset ?? offset + items.length;
  }
}

// ─── Deletes (§3.0.4) ─────────────────────────────────────────────────────

export function deletedOne(id: string | number): { success: true; deleted: string } {
  return { success: true, deleted: String(id) };
}

/** Batch delete: `affected` from a v1 `DeleteResult`, else the number of ids. */
export function deletedBatchV1(data: unknown, ids: unknown[]): { success: true; deleted: number } {
  const affected = data && typeof data === 'object' ? (data as { affected?: unknown }).affected : undefined;
  return { success: true, deleted: typeof affected === 'number' ? affected : ids.length };
}

export function deletedBatchV2(data: unknown, ids: unknown[]): { success: true; deleted: number } {
  const deleted = data && typeof data === 'object' ? (data as { deleted?: unknown }).deleted : undefined;
  return { success: true, deleted: typeof deleted === 'number' ? deleted : ids.length };
}

// ─── Bodies ───────────────────────────────────────────────────────────────

export type Json = Record<string, any>;

/** Shallow copy without `keys`. */
export function omit<T extends Json>(obj: T | undefined, keys: readonly string[]): T {
  const out = { ...(obj ?? {}) } as Json;
  for (const k of keys) delete out[k];
  return out as T;
}

/** Positive integer id when it looks like one, else the string. */
export function numericId(id: string | number): number | string {
  const n = Number(id);
  return Number.isSafeInteger(n) && n > 0 ? n : id;
}

/**
 * A v1 reference to a related entity, e.g. `charger: { idCharger }`, and the
 * v2 field that carries its id (`chargerId`). `many` maps a list of links,
 * e.g. `veChargerKitCustomAssets: [{ customAsset: { idCustomAsset }, units }]`
 * → `customAssets: [{ customAssetId, units }]`.
 */
export type RefRule =
  | { from: string; to: string; key: string }
  | { from: string; to: string; many: { ref: string; key: string; to: string; keep?: string[] } }
  | { from: string; to: string; ids: string };

/**
 * Rewrites v1 relation objects into v2 id references. A field already in the
 * v2 form is left as is, so either form works as input.
 */
export function toV2Refs(body: Json | undefined, rules: readonly RefRule[]): Json {
  const out: Json = { ...(body ?? {}) };
  for (const rule of rules) {
    if (!(rule.from in out)) continue;
    const v = out[rule.from];
    delete out[rule.from];
    if ('key' in rule) {
      out[rule.to] = v === null ? null : v && typeof v === 'object' ? v[rule.key] : v;
    } else if ('ids' in rule) {
      out[rule.to] = Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? x[rule.ids] : x)) : v;
    } else {
      const m = rule.many;
      out[rule.to] = Array.isArray(v)
        ? v.map((link: Json) => {
            const ref = link?.[m.ref];
            const mapped: Json = { [m.to]: ref && typeof ref === 'object' ? ref[m.key] : link?.[m.to] };
            for (const k of m.keep ?? []) if (link?.[k] !== undefined) mapped[k] = link[k];
            return mapped;
          })
        : v;
    }
  }
  return out;
}

/** Renames a key (`identifier` → `name` for heat pumps in v2). */
export function renameKey(obj: Json | undefined, from: string, to: string): Json {
  const out: Json = { ...(obj ?? {}) };
  if (from in out) {
    out[to] = out[from];
    delete out[from];
  }
  return out;
}

/** Maps every item of an array, or the object itself. */
export function eachItem<T>(data: T, fn: (item: Json) => Json): T {
  if (Array.isArray(data)) return data.map((x) => (x && typeof x === 'object' ? fn(x) : x)) as T;
  return (data && typeof data === 'object' ? fn(data as Json) : data) as T;
}

/** `?a=1&b=2` (or `a=1&b=2`) → `{ a: '1', b: '2' }`. */
export function parseQueryString(qs: string): Record<string, string> {
  const params = new URLSearchParams(qs.replace(/^\?/, ''));
  const out: Record<string, string> = {};
  params.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

/**
 * Reads the tenant of the credential: the `clientUID` claim of a JWT, else
 * the profile's `clientUID`. The v1 profiles service needs it as `clientId`.
 */
export function tenantOf(ctx: Ctx): string | undefined {
  const parts = ctx.token.split('.');
  if (parts.length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
      if (typeof claims?.clientUID === 'string') return claims.clientUID;
    } catch {
      // not a JWT we can read
    }
  }
  return ctx.profile.clientUID;
}
