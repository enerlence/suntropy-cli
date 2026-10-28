/**
 * Parity harness: runs every CLI command with a JWT (v1) and with a `sun_` key
 * (v2) against a real backend and compares the JSON they print.
 *
 *   PARITY_V1_TOKEN=<jwt> PARITY_V2_TOKEN=sun_… SUNTROPY_GATEWAY_URL=http://localhost:8087 \
 *     npm run parity -- --server http://localhost
 *
 * See scripts/parity/README.md.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { matrix, type ParityCase, type PathCtx } from './cases.js';
import { diff, normalize, shape } from './normalize.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Args {
  server: string;
  out: string;
  only?: RegExp;
  dist: boolean;
  timeoutMs: number;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const server = get('--server') ?? process.env.PARITY_SERVER;
  if (!server) fail('Missing --server <url> (the v1 server, e.g. http://localhost or https://api-dev.enerlence.com).');
  return {
    server: server!,
    out: resolve(get('--out') ?? 'parity-out'),
    only: get('--only') ? new RegExp(get('--only')!, 'i') : undefined,
    dist: argv.includes('--dist'),
    timeoutMs: Number(get('--timeout') ?? 120000),
  };
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

function runCli(args: string[], home: string, opts: Args): Promise<RunResult> {
  const started = Date.now();
  const cmd = opts.dist ? [join(ROOT, 'dist', 'bin', 'suntropy.js')] : ['--import', 'tsx', join(ROOT, 'bin', 'suntropy.ts')];
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, [...cmd, ...args, '--format', 'json'], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: home, CI: 'true', SUNTROPY_GATEWAY_URL: process.env.SUNTROPY_GATEWAY_URL },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs);
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr, ms: Date.now() - started });
    });
  });
}

function homeWith(server: string, token: string): string {
  const home = mkdtempSync(join(tmpdir(), 'suntropy-parity-home-'));
  mkdirSync(join(home, '.suntropy'), { recursive: true });
  const gatewayUrl = process.env.SUNTROPY_GATEWAY_URL;
  writeFileSync(
    join(home, '.suntropy', 'config.json'),
    JSON.stringify({ activeProfile: 'default', profiles: { default: { server, token, ...(gatewayUrl ? { gatewayUrl } : {}) } } }, null, 2),
  );
  return home;
}

type Status = 'OK' | 'FAIL' | 'SKIP' | 'V1_BUG';

interface CaseReport {
  id: string;
  status: Status;
  reason?: string;
  compare?: string;
  v1?: { args: string[]; code: number | null; ms: number; stderr?: string };
  v2?: { args: string[]; code: number | null; ms: number; stderr?: string };
  diff?: string[];
}

function parseJson(s: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
}

/** Placeholders for the values each path created, by the same name in both. */
function idMap(ctx: PathCtx): Map<string, string> {
  return new Map(Object.entries(ctx.ids).map(([k, v]) => [String(v), `<${k}>`]));
}

