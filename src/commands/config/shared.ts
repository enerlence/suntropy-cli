import { Command } from 'commander';
import { readFileSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { spawnSync } from 'child_process';
import type { OutputOptions } from '../../output.js';

export type GlobalOpts = OutputOptions & Record<string, unknown>;

/** Walk up to the root program and return its options. */
export function getGlobalOpts(cmd: Command): GlobalOpts {
  let root: Command = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as GlobalOpts;
}

/** Coerce a string value into boolean / number / JSON when it makes sense. */
export function coerceValue(raw: string): unknown {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (raw === 'null') return null;
  if (/^-?\d+$/.test(raw)) return parseInt(raw, 10);
  if (/^-?\d*\.\d+$/.test(raw)) return parseFloat(raw);
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try { return JSON.parse(raw); } catch { /* fall through to string */ }
  }
  return raw;
}

/** Parse an array of `--set key=value` entries into a flat object. */
export function parseSetFlags(entries: string[] | undefined): Record<string, unknown> {
  if (!entries || entries.length === 0) return {};
  const out: Record<string, unknown> = {};
  for (const entry of entries) {
    const eq = entry.indexOf('=');
    if (eq < 0) throw new Error(`Invalid --set value "${entry}" (expected key=value)`);
    const key = entry.slice(0, eq).trim();
    const rawVal = entry.slice(eq + 1);
    if (!key) throw new Error(`Invalid --set value "${entry}" (empty key)`);
    out[key] = coerceValue(rawVal);
  }
  return out;
}

/** Load a JSON file (absolute or relative path). */
export function loadFromFile(path: string): Record<string, unknown> {
  const raw = readFileSync(path, 'utf-8');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`File ${path} must contain a JSON object at the top level`);
  }
  return parsed as Record<string, unknown>;
}

/** Pick a subset of keys from an object (shallow). */
export function pickKeys<T extends Record<string, unknown>>(obj: T | undefined | null, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!obj) return out;
  for (const k of keys) {
    if (k in obj) out[k] = (obj as Record<string, unknown>)[k];
  }
  return out;
}

/** Build a merge payload from: --from-file, --set key=value, and direct flag mappings. */
export function buildPayload(
  flagValues: Record<string, unknown>,
  setEntries: string[] | undefined,
  fromFile: string | undefined,
  allowedKeys?: readonly string[],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (fromFile) Object.assign(payload, loadFromFile(fromFile));
  if (setEntries) Object.assign(payload, parseSetFlags(setEntries));
  for (const [k, v] of Object.entries(flagValues)) {
    if (v !== undefined) payload[k] = v;
  }
  if (allowedKeys) {
    for (const k of Object.keys(payload)) {
      if (!allowedKeys.includes(k)) {
        throw new Error(`Field "${k}" does not belong to this section. Allowed: ${allowedKeys.join(', ')}`);
      }
    }
  }
  return payload;
}

/** Open $EDITOR (or vi) on a JSON blob and return the parsed result. */
export function editJson(initial: unknown, filenameHint = 'config'): Record<string, unknown> {
  const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
  const tmp = join(tmpdir(), `suntropy-${filenameHint}-${Date.now()}.json`);
  writeFileSync(tmp, JSON.stringify(initial ?? {}, null, 2));
  try {
    const res = spawnSync(editor, [tmp], { stdio: 'inherit' });
    if (res.status !== 0) throw new Error(`Editor "${editor}" exited with status ${res.status}`);
    const updated = readFileSync(tmp, 'utf-8');
    const parsed = JSON.parse(updated);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Edited content must be a JSON object at the top level');
    }
    return parsed as Record<string, unknown>;
  } finally {
    try { unlinkSync(tmp); } catch { /* ignore */ }
  }
}
