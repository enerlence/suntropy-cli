import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockGateway, type MockGateway } from './mock-gateway.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'suntropy.ts');

let gw: MockGateway;
let home: string;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  json: any;
  err: any;
}

/** Ejecuta la CLI sin terminal (como un agente), con HOME aislado y el gateway simulado. */
function cli(args: string[], opts: { stdin?: string; env?: Record<string, string> } = {}): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--import', 'tsx', BIN, ...args], {
      cwd: ROOT,
      env: { ...process.env, HOME: home, SUNTROPY_CONNECT_GATEWAY: gw.url, SUNTROPY_CONNECT_TOKEN: '', ...opts.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.stdin.end(opts.stdin ?? '');
    child.on('close', (code) => {
      const parse = (s: string) => {
        try {
          return JSON.parse(s);
        } catch {
          const last = s.trim().split('\n').pop() ?? '';
          try {
            return JSON.parse(last);
          } catch {
            return null;
          }
        }
      };
      resolve({ code: code ?? 0, stdout, stderr, json: parse(stdout), err: parse(stderr) });
    });
  });
}

function config(): any {
  return JSON.parse(readFileSync(join(home, '.suntropy', 'config.json'), 'utf-8'));
}

function writeConfig(connect: Record<string, unknown>): void {
  mkdirSync(join(home, '.suntropy'), { recursive: true });
  writeFileSync(
    join(home, '.suntropy', 'config.json'),
    JSON.stringify({
      activeProfile: 'default',
      profiles: { default: { server: 'https://api.enerlence.com', connect: { gateway: gw.url, clientId: 'suntropy-cli', ...connect } } },
    }),
  );
}

const LOGGED_IN = {
  accessToken: 'pvo_initial',
  refreshToken: 'r-initial',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  scope: 'pvsyst connections:write',
};

before(async () => {
  gw = await startMockGateway();
});
after(async () => {
  await gw.close();
});
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'suntropy-cli-test-'));
  gw.calls.length = 0;
  Object.assign(gw.state, { approveAfterPolls: 1, polls: 0, deny: false, scope: 'pvsyst connections:write', links: {} });
});

