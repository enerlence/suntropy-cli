#!/usr/bin/env node
// Comprueba que cada subcomando de `suntropy satvolt` está documentado en la skill de referencia
// (skills/satvolt-cli.md). Las skills viven en enerlence/suntropy-cli-skills y se copian al paquete con
// `npm run skills:sync`; si la CLI gana un comando y la skill no lo cuenta, este check falla.
//
//   node scripts/check-skills.mjs [--skills <carpeta>]    (por defecto ./skills; necesita dist/ compilado)
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dir = args.includes('--skills') ? args[args.indexOf('--skills') + 1] : 'skills';
const CLI = 'dist/bin/suntropy.js';
const REF = join(dir, 'satvolt-cli.md');
for (const f of [CLI, REF]) {
  if (!existsSync(f)) {
    console.error(`check-skills: falta ${f}${f === CLI ? ' (npm run build)' : ' (npm run skills:sync)'}`);
    process.exit(2);
  }
}

// Con el perfil `delete` la CLI enseña todos los comandos (en `read` esconde los que escriben).
const env = { ...process.env, SUNTROPY_COMMAND_PROFILE: 'delete' };
function subcomandos(ruta) {
  const out = execFileSync('node', [CLI, ...ruta, '--help'], { env, encoding: 'utf8' });
  const i = out.indexOf('Commands:');
  if (i < 0) return [];
  return [...out.slice(i).matchAll(/^ {2}([a-z][a-z0-9-]*)/gm)].map((m) => m[1]).filter((c) => c !== 'help');
}
function hojas(ruta) {
  return subcomandos(ruta).flatMap((s) => {
    const r = [...ruta, s];
    const h = hojas(r);
    return h.length ? h : [r.slice(1).join(' ')];
  });
}

const doc = readFileSync(REF, 'utf8');
const todos = hojas(['satvolt']);
// Un comando cuenta como documentado si aparece tal cual («campaigns estimate», «usage») en la skill.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const faltan = todos.filter((c) => !new RegExp('(^|[`\\s|(])' + esc(c) + '([`\\s|<\\[]|$)', 'm').test(doc));
if (faltan.length) {
  console.error(`check-skills: ${faltan.length} de ${todos.length} subcomandos de \`suntropy satvolt\` no están en ${REF}:`);
  for (const c of faltan) console.error(`  - ${c}`);
  console.error('Documéntalos en enerlence/suntropy-cli-skills y vuelve a sincronizar (npm run skills:sync).');
  process.exit(1);
}
console.log(`check-skills: los ${todos.length} subcomandos de \`suntropy satvolt\` están en ${REF}.`);
