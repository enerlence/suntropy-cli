#!/usr/bin/env node
// Copia las skills de enerlence/suntropy-cli-skills (la única fuente) a ./skills, que es lo que publica el
// paquete. El repo de la CLI no guarda copia propia: así el paquete no puede quedarse con skills viejas.
//
//   node scripts/sync-skills.mjs [--ref <rama|tag|sha>]     (por defecto main; SKILLS_REF también vale)
//   node scripts/sync-skills.mjs --from <carpeta>           (copia local, p. ej. un clon con cambios sin mergear)
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPO = 'enerlence/suntropy-cli-skills';
const args = process.argv.slice(2);
const opt = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined);
const ref = opt('--ref') || process.env.SKILLS_REF || 'main';
const DEST = 'skills';

let origen = opt('--from');
let tmp;
if (!origen) {
  tmp = mkdtempSync(join(tmpdir(), 'suntropy-skills-'));
  const url = `https://codeload.github.com/${REPO}/tar.gz/${encodeURIComponent(ref)}`;
  const tgz = join(tmp, 'skills.tgz');
  const r = await fetch(url);
  if (!r.ok) {
    console.error(`sync-skills: ${url} → HTTP ${r.status}`);
    process.exit(1);
  }
  writeFileSync(tgz, Buffer.from(await r.arrayBuffer()));
  execFileSync('tar', ['xzf', tgz, '-C', tmp]);
  const raiz = readdirSync(tmp).find((d) => d.startsWith('suntropy-cli-skills-'));
  origen = join(tmp, raiz, 'skills');
}
if (!existsSync(origen)) {
  console.error(`sync-skills: no existe ${origen}`);
  process.exit(1);
}

rmSync(DEST, { recursive: true, force: true });
cpSync(origen, DEST, { recursive: true });
const n = readdirSync(DEST).filter((f) => f.endsWith('.md')).length;
writeFileSync(join(DEST, '.origen'), `${opt('--from') ? `local:${opt('--from')}` : `${REPO}@${ref}`}\n${new Date().toISOString()}\n`);
if (tmp) rmSync(tmp, { recursive: true, force: true });
console.log(`sync-skills: ${n} skills de ${opt('--from') || `${REPO}@${ref}`} → ${DEST}/`);
