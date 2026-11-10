import { Command } from 'commander';
import { spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import { loadConfig } from '../../config.js';
import { output, type OutputOptions } from '../../output.js';
import { MONITORING_MCP_PATH, profileNameOf, resolveGateway } from '../../connect/gateway.js';

/**
 * `suntropy mcp add --client …`: da de alta el MCP de Suntropy Connect en el
 * cliente de IA del usuario, o explica cómo hacerlo donde no se puede desde
 * aquí (Claude.ai y ChatGPT se configuran en su web).
 *
 * El cliente hace su propio OAuth contra el gateway la primera vez (DCR o
 * CIMD): no se le pasa el token de la CLI, que caduca y rota.
 */

const CLIENTS = ['claude-code', 'codex', 'cursor', 'claude-ai', 'chatgpt'] as const;
type Client = (typeof CLIENTS)[number];

const BRANDS = ['huawei', 'goodwe', 'sungrow', 'deye', 'solis', 'enphase', 'growatt', 'fronius'];

function rootOf(cmd: Command): Command {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root;
}

function hasBinary(bin: string): boolean {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [bin], { encoding: 'utf-8' });
  return r.status === 0;
}

function shellQuote(a: string): string {
  return /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;
}

function run(cmd: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync(cmd[0], cmd.slice(1), { encoding: 'utf-8' });
  return { ok: r.status === 0, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() };
}

export function registerMcpCommands(program: Command): void {
  const mcp = program.command('mcp').description('Servidores MCP de Suntropy en clientes de IA (Claude Code, Codex, Cursor, Claude, ChatGPT)');

  mcp
    .command('add')
    .description(
      'Añade el MCP de Suntropy Connect (monitorización de inversores) a un cliente de IA.\n' +
        '  claude-code, codex: ejecuta su `mcp add` (o lo imprime con --print o si no está instalado).\n' +
        '  cursor:             lo escribe en ~/.cursor/mcp.json (o .cursor/mcp.json con --scope project).\n' +
        '  claude-ai, chatgpt: devuelve los pasos y la URL (se configuran en su web).\n' +
        'El cliente pide el login de Suntropy la primera vez que lo usa.\n' +
        'Ej.: suntropy mcp add --client claude-code',
    )
    .requiredOption('--client <cliente>', CLIENTS.join(' | '))
    .option('--name <nombre>', 'Nombre del servidor en el cliente', 'suntropy-connect')
    .option('--brand <marca>', `Sólo una marca (${BRANDS.join(', ')}) en vez de todas`)
    .option('--url <url>', 'URL del MCP (por defecto <gateway>/monitoring/mcp)')
    .option('--scope <scope>', 'claude-code: user (por defecto), project o local · cursor: user (por defecto) o project')
    .option('--print', 'No toca nada: sólo devuelve el comando o la configuración')
    .action((opts) => {
      try {
        const global = rootOf(mcp).opts() as OutputOptions & { profile?: string };
        const client = String(opts.client) as Client;
        if (!CLIENTS.includes(client)) throw new Error(`--client tiene que ser uno de: ${CLIENTS.join(', ')}.`);
        if (opts.brand && !BRANDS.includes(opts.brand)) throw new Error(`--brand tiene que ser una de: ${BRANDS.join(', ')}.`);

        const config = loadConfig();
        const gateway = resolveGateway(undefined, config.profiles[profileNameOf(config, global.profile)]?.connect?.gateway);
        const url: string = opts.url ?? `${gateway}${opts.brand ? `/${opts.brand}/mcp` : MONITORING_MCP_PATH}`;
        const name: string = opts.name;
        const dry = Boolean(opts.print);

        output(addFor(client, { name, url, scope: opts.scope, dry }), global);
      } catch (err) {
        process.stderr.write(JSON.stringify({ error: true, message: (err as Error).message }) + '\n');
        process.exitCode = 1;
      }
    });
}

interface AddOpts {
  name: string;
  url: string;
  scope?: string;
  dry: boolean;
}