describe('connect login', () => {
  it('sin terminal: devuelve el enlace y el código sin esperar, y guarda el login pendiente', async () => {
    const r = await cli(['connect', 'login']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.status, 'pending');
    assert.equal(r.json.userCode, 'ABCD-EFGH');
    assert.match(r.json.verificationUriComplete, /authorize-connector\?user_code=ABCD-EFGH/);
    assert.equal(r.json.next, 'suntropy connect login --continue');
    assert.equal(config().profiles.default.connect.pending.deviceCode, 'dc-' + gw.state.deviceCounter);
    assert.ok(!gw.calls.some((c) => c.path === '/token'), 'no sondea sin --wait');
    assert.equal(gw.calls[0].body.client_id, 'suntropy-cli');
  });

  it('--continue sondea /token hasta la aprobación y guarda la sesión sin imprimir tokens', async () => {
    await cli(['connect', 'login']);
    const r = await cli(['connect', 'login', '--continue', '--timeout', '20']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.authenticated, true);
    assert.equal(r.json.canAddConnectionsDirectly, true);
    assert.ok(!r.stdout.includes('pvo_') && !r.stderr.includes('pvo_'), 'no imprime el access token');
    assert.ok(!/"r\d+"/.test(r.stdout), 'no imprime el refresh');
    const c = config().profiles.default.connect;
    assert.match(c.accessToken, /^pvo_tok/);
    assert.ok(c.refreshToken);
    assert.equal(c.pending, undefined);
    assert.ok(gw.calls.filter((x) => x.path === '/token').length >= 2, 'ha sondeado al menos dos veces');
    const mode = statSync(join(home, '.suntropy', 'config.json')).mode & 0o777;
    assert.equal(mode, 0o600);
  });

  it('access_denied limpia el login pendiente', async () => {
    await cli(['connect', 'login']);
    gw.state.deny = true;
    const r = await cli(['connect', 'login', '--continue']);
    assert.equal(r.code, 1);
    assert.equal(r.err.code, 'access_denied');
    assert.equal(config().profiles.default.connect.pending, undefined);
  });

  it('--email manda el código y --code lo verifica y canjea los tokens', async () => {
    const r1 = await cli(['connect', 'login', '--email', 'ana@instaladora.es', '--utm-campaign', 'alarmas-growatt']);
    assert.equal(r1.code, 0, r1.stderr);
    assert.equal(r1.json.status, 'code_sent');
    assert.equal(r1.json.next, 'suntropy connect login --code <código>');
    const sent = gw.calls.find((c) => c.path === '/device_authorization/email')!;
    assert.equal(sent.body.email, 'ana@instaladora.es');
    assert.equal(sent.body.utm_campaign, 'alarmas-growatt');
    assert.equal(sent.body.client_id, 'suntropy-cli');

    gw.state.approveAfterPolls = 1000; // sólo aprueba la verificación del correo
    const r2 = await cli(['connect', 'login', '--code', '111111']);
    assert.equal(r2.code, 0, r2.stderr);
    assert.equal(r2.json.authenticated, true);
    assert.equal(r2.json.email, 'ana@instaladora.es');
    assert.equal(r2.json.trial.days, 7);
    const verify = gw.calls.find((c) => c.path === '/device_authorization/email/verify')!;
    assert.equal(verify.body.device_code, sent.body.device_code, 'mismo device_code entre invocaciones');
  });

  it('reenviar el correo reutiliza el device_code pendiente', async () => {
    await cli(['connect', 'login', '--email', 'ana@instaladora.es']);
    await cli(['connect', 'login', '--email', 'ana@instaladora.es']);
    const emails = gw.calls.filter((c) => c.path === '/device_authorization/email');
    assert.equal(emails.length, 2);
    assert.equal(emails[0].body.device_code, emails[1].body.device_code);
    assert.equal(gw.calls.filter((c) => c.path === '/device_authorization').length, 1);
  });

  it('código incorrecto: error con intentos restantes y el login sigue pendiente', async () => {
    await cli(['connect', 'login', '--email', 'ana@instaladora.es']);
    const r = await cli(['connect', 'login', '--code', '222222']);
    assert.equal(r.code, 1);
    assert.equal(r.err.code, 'invalid_code');
    assert.equal(r.err.attemptsLeft, 3);
    assert.ok(config().profiles.default.connect.pending.email);
  });

  it('402 sin licencia: devuelve el enlace para la prueba y el siguiente paso', async () => {
    await cli(['connect', 'login', '--email', 'ana@instaladora.es']);
    const r = await cli(['connect', 'login', '--code', '333333']);
    assert.equal(r.code, 1);
    assert.equal(r.err.code, 'licence_inactive');
    assert.equal(r.err.trialEligible, true);
    assert.match(r.err.verificationUriComplete, /authorize-connector/);
    assert.equal(r.err.next, 'suntropy connect login --continue');
    assert.match(r.err.message, /prueba de 7 días/);
    assert.ok(config().profiles.default.connect.pending, 'el device_code sigue pendiente');
  });

  it('correo no válido', async () => {
    const r = await cli(['connect', 'login', '--email', 'no-es-un-email']);
    assert.equal(r.code, 1);
    assert.equal(r.err.code, 'invalid_email');
  });

  it('--code sin login pendiente', async () => {
    const r = await cli(['connect', 'login', '--code', '111111']);
    assert.equal(r.code, 1);
    assert.equal(r.err.code, 'no_pending_login');
  });

  it('respeta --profile global', async () => {
    const r = await cli(['--profile', 'cliente', 'connect', 'login']);
    assert.equal(r.code, 0, r.stderr);
    assert.ok(config().profiles.cliente.connect.pending);
    assert.equal(config().profiles.default?.connect, undefined);
  });
});