function compare(c: ParityCase, ctx1: PathCtx, ctx2: PathCtx, out1: unknown, out2: unknown): string[] {
  const mode = c.compare ?? 'entity';
  if (mode === 'url') {
    const bad: string[] = [];
    for (const [label, o] of [['v1', out1], ['v2', out2]] as const) {
      const url = (o as { url?: unknown })?.url;
      if (typeof url !== 'string' || !url.startsWith('https://')) bad.push(`${label}: no https url (${JSON.stringify(o)})`);
    }
    return bad;
  }
  if (mode === 'shape') return diff(shape(out1), shape(out2));
  const entity = mode === 'entity';
  const n1 = normalize(out1, { ignore: c.ignore, dates: entity, ids: entity ? idMap(ctx1) : undefined, names: entity ? new Map([[ctx1.name, ctx1.shared]]) : undefined });
  const n2 = normalize(out2, { ignore: c.ignore, dates: entity, ids: entity ? idMap(ctx2) : undefined, names: entity ? new Map([[ctx2.name, ctx2.shared]]) : undefined });
  return diff(n1, n2);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const v1Token = process.env.PARITY_V1_TOKEN;
  const v2Token = process.env.PARITY_V2_TOKEN;
  if (!v1Token || v1Token.startsWith('sun_')) fail('PARITY_V1_TOKEN must be a user JWT (or a legacy API key), not a sun_ key.');
  if (!v2Token?.startsWith('sun_')) fail('PARITY_V2_TOKEN must be an API v2 key (sun_…).');
  if (!process.env.SUNTROPY_GATEWAY_URL) {
    process.stderr.write('warning: SUNTROPY_GATEWAY_URL not set: the gateway is derived from --server (prod/dev only).\n');
  }

  const run = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
  const shared = `parity-${run}`;
  mkdirSync(opts.out, { recursive: true });
  const env = {
    notifyUser: process.env.PARITY_NOTIFY_USER,
    customProfileId: process.env.PARITY_CUSTOM_PROFILE_ID,
    eredesZip: process.env.PARITY_EREDES_ZIP,
    region: process.env.PARITY_REGION ?? 'Andalucía',
    subRegion: process.env.PARITY_SUBREGION ?? 'Sevilla',
  };
  const ctx: Record<'v1' | 'v2', PathCtx> = {
    v1: { api: 'v1', run, name: `${shared}-v1`, shared, ids: {}, dir: mkdtempSync(join(tmpdir(), 'parity-v1-')), env },
    v2: { api: 'v2', run, name: `${shared}-v2`, shared, ids: {}, dir: mkdtempSync(join(tmpdir(), 'parity-v2-')), env },
  };
  const homes = { v1: homeWith(opts.server, v1Token!), v2: homeWith(opts.server, v2Token!) };
  const cleanup: Record<'v1' | 'v2', Map<string, string[]>> = { v1: new Map(), v2: new Map() };
  const reports: CaseReport[] = [];

  for (const c of matrix()) {
    if (opts.only && !opts.only.test(c.id)) continue;
    if (c.skip) {
      reports.push({ id: c.id, status: 'SKIP', reason: c.skip });
      continue;
    }
    const args1 = c.args(ctx.v1);
    const args2 = c.args(ctx.v2);
    if (!args1 || !args2) {
      reports.push({ id: c.id, status: 'SKIP', reason: 'missing data from an earlier case or an env var' });
      continue;
    }
    c.before?.(ctx.v1);
    const r1 = await runCli(args1, homes.v1, opts);
    c.before?.(ctx.v2);
    const r2 = await runCli(args2, homes.v2, opts);
    const report: CaseReport = {
      id: c.id,
      status: 'OK',
      compare: c.compare ?? 'entity',
      v1: { args: args1, code: r1.code, ms: r1.ms, ...(r1.code ? { stderr: r1.stderr.trim().slice(0, 500) } : {}) },
      v2: { args: args2, code: r2.code, ms: r2.ms, ...(r2.code ? { stderr: r2.stderr.trim().slice(0, 500) } : {}) },
    };
    const expected = c.exit ?? 0;
    const p1 = parseJson(r1.stdout);
    const p2 = parseJson(r2.stdout);
    if (r1.code === expected && p1.ok) c.capture?.(p1.value, ctx.v1);
    if (r2.code === expected && p2.ok) c.capture?.(p2.value, ctx.v2);
    for (const api of ['v1', 'v2'] as const) {
      const r = api === 'v1' ? r1 : r2;
      if (r.code !== 0) continue;
      if (c.cleanup) {
        const del = c.cleanup.args(ctx[api]);
        if (del) cleanup[api].set(c.cleanup.key, del);
      }
      if (c.removes) cleanup[api].delete(c.removes);
    }

    if (r1.code !== expected || r2.code !== expected) {
      report.status = c.knownV1Bug && r1.code !== expected && r2.code === expected ? 'V1_BUG' : 'FAIL';
      report.reason = c.knownV1Bug && report.status === 'V1_BUG' ? c.knownV1Bug : `exit codes v1=${r1.code} v2=${r2.code}, expected ${expected}`;
    } else if (expected === 0 && (c.compare ?? 'entity') !== 'exit') {
      if (!p1.ok || !p2.ok) {
        report.status = 'FAIL';
        report.reason = 'stdout is not JSON';
      } else {
        const d = compare(c, ctx.v1, ctx.v2, p1.value, p2.value);
        if (d.length) {
          report.status = 'FAIL';
          report.diff = d;
        }
      }
    }
    reports.push(report);
    process.stderr.write(`${report.status.padEnd(6)} ${c.id}\n`);
  }

  // What no delete case removed (failures, or commands without delete).
  const leftovers: { api: string; key: string; ok: boolean }[] = [];
  for (const api of ['v1', 'v2'] as const) {
    for (const [key, args] of [...cleanup[api]].reverse()) {
      const r = await runCli(args, homes[api], opts);
      leftovers.push({ api, key, ok: r.code === 0 });
    }
  }

  const summary = {
    run,
    server: opts.server,
    gateway: process.env.SUNTROPY_GATEWAY_URL ?? null,
    finishedAt: new Date().toISOString(),
    counts: Object.fromEntries((['OK', 'FAIL', 'V1_BUG', 'SKIP'] as Status[]).map((s) => [s, reports.filter((r) => r.status === s).length])),
    notDeletable: `manufacturers, studies and shareables have no delete command: they stay named ${shared}-v1/-v2 (studies: ${shared}).`,
    cleanup: leftovers,
    ids: { v1: ctx.v1.ids, v2: ctx.v2.ids },
    cases: reports,
  };
  writeFileSync(join(opts.out, 'parity-report.json'), JSON.stringify(summary, null, 2));
  writeFileSync(join(opts.out, 'parity-report.md'), markdown(summary, reports));
  process.stderr.write(`\n${JSON.stringify(summary.counts)} → ${join(opts.out, 'parity-report.md')}\n`);
  process.exitCode = summary.counts.FAIL ? 1 : 0;
}