function addFor(client: Client, o: AddOpts): Record<string, unknown> {
  switch (client) {
    case 'claude-code': {
      const scope = o.scope ?? 'user';
      if (!['user', 'project', 'local'].includes(scope)) throw new Error('--scope: user, project o local.');
      const cmd = ['claude', 'mcp', 'add', '--transport', 'http', '--scope', scope, o.name, o.url];
      return viaCli(client, o, cmd, [
        `En Claude Code, abre /mcp, elige «${o.name}» y autentica con tu cuenta de Suntropy.`,
      ]);
    }
    case 'codex': {
      const cmd = ['codex', 'mcp', 'add', o.name, '--url', o.url];
      return viaCli(client, o, cmd, [`codex mcp login ${o.name}   (abre el login de Suntropy en el navegador)`], {
        configFile: '~/.codex/config.toml',
        config: `[mcp_servers.${o.name}]\nurl = "${o.url}"\n`,
      });
    }
    case 'cursor': {
      const scope = o.scope ?? 'user';
      if (!['user', 'project'].includes(scope)) throw new Error('--scope: user o project.');
      const file = scope === 'project' ? join(process.cwd(), '.cursor', 'mcp.json') : join(homedir(), '.cursor', 'mcp.json');
      const entry = { url: o.url };
      const deeplink =
        `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent(o.name)}` +
        `&config=${encodeURIComponent(Buffer.from(JSON.stringify(entry)).toString('base64'))}`;
      const base = {
        client,
        name: o.name,
        url: o.url,
        configFile: file,
        config: { mcpServers: { [o.name]: entry } },
        deeplink,
      };
      if (o.dry) {
        return { ...base, installed: false, next: [`Añade el bloque a ${file}, o abre el deeplink en el equipo con Cursor.`] };
      }
      let current: any = {};
      if (existsSync(file)) {
        try {
          current = JSON.parse(readFileSync(file, 'utf-8') || '{}');
        } catch {
          throw new Error(`${file} no es JSON válido: corrígelo o usa --print y añade el bloque a mano.`);
        }
      }
      const already = Boolean(current?.mcpServers?.[o.name]);
      current.mcpServers = { ...(current.mcpServers ?? {}), [o.name]: entry };
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(current, null, 2) + '\n');
      return {
        ...base,
        installed: true,
        updated: already,
        next: [
          `En Cursor: Settings > MCP, activa «${o.name}» y pulsa «Needs login» para entrar con tu cuenta de Suntropy.`,
        ],
      };
    }
    case 'claude-ai': {
      const link =
        'https://claude.ai/customize/connectors?modal=add-custom-connector' +
        `&connectorName=${encodeURIComponent('Suntropy Connect')}&connectorUrl=${encodeURIComponent(o.url)}`;
      return {
        client,
        url: o.url,
        installed: false,
        installLink: link,
        steps: [
          `Abre ${link} (deja el diálogo relleno), o en Claude: Ajustes > Conectores > Añadir conector personalizado, con la URL ${o.url}.`,
          'Pulsa «Conectar» e inicia sesión con tu cuenta de Suntropy para aprobar el acceso.',
          'Los conectores personalizados piden plan Pro, Max, Team o Enterprise. En Claude Desktop y en el móvil aparece solo.',
        ],
      };
    }
    case 'chatgpt': {
      return {
        client,
        url: o.url,
        installed: false,
        settingsLink: 'https://chatgpt.com/#settings/Connectors',
        steps: [
          'En ChatGPT: Ajustes > Aplicaciones y conectores > Ajustes avanzados > activa el modo desarrollador.',
          `Crea un conector: nombre «Suntropy Connect», URL ${o.url}, autenticación OAuth.`,
          'Pulsa «Conectar» e inicia sesión con tu cuenta de Suntropy para aprobar el acceso.',
          'El modo desarrollador pide un plan de pago de ChatGPT. ChatGPT no admite enlaces que dejen el conector relleno.',
        ],
      };
    }
  }
}

function viaCli(
  client: Client,
  o: AddOpts,
  cmd: string[],
  next: string[],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  const command = cmd.map(shellQuote).join(' ');
  const base = { client, name: o.name, url: o.url, command, ...extra };
  if (o.dry) return { ...base, installed: false, next: [command, ...next] };
  if (!hasBinary(cmd[0])) {
    return {
      ...base,
      installed: false,
      message: `No se encuentra \`${cmd[0]}\` en el PATH. Ejecuta el comando en el equipo donde esté instalado.`,
      next: [command, ...next],
    };
  }
  const r = run(cmd);
  if (!r.ok) {
    const exists = /already exists/i.test(r.stderr + r.stdout);
    if (exists) {
      return {
        ...base,
        installed: true,
        alreadyPresent: true,
        message: `Ya había un servidor «${o.name}». Si apunta a otra URL, quítalo (\`${cmd[0]} mcp remove ${o.name}\`) y repite.`,
        next,
      };
    }
    throw new Error(`\`${command}\` ha fallado: ${r.stderr || r.stdout || 'sin salida'}`);
  }
  return { ...base, installed: true, next };
}