describe('connect: lecturas por MCP', () => {
  it('summary llama a get_monitoring_summary con las cabeceras de la revisión 2026-07-28', async () => {
    writeConfig(LOGGED_IN);
    const r = await cli(['connect', 'summary', '--provider', 'huawei']);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json, { tool: 'get_monitoring_summary', args: { provider: 'huawei' } });
    const call = gw.calls.find((c) => c.path === '/monitoring/mcp')!;
    assert.equal(call.headers['authorization'], 'Bearer pvo_initial');
    assert.equal(call.headers['mcp-name'], 'get_monitoring_summary');
    assert.equal(call.body.params._meta['io.modelcontextprotocol/protocolVersion'], '2026-07-28');
  });

  it('mapea argumentos de plants, plant-status, energy, devices y alarms', async () => {
    writeConfig(LOGGED_IN);
    const cases: Array<[string[], unknown]> = [
      [['plants', '--query', 'Pérez', '--limit', '5'], { tool: 'list_plants', args: { query: 'Pérez', limit: 5 } }],
      [['plant-status', 'p1', 'p2'], { tool: 'get_plant_status', args: { plantIds: ['p1', 'p2'] } }],
      [
        ['energy', 'p1', '--granularity', 'month', '--from', '2026-01-01'],
        { tool: 'get_plant_energy', args: { plantId: 'p1', metric: 'pv_yield', granularity: 'month', from: '2026-01-01' } },
      ],
      [['devices', 'p1'], { tool: 'list_devices', args: { plantId: 'p1' } }],
      [['connections'], { tool: 'list_connections', args: {} }],
      [
        ['alarms', '--plant', 'p1', '--plant', 'p2', '--severity', 'critical,major', '--unread-only'],
        { tool: 'list_alarms', args: { plantIds: ['p1', 'p2'], severity: ['critical', 'major'], unreadOnly: true } },
      ],
      [['alarms', 'watch', 'get'], { tool: 'get_alarm_watch', args: {} }],
      [['alarms', 'watch', 'set', '--enabled', 'true'], { tool: 'set_alarm_watch', args: { enabled: true, provider: 'all' } }],
      [['call', 'get_plant_power_curve', '--args', '{"plantId":"p1","date":"2026-11-09"}'], { tool: 'get_plant_power_curve', args: { plantId: 'p1', date: '2026-11-09' } }],
    ];
    for (const [args, expected] of cases) {
      const r = await cli(['connect', ...args]);
      assert.equal(r.code, 0, `${args.join(' ')}: ${r.stderr}`);
      assert.deepEqual(r.json, expected, args.join(' '));
    }
  });

  it('alarms watch set con --provider de una marca', async () => {
    writeConfig(LOGGED_IN);
    const r = await cli(['connect', 'alarms', 'watch', 'set', '--enabled', 'false', '--provider', 'huawei']);
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.json, { tool: 'set_alarm_watch', args: { enabled: false, provider: 'huawei' } });
  });

  it('renueva el token caducado con el refresh (que rota) antes de llamar', async () => {
    const first = await cli(['connect', 'login', '--continue']); // sin pendiente: error
    assert.equal(first.code, 1);
    // Sesión real del simulador: login completo.
    await cli(['connect', 'login']);
    await cli(['connect', 'login', '--continue']);
    const c0 = config().profiles.default.connect;
    c0.expiresAt = new Date(Date.now() - 1000).toISOString();
    writeConfig(c0);
    const r = await cli(['connect', 'connections']);
    assert.equal(r.code, 0, r.stderr);
    const c1 = config().profiles.default.connect;
    assert.notEqual(c1.accessToken, c0.accessToken);
    assert.notEqual(c1.refreshToken, c0.refreshToken);
    assert.ok(Date.parse(c1.expiresAt) > Date.now());
  });

  it('401 con refresh revocado: pide login otra vez y borra la sesión', async () => {
    writeConfig({ ...LOGGED_IN, accessToken: 'pvo_expired', refreshToken: 'revocado' });
    const r = await cli(['connect', 'summary']);
    assert.equal(r.code, 1);
    assert.equal(r.err.code, 'session_expired');
    assert.match(r.err.message, /connect login/);
    assert.equal(config().profiles.default.connect.accessToken, undefined);
  });

  it('sin sesión: not_logged_in', async () => {
    const r = await cli(['connect', 'summary']);
    assert.equal(r.code, 1);
    assert.equal(r.err.code, 'not_logged_in');
  });

  it('SUNTROPY_CONNECT_TOKEN sustituye a la sesión guardada', async () => {
    const r = await cli(['connect', 'connections'], { env: { SUNTROPY_CONNECT_TOKEN: 'pvo_env' } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(gw.calls.find((c) => c.path === '/monitoring/mcp')!.headers['authorization'], 'Bearer pvo_env');
  });

  it('herramienta desconocida y error de herramienta', async () => {
    writeConfig(LOGGED_IN);
    const a = await cli(['connect', 'call', 'nope']);
    assert.equal(a.err.code, 'tool_not_available');
    const b = await cli(['connect', 'call', 'failing']);
    assert.equal(b.err.code, 'tool_error');
    assert.equal(b.err.message, 'quota exceeded');
  });

  it('status no enseña tokens', async () => {
    writeConfig(LOGGED_IN);
    const r = await cli(['connect', 'status']);
    assert.equal(r.json.authenticated, true);
    assert.ok(!r.stdout.includes('pvo_') && !r.stdout.includes('r-initial'));
  });

  it('logout borra la sesión del perfil', async () => {
    writeConfig(LOGGED_IN);
    const r = await cli(['connect', 'logout']);
    assert.equal(r.json.hadSession, true);
    assert.equal(config().profiles.default.connect, undefined);
  });
});