function markdown(summary: { run: string; server: string; gateway: string | null; counts: Record<string, number>; notDeletable: string; cleanup: { api: string; key: string; ok: boolean }[] }, reports: CaseReport[]): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|');
  const lines = [
    `# Paridad v1 ↔ v2 de la CLI · ${summary.run}`,
    '',
    `- Servidor v1: \`${summary.server}\``,
    `- Gateway v2: \`${summary.gateway ?? '(derivado del servidor)'}\``,
    `- Resultado: ${Object.entries(summary.counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`,
    `- ${summary.notDeletable}`,
    '',
    '| Caso | Estado | Comparación | v1 | v2 | Motivo |',
    '|---|---|---|---|---|---|',
    ...reports.map((r) => `| ${esc(r.id)} | ${r.status} | ${r.compare ?? ''} | ${r.v1 ? `${r.v1.code} · ${r.v1.ms} ms` : ''} | ${r.v2 ? `${r.v2.code} · ${r.v2.ms} ms` : ''} | ${esc(r.reason ?? (r.diff ? `${r.diff.length} diferencia(s)` : ''))} |`),
    '',
  ];
  const failed = reports.filter((r) => r.status !== 'OK' && r.status !== 'SKIP');
  if (failed.length) {
    lines.push('## Detalle', '');
    for (const r of failed) {
      lines.push(`### ${r.id} · ${r.status}`, '');
      if (r.reason) lines.push(r.reason, '');
      lines.push('```', `v1: suntropy ${r.v1?.args.join(' ')}`, `v2: suntropy ${r.v2?.args.join(' ')}`, '```');
      if (r.diff?.length) lines.push('', '```diff', ...r.diff, '```');
      for (const api of ['v1', 'v2'] as const) if (r[api]?.stderr) lines.push('', `${api} stderr:`, '```', r[api]!.stderr!, '```');
      lines.push('');
    }
  }
  if (summary.cleanup.length) {
    lines.push('## Limpieza final', '', ...summary.cleanup.map((c) => `- ${c.api} ${c.key}: ${c.ok ? 'borrado' : '**no se pudo borrar**'}`), '');
  }
  return lines.join('\n');
}

main().catch((err) => fail(err instanceof Error ? err.stack ?? err.message : String(err)));
