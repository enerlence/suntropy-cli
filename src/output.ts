import chalk from 'chalk';
import { writeFileSync } from 'fs';

export type OutputFormat = 'json' | 'human' | 'csv';

export interface OutputOptions {
  format?: OutputFormat;
  fields?: string;
  quiet?: boolean;
  save?: string;
}

/** Pick only specified fields from an object */
function pickFields(obj: Record<string, unknown>, fields: string[]): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.includes('.')) {
      const parts = f.split('.');
      let val: unknown = obj;
      for (const p of parts) {
        val = val && typeof val === 'object' ? (val as Record<string, unknown>)[p] : undefined;
      }
      result[f] = val;
    } else {
      result[f] = obj[f];
    }
  }
  return result;
}

function applyFieldSelection(data: unknown, fields?: string): unknown {
  if (!fields) return data;
  const fieldList = fields.split(',').map((f) => f.trim());
  if (Array.isArray(data)) {
    return data.map((item) => pickFields(item as Record<string, unknown>, fieldList));
  }
  if (typeof data === 'object' && data !== null) {
    return pickFields(data as Record<string, unknown>, fieldList);
  }
  return data;
}

function formatHumanValue(val: unknown): string {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
}

function formatHuman(data: unknown): string {
  if (Array.isArray(data)) {
    if (data.length === 0) return chalk.dim('(empty)');
    const keys = Object.keys(data[0] as Record<string, unknown>);
    const widths = keys.map((k) => Math.max(k.length, ...data.map((r) => formatHumanValue((r as Record<string, unknown>)[k]).length)));
    const header = keys.map((k, i) => chalk.bold(k.padEnd(widths[i]))).join('  ');
    const rows = data.map((row) =>
      keys.map((k, i) => formatHumanValue((row as Record<string, unknown>)[k]).padEnd(widths[i])).join('  '),
    );
    return [header, keys.map((_, i) => '─'.repeat(widths[i])).join('  '), ...rows].join('\n');
  }
  if (typeof data === 'object' && data !== null) {
    const entries = Object.entries(data as Record<string, unknown>);
    const maxKey = Math.max(...entries.map(([k]) => k.length));
    return entries.map(([k, v]) => `${chalk.bold(k.padEnd(maxKey))}  ${formatHumanValue(v)}`).join('\n');
  }
  return String(data);
}

function formatCsv(data: unknown): string {
  if (!Array.isArray(data)) {
    if (typeof data === 'object' && data !== null) data = [data];
    else return String(data);
  }
  const arr = data as Record<string, unknown>[];
  if (arr.length === 0) return '';
  const keys = Object.keys(arr[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(','), ...arr.map((r) => keys.map((k) => escape(r[k])).join(','))].join('\n');
}

export function output(data: unknown, opts: OutputOptions = {}): void {
  const filtered = applyFieldSelection(data, opts.fields);
  let text: string;

  switch (opts.format) {
    case 'human':
      text = formatHuman(filtered);
      break;
    case 'csv':
      text = formatCsv(filtered);
      break;
    default:
      text = JSON.stringify(filtered, null, 2);
  }

  process.stdout.write(text + '\n');

  if (opts.save) {
    writeFileSync(opts.save, JSON.stringify(filtered, null, 2));
  }
}

export function outputError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  process.stderr.write(JSON.stringify({ error: true, message: msg }) + '\n');
  process.exitCode = 1;
}

/** Wrap paginated response */
export function outputPaginated(data: unknown[], total: number, limit: number, offset: number, opts: OutputOptions = {}): void {
  if (opts.format === 'human') {
    const filtered = applyFieldSelection(data, opts.fields);
    const end = Math.min(offset + limit, total);
    process.stdout.write(chalk.dim(`Showing ${offset + 1}-${end} of ${total}\n\n`));
    process.stdout.write(formatHuman(filtered) + '\n');
  } else {
    output({ data: applyFieldSelection(data, opts.fields), total, limit, offset, hasMore: offset + limit < total }, { ...opts, fields: undefined });
  }
}