describe('connect add', () => {
  it('por defecto crea un enlace y lo devuelve', async () => {
    writeConfig(LOGGED_IN);
    const r = await cli(['connect', 'add', 'huawei', '--label', 'Cliente Pérez']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.id, 'lk1');
    assert.match(r.json.url, /add=huawei&link=lk1/);
    assert.equal(r.json.next, 'suntropy connect link-status lk1');
    const call = gw.calls.find((c) => c.path === '/integrations/connection-links')!;
    assert.deepEqual(call.body, { provider: 'huawei', label: 'Cliente Pérez' });
  });

  it('--wait sondea el enlace hasta done', async () => {
    writeConfig(LOGGED_IN);
    const r = await cli(['connect', 'add', 'huawei', '--wait', '--timeout', '60']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.state, 'done');
    assert.equal(r.json.connectionId, 'c1');
  });

  it('link-status de un enlace que no existe', async () => {
    writeConfig(LOGGED_IN);
    const r = await cli(['connect', 'link-status', 'zzz']);
    assert.equal(r.err.code, 'not_found');
  });

  it('directa: pide el secreto por stdin y no lo imprime', async () => {
    writeConfig(LOGGED_IN);
    const r = await cli(
      ['connect', 'add', 'huawei', '--field', 'host=eu5.fusionsolar.huawei.com', '--field', 'username=api'],
      { stdin: 'S3cr3t-no-imprimir\n' },
    );
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.success, true);
    assert.equal(r.json.connection.id, 'c1');
    assert.ok(!r.stdout.includes('S3cr3t') && !r.stderr.includes('S3cr3t'));
    const call = gw.calls.find((c) => c.path === '/integrations/connections')!;
    assert.deepEqual(call.body.fields, { host: 'eu5.fusionsolar.huawei.com', username: 'api', password: 'S3cr3t-no-imprimir' });
  });

  it('directa con --verbose tampoco enseña el secreto', async () => {
    writeConfig(LOGGED_IN);
    const r = await cli(
      ['--verbose', 'connect', 'add', 'huawei', '--field', 'host=h', '--field', 'username=u', '--field', 'password'],
      { stdin: 'S3cr3t-no-imprimir\n' },
    );
    assert.equal(r.code, 0, r.stderr);
    assert.ok(r.stderr.includes('POST'), 'verbose activo');
    assert.ok(!r.stderr.includes('S3cr3t') && !r.stderr.includes('pvo_'));
  });

  it('directa: faltan campos no secretos', async () => {
    writeConfig(LOGGED_IN);
    const r = await cli(['connect', 'add', 'huawei', '--field', 'host=h'], { stdin: 'x\n' });
    assert.equal(r.err.code, 'missing_fields');
    assert.deepEqual(r.err.missing, ['username']);
    assert.ok(!gw.calls.some((c) => c.path === '/integrations/connections'));
  });

  it('directa en una marca sólo por enlace', async () => {
    writeConfig(LOGGED_IN);
    const r = await cli(['connect', 'add', 'sungrow', '--field', 'region=eu']);
    assert.equal(r.err.code, 'link_only');
  });

  it('directa sin connections:write: 403 con la alternativa del enlace', async () => {
    writeConfig(LOGGED_IN);
    gw.state.scope = 'pvsyst';
    const r = await cli(['connect', 'add', 'huawei', '--field', 'host=h', '--field', 'username=u', '--field', 'password'], {
      stdin: 'x\n',
    });
    assert.equal(r.err.code, 'insufficient_scope');
    assert.equal(r.err.next, 'suntropy connect add huawei');
  });
});

