import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RecordedRequest {
  method: string;
  url: string;
  headers: IncomingMessage['headers'];
  body: any;
}

export type Handler = (req: RecordedRequest) => { status?: number; body?: unknown };

/** HTTP server that records every request and answers with `handler`. */
export async function fakeServer(handler: Handler) {
  const requests: RecordedRequest[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: any = raw;
      try {
        body = raw ? JSON.parse(raw) : undefined;
      } catch {
        // keep raw
      }
      const recorded = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body };
      requests.push(recorded);
      const out = handler(recorded);
      res.writeHead(out.status ?? 200, { 'Content-Type': 'application/json' });
      res.end(out.body === undefined ? '' : JSON.stringify(out.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A fresh HOME with an optional ~/.suntropy/config.json. */
export function tempHome(config?: unknown): string {
  const home = mkdtempSync(join(tmpdir(), 'suntropy-cli-test-'));
  if (config) {
    mkdirSync(join(home, '.suntropy'), { recursive: true });
    writeFileSync(join(home, '.suntropy', 'config.json'), JSON.stringify(config, null, 2));
  }
  return home;
}

export function readConfig(home: string): any {
  return JSON.parse(readFileSync(join(home, '.suntropy', 'config.json'), 'utf-8'));
}

/** Runs the CLI from source (tsx) in a subprocess. */
export function runCli(
  args: string[],
  env: Record<string, string | undefined>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', join(ROOT, 'bin', 'suntropy.ts'), ...args], {
      cwd: ROOT,
      env: {
        PATH: process.env.PATH,
        CI: 'true',
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => (stdout += c));
    child.stderr.on('data', (c) => (stderr += c));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Config with one profile holding `token` against `server`. */
export function profileWith(token: string, server = 'https://api.enerlence.com', extra: Record<string, unknown> = {}) {
  return { activeProfile: 'default', profiles: { default: { server, token, ...extra } } };
}
