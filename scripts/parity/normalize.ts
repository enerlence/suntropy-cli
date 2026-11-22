/**
 * Normalisation of the JSON a command prints, so that the v1 and the v2 run
 * compare equal when they differ only in what the contract allows (§1.8).
 */

/** §1.8.1 authorship, §1.8.2 secrets, plus per-request noise. */
export const DROPPED_KEYS = new Set([
  'creationUserUID',
  'lastEditUserUID',
  'ownerUserUID',
  'uploadedByUserUID',
  'assignedUserUID',
  'isOwner',
  'canEdit',
  'password',
  'passwordConfirm',
  'requestId',
]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

export interface NormalizeOptions {
  /** Values this path created → placeholder (`<panel>`); the other path maps its own ids to the same names. */
  ids?: Map<string, string>;
  /** Strings that only differ by the path suffix (`parity-<run>-v1` → `parity-<run>`). */
  names?: Map<string, string>;
  /** Replace dates (creation, edit and comment timestamps differ between runs). */
  dates?: boolean;
  /** Extra keys to drop for this case. */
  ignore?: string[];
  /** Keys whose numeric value is mapped through `ids` (default: keys that look like ids). */
  idKeys?: Set<string>;
}

export function normalize(value: unknown, opts: NormalizeOptions = {}, key = ''): unknown {
  if (Array.isArray(value)) return value.map((v) => normalize(v, opts, key));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    const obj = value as Record<string, unknown>;
    for (const k of Object.keys(obj).sort()) {
      if (DROPPED_KEYS.has(k) || opts.ignore?.includes(k)) continue;
      // §1.8.3: the security `client` record of the theme is internal.
      if (k === 'client' && 'idClientThemeConfig' in obj) continue;
      // A key that is an id this path created (a surface uuid keying a log);
      // numeric keys are hours, months… never ids.
      out[(!/^\d+$/.test(k) && opts.ids?.get(k)) || k] = normalize(obj[k], opts, k);
    }
    return out;
  }
  if (typeof value === 'string') {
    if (opts.dates && ISO_DATE.test(value)) return '<date>';
    let s = value;
    for (const [from, to] of opts.names ?? []) s = s.split(from).join(to);
    if (opts.ids?.has(s)) return opts.ids.get(s);
    return s;
  }
  // Epoch-millisecond moments (`lastStateUpdateMomentMS`): a date, like the ISO ones.
  if (opts.dates && typeof value === 'number' && /MomentMS$/.test(key)) return '<date>';
  const isIdKey = opts.idKeys ? opts.idKeys.has(key) : /(^id|Id$|^id$|_id$)/.test(key);
  if (typeof value === 'number' && opts.ids?.has(String(value)) && isIdKey) {
    return opts.ids.get(String(value));
  }
  return value;
}

/** Keys and value types only: for results whose numbers may differ (§1.8.6). */
export function shape(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [shape(value[0])] : [];
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) out[k] = shape((value as Record<string, unknown>)[k]);
    return out;
  }
  return value === null ? 'null' : typeof value;
}

/** Paths where `a` and `b` differ (at most `max`). */
export function diff(a: unknown, b: unknown, path = '$', out: string[] = [], max = 40): string[] {
  if (out.length >= max) return out;
  if (Object.is(a, b)) return out;
  const ta = Array.isArray(a) ? 'array' : a === null ? 'null' : typeof a;
  const tb = Array.isArray(b) ? 'array' : b === null ? 'null' : typeof b;
  if (ta !== tb) {
    out.push(`${path}: v1 ${short(a)} | v2 ${short(b)}`);
    return out;
  }
  if (ta === 'array') {
    const aa = a as unknown[];
    const bb = b as unknown[];
    if (aa.length !== bb.length) out.push(`${path}.length: v1 ${aa.length} | v2 ${bb.length}`);
    for (let i = 0; i < Math.min(aa.length, bb.length); i++) diff(aa[i], bb[i], `${path}[${i}]`, out, max);
    return out;
  }
  if (ta === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
      if (!(k in ao)) out.push(`${path}.${k}: only in v2 (${short(bo[k])})`);
      else if (!(k in bo)) out.push(`${path}.${k}: only in v1 (${short(ao[k])})`);
      else diff(ao[k], bo[k], `${path}.${k}`, out, max);
      if (out.length >= max) break;
    }
    return out;
  }
  out.push(`${path}: v1 ${short(a)} | v2 ${short(b)}`);
  return out;
}

function short(v: unknown): string {
  const s = JSON.stringify(v);
  return s === undefined ? 'undefined' : s.length > 80 ? `${s.slice(0, 77)}...` : s;
}