describe('mcp add', () => {
  it('claude-code --print devuelve el comando', async () => {
    const r = await cli(['mcp', 'add', '--client', 'claude-code', '--print']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.command, `claude mcp add --transport http --scope user suntropy-connect ${gw.url}/monitoring/mcp`);
    assert.equal(r.json.installed, false);
  });

  it('codex --print con la configuración TOML y el login', async () => {
    const r = await cli(['mcp', 'add', '--client', 'codex', '--print', '--brand', 'huawei']);
    assert.equal(r.json.command, `codex mcp add suntropy-connect --url ${gw.url}/huawei/mcp`);
    assert.match(r.json.config, /\[mcp_servers\.suntropy-connect\]/);
    assert.ok(r.json.next.some((s: string) => s.startsWith('codex mcp login suntropy-connect')));
  });

  it('sin el binario en el PATH explica el comando en vez de fallar', async () => {
    const r = await cli(['mcp', 'add', '--client', 'codex'], { env: { PATH: '/nonexistent' } });
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.installed, false);
    assert.match(r.json.message, /No se encuentra `codex`/);
  });

  it('cursor escribe ~/.cursor/mcp.json conservando lo que hubiera', async () => {
    mkdirSync(join(home, '.cursor'), { recursive: true });
    writeFileSync(join(home, '.cursor', 'mcp.json'), JSON.stringify({ mcpServers: { otro: { command: 'x' } } }));
    const r = await cli(['mcp', 'add', '--client', 'cursor']);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.json.installed, true);
    const file = JSON.parse(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf-8'));
    assert.deepEqual(file.mcpServers.otro, { command: 'x' });
    assert.deepEqual(file.mcpServers['suntropy-connect'], { url: `${gw.url}/monitoring/mcp` });
    assert.match(r.json.deeplink, /^cursor:\/\/anysphere\.cursor-deeplink\/mcp\/install\?name=suntropy-connect&config=/);
  });

  it('cursor --print no escribe nada', async () => {
    const r = await cli(['mcp', 'add', '--client', 'cursor', '--print']);
    assert.equal(r.json.installed, false);
    assert.ok(!existsSync(join(home, '.cursor', 'mcp.json')));
  });

  it('claude-ai y chatgpt devuelven pasos con la URL', async () => {
    const a = await cli(['mcp', 'add', '--client', 'claude-ai']);
    assert.match(a.json.installLink, /modal=add-custom-connector/);
    assert.ok(a.json.installLink.includes(encodeURIComponent(`${gw.url}/monitoring/mcp`)));
    const b = await cli(['mcp', 'add', '--client', 'chatgpt']);
    assert.ok(b.json.steps.some((s: string) => s.includes(`${gw.url}/monitoring/mcp`)));
  });

  it('cliente desconocido', async () => {
    const r = await cli(['mcp', 'add', '--client', 'vim']);
    assert.equal(r.code, 1);
  });
});

describe('perfiles de acceso', () => {
  it('con read: login y lecturas siguen; add, watch set y call desaparecen', async () => {
    const env = { SUNTROPY_COMMAND_PROFILE: 'read' };
    writeConfig(LOGGED_IN);
    assert.equal((await cli(['connect', 'summary'], { env })).code, 0);
    assert.equal((await cli(['connect', 'login'], { env })).code, 0);
    assert.equal((await cli(['connect', 'alarms', 'watch', 'get'], { env })).code, 0);
    for (const args of [['connect', 'add', 'huawei'], ['connect', 'alarms', 'watch', 'set', '--enabled', 'true'], ['connect', 'call', 'x']]) {
      const r = await cli(args, { env });
      assert.notEqual(r.code, 0, args.join(' '));
      assert.match(r.stderr, /unknown command/, args.join(' '));
    }
  });
});
