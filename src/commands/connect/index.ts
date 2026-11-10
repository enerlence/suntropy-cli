import { Command, Option } from 'commander';
import { loadConfig } from '../../config.js';
import { output, type OutputOptions } from '../../output.js';
import {
  ConnectError,
  authedRequest,
  callTool,
  errorText,
  mcpRequest,
  profileNameOf,
  readCredentials,
  resolveGateway,
  updateCredentials,
  ENV_TOKEN,
  type GatewayContext,
} from '../../connect/gateway.js';
import {
  getPending,
  pendingResult,
  pollToken,
  sendEmailCode,
  startDevice,
  verifyEmailCode,
} from '../../connect/login.js';
import { ask, isInteractive, sleep } from '../../connect/prompt.js';

type GlobalOpts = OutputOptions & { profile?: string; verbose?: boolean };

function rootOf(cmd: Command): Command {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root;
}

/** Tiempo de espera por defecto: sin terminal, poco (un agente no puede enseñar nada mientras espera). */
const AGENT_WAIT_S = 110;

/** Escribe un aviso para la persona por stderr (nunca con secretos). */
function notice(global: GlobalOpts, line: string): void {
  if (!global.quiet) process.stderr.write(line + '\n');
}

/** Salida de error estructurada, con `code` estable y lo que haga falta para seguir. */
function fail(err: unknown): void {
  if (err instanceof ConnectError) {
    const out: Record<string, unknown> = { error: true, code: err.code, message: err.message };
    if (err.status) out.status = err.status;
    Object.assign(out, err.extra);
    process.stderr.write(JSON.stringify(out) + '\n');
  } else {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(JSON.stringify({ error: true, message: msg }) + '\n');
  }
  process.exitCode = 1;
}

function intOpt(v: string): number {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) throw new Error(`No es un número: ${v}`);
  return n;
}

function collect(value: string, prev: string[] = []): string[] {
  return [...prev, value];
}

function compact(obj: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));
}

export function registerConnectCommands(program: Command): void {
  const connect = program
    .command('connect')
    .description(
      'Suntropy Connect: monitorización de inversores (todas las marcas conectadas) para agentes.\n' +
        'Login sin contraseña (enlace o código por correo), plantas, energía, alarmas y alta de\n' +
        'cuentas de fabricantes. Habla con el gateway de Connect, no con la API de Suntropy:\n' +
        'su sesión es independiente de `suntropy auth`.\n' +
        'Empieza por: suntropy connect login --email <correo>   (o sin --email: enlace)',
    )
    .option('--gateway <url>', 'Gateway de Suntropy Connect (por defecto https://connect-gateway.suntropy.ai o SUNTROPY_CONNECT_GATEWAY)');

  const ctxOf = (): { ctx: GatewayContext; global: GlobalOpts } => {
    const global = rootOf(connect).opts() as GlobalOpts;
    const config = loadConfig();
    const profileName = profileNameOf(config, global.profile);
    const stored = config.profiles[profileName]?.connect?.gateway;
    const gateway = resolveGateway(connect.opts().gateway as string | undefined, stored);
    return { ctx: { profileName, gateway, verbose: Boolean(global.verbose) }, global };
  };

  /** Comando de lectura sobre una herramienta del MCP. */
  const toolAction =
    (tool: string, build: (...a: any[]) => Record<string, unknown>) =>
    async (...a: any[]) => {
      try {
        const { ctx, global } = ctxOf();
        const data = await callTool(ctx, tool, compact(build(...a)));
        output(data, global);
      } catch (err) {
        fail(err);
      }
    };

  // ─── login ────────────────────────────────────────────────────────────
  connect
    .command('login')
    .summary('Login o alta sin contraseña (código por correo o enlace)')
    .description(
      'Inicia sesión o da de alta al usuario en Suntropy Connect sin contraseña.\n' +
        '\n' +
        'Por correo (recomendado para agentes):\n' +
        '  suntropy connect login --email ana@instaladora.es   → manda un código de 6 dígitos\n' +
        '  suntropy connect login --code 482913                → lo verifica y guarda la sesión\n' +
        '  Si el correo no tiene cuenta, se crea (Suntropy Starter + Suntropy AI, con la prueba de\n' +
        '  7 días de Connect si es elegible). El usuario también puede pulsar «Aprobar acceso» en el\n' +
        '  correo y luego: suntropy connect login --continue\n' +
        '\n' +
        'Por enlace:\n' +
        '  suntropy connect login             → enlace + código para aprobar en app.suntropy.ai\n' +
        '  suntropy connect login --continue  → espera a que lo apruebe y guarda la sesión\n' +
        '\n' +
        'Sin terminal (agentes) no se queda esperando: devuelve el enlace o el siguiente paso en\n' +
        '`next`. Con terminal espera la aprobación o pide el código.',
    )
    .option('--email <email>', 'Correo del usuario: le llega un código de 6 dígitos (alta o login)')
    .option('--code <code>', 'Código de 6 dígitos del correo (segundo paso de --email)')
    .option('--continue', 'Sigue esperando la aprobación del login pendiente')
    .option('--wait', 'Espera la aprobación aunque no haya terminal')
    .option('--no-wait', 'No esperes: devuelve el enlace o el siguiente paso y termina')
    .option('--timeout <s>', 'Segundos máximos de espera', intOpt)
    .option('--utm-campaign <v>', 'Artículo o página de origen (queda en el alta)')
    .option('--utm-content <v>', 'Bloque o variante de origen')
    .option('--utm-source <v>', 'Origen (por defecto ia-agente)')
    .option('--utm-medium <v>', 'Medio (por defecto cli)')
    .addOption(new Option('--resource <url>', 'MCP para el que se pide el token (por defecto /monitoring/mcp)').hideHelp())
    .action(async (opts) => {
      try {
        const { ctx, global } = ctxOf();
        const interactive = isInteractive();
        const wait: boolean = opts.wait ?? interactive;
        const timeoutMs = (opts.timeout ?? (interactive ? 1800 : AGENT_WAIT_S)) * 1000;

        if (opts.code) {
          output(await verifyEmailCode(ctx, String(opts.code), timeoutMs), global);
          return;
        }

        if (opts.continue) {
          const pending = getPending(ctx);
          if (!pending) {
            throw new ConnectError(
              'No hay ningún login pendiente (o ha caducado). Empieza con `suntropy connect login`.',
              'no_pending_login',
            );
          }
          notice(global, `Esperando a que se apruebe el acceso (código ${pending.userCode})…`);
          output(await pollToken(ctx, pending, timeoutMs), global);
          return;
        }

        if (opts.email) {
          const pending = await sendEmailCode(ctx, {
            email: String(opts.email).trim(),
            resource: opts.resource,
            utm: {
              utm_source: opts.utmSource,
              utm_medium: opts.utmMedium,
              utm_campaign: opts.utmCampaign,
              utm_content: opts.utmContent,
            },
          });
          const sent = {
            authenticated: false,
            status: 'code_sent',
            profile: ctx.profileName,
            email: pending.email,
            userCode: pending.userCode,
            codeExpiresAt: pending.emailCodeExpiresAt,
            message:
              `Se ha enviado un código de 6 dígitos a ${pending.email} (si no tiene cuenta, se crea). ` +
              'Pide al usuario que te lo diga. También puede pulsar «Aprobar acceso» en el correo.',
            next: 'suntropy connect login --code <código>',
            alternative: 'suntropy connect login --continue   (si el usuario aprueba desde el botón del correo)',
          };
          if (!interactive || opts.wait === false) {
            output(sent, global);
            return;
          }
          notice(global, `Hemos enviado un código de 6 dígitos a ${pending.email}. Revisa también el spam.`);
          const code = await ask('Código: ');
          output(await verifyEmailCode(ctx, code, timeoutMs), global);
          return;
        }

        // Enlace + código.
        const pending = getPending(ctx) ?? (await startDevice(ctx, opts.resource));
        notice(
          global,
          `Abre ${pending.verificationUriComplete}\n` +
            `e inicia sesión en Suntropy (o crea la cuenta). Comprueba que el código es ${pending.userCode} y aprueba el acceso.`,
        );
        if (!wait) {
          output(pendingResult(ctx, pending), global);
          return;
        }
        output(await pollToken(ctx, pending, timeoutMs), global);
      } catch (err) {
        fail(err);
      }
    });

  // ─── status / logout ──────────────────────────────────────────────────
  connect
    .command('status')
    .description('Estado de la sesión de Suntropy Connect (sin mostrar tokens)')
    .action(() => {
      try {
        const { ctx, global } = ctxOf();
        const c = readCredentials(ctx.profileName);
        const pending = getPending(ctx);
        const fromEnv = Boolean(process.env[ENV_TOKEN]);
        const expired = c?.expiresAt ? Date.parse(c.expiresAt) <= Date.now() : false;
        output(
          compact({
            authenticated: fromEnv || Boolean(c?.accessToken && (!expired || c.refreshToken)),
            source: fromEnv ? ENV_TOKEN : c?.accessToken ? 'profile' : undefined,
            profile: ctx.profileName,
            gateway: ctx.gateway,
            email: c?.email,
            scope: c?.scope,
            canAddConnectionsDirectly: c?.scope ? c.scope.split(/\s+/).includes('connections:write') : undefined,
            expiresAt: c?.expiresAt,
            renewable: c?.accessToken ? Boolean(c.refreshToken) : undefined,
            pendingLogin: pending
              ? compact({ userCode: pending.userCode, email: pending.email, expiresAt: pending.expiresAt })
              : undefined,
          }),
          global,
        );
      } catch (err) {
        fail(err);
      }
    });

  connect
    .command('logout')
    .summary('Borra la sesión de Connect de este perfil')
    .description(
      'Borra la sesión de Connect guardada en este perfil. Para revocar el acceso en el servidor,\n' +
        'quítalo en Suntropy: Configuración > Suntropy Connect > Asistentes conectados.',
    )
    .action(() => {
      try {
        const { ctx, global } = ctxOf();
        const had = Boolean(readCredentials(ctx.profileName)?.accessToken);
        updateCredentials(ctx.profileName, ctx.gateway, () => undefined);
        output({ success: true, profile: ctx.profileName, hadSession: had }, global);
      } catch (err) {
        fail(err);
      }
    });

  // ─── lecturas ─────────────────────────────────────────────────────────
  const providerOpt = '--provider <marca>';
  const providerHelp = 'Sólo esta marca: huawei, goodwe, sungrow, deye, solis, enphase, growatt, fronius';

  connect
    .command('summary')
    .description('Resumen por cuenta: plantas sanas, con fallo y desconectadas, kWp y energía de hoy y del mes. Empieza aquí.')
    .option(providerOpt, providerHelp)
    .option('--connection-id <id>', 'Sólo esta cuenta (id de `connect connections`)')
    .action(toolAction('get_monitoring_summary', (o) => ({ provider: o.provider, connectionId: o.connectionId })));

  connect
    .command('connections')
    .description('Cuentas de fabricantes conectadas, con su estado y el último error')
    .action(toolAction('list_connections', () => ({})));

  connect
    .command('plants')
    .description('Plantas visibles (paginado). Para el estado usa `connect plant-status`.')
    .option('--query <texto>', 'Busca en nombre, dirección o id')
    .option(providerOpt, providerHelp)
    .option('--connection-id <id>', 'Sólo esta cuenta')
    .option('--limit <n>', 'Plantas por página', intOpt)
    .option('--offset <n>', 'Plantas a saltar (nextOffset de la página anterior)', intOpt)
    .action(
      toolAction('list_plants', (o) => ({
        query: o.query,
        provider: o.provider,
        connectionId: o.connectionId,
        limit: o.limit,
        offset: o.offset,
      })),
    );

  connect
    .command('plant-status <plantIds...>')
    .description('Estado en tiempo real de una o varias plantas (pide todas las que necesites en una llamada, hasta 100)')
    .action(toolAction('get_plant_status', (ids: string[]) => ({ plantIds: ids })));

  connect
    .command('energy <plantId>')
    .summary('Serie de UNA métrica de energía de una planta')
    .description(
      'Serie de UNA métrica de energía de una planta.\n' +
        'Ej.: suntropy connect energy <plantId> --metric pv_yield --granularity day --from 2026-11-01 --to 2026-11-09',
    )
    .option(
      '--metric <m>',
      'pv_yield, consumption, grid_export, grid_import, self_consumption, battery_charge, battery_discharge, inverter_yield, irradiation, performance_ratio, specific_yield, income',
      'pv_yield',
    )
    .option('--granularity <g>', '5min, hour, day, month, year', 'day')
    .option('--from <YYYY-MM-DD>', 'Primer día (incluido)')
    .option('--to <YYYY-MM-DD>', 'Último día (incluido)')
    .option('--last-hours <n>', 'Últimas N horas (sólo con 5min u hour)', intOpt)
    .action(
      toolAction('get_plant_energy', (plantId: string, o) => ({
        plantId,
        metric: o.metric,
        granularity: o.granularity,
        from: o.from,
        to: o.to,
        lastHours: o.lastHours,
      })),
    );

  connect
    .command('power-curve <plantId>')
    .description('Curva de potencia de un día cada 5 min (FV, consumo, red, batería), en kW')
    .requiredOption('--date <YYYY-MM-DD>', 'Día, en hora local de la planta')
    .action(toolAction('get_plant_power_curve', (plantId: string, o) => ({ plantId, date: o.date })));

  connect
    .command('devices <plantId>')
    .description('Inversores, baterías, contadores y demás equipos de una planta')
    .action(toolAction('list_devices', (plantId: string) => ({ plantId })));

  connect
    .command('device-realtime <deviceIds...>')
    .description('Última lectura de uno o varios equipos (pide varios en una llamada)')
    .action(toolAction('get_device_realtime', (ids: string[]) => ({ deviceIds: ids })));

  connect
    .command('device-history <deviceId>')
    .description('Lecturas cada 5 min de UN equipo, como mucho 24 h')
    .requiredOption('--from <iso>', 'Inicio, p. ej. 2026-11-09T00:00:00+01:00')
    .requiredOption('--to <iso>', 'Fin, como mucho 24 h después')
    .action(toolAction('get_device_history', (deviceId: string, o) => ({ deviceId, from: o.from, to: o.to })));

  // ─── alarmas ──────────────────────────────────────────────────────────
  const alarms = connect
    .command('alarms')
    .summary('Alarmas de los inversores (y `alarms watch get|set`)')
    .description(
      'Alarmas de los inversores, las más graves primero. Con la vigilancia activada (`connect alarms\n' +
        'watch get`), también las cerradas de los últimos 30 días y el estado leído/no leído.',
    )
    .option('--plant <plantId>', 'Sólo esta planta (repetible)', collect)
    .option(providerOpt, providerHelp)
    .option('--state <s>', 'open (por defecto), cleared o all')
    .option('--severity <lista>', 'critical,major,minor,warning (separadas por comas)')
    .option('--min-severity <s>', 'Esta gravedad y las mayores')
    .option('--from <iso>', 'Alarmas desde este instante')
    .option('--to <iso>', 'Alarmas hasta este instante')
    .option('--unread-only', 'Sólo las no leídas')
    .option('--limit <n>', 'Tamaño de página (máx. 200)', intOpt)
    .option('--cursor <c>', 'nextCursor de la página anterior')
    .action(
      toolAction('list_alarms', (o) => ({
        plantIds: o.plant,
        provider: o.provider,
        state: o.state,
        severity: o.severity ? String(o.severity).split(',').map((s: string) => s.trim()).filter(Boolean) : undefined,
        minSeverity: o.minSeverity,
        from: o.from,
        to: o.to,
        unreadOnly: o.unreadOnly ? true : undefined,
        limit: o.limit,
        cursor: o.cursor,
      })),
    );

  const watch = alarms.command('watch').description('Vigilancia periódica de alarmas por marca');
  watch
    .command('get')
    .description('Qué marcas tienen la vigilancia activada, última lectura y alarmas abiertas y sin leer')
    .action(toolAction('get_alarm_watch', () => ({})));
  watch
    .command('set')
    .description(
      'Activa o desactiva la vigilancia de alarmas. Desactivarla borra las alarmas guardadas de esa\n' +
        'marca: confírmalo con el usuario antes.\n' +
        'Ej.: suntropy connect alarms watch set --enabled true --provider all',
    )
    .requiredOption('--enabled <true|false>', 'true para vigilar, false para dejar de hacerlo')
    .option('--provider <marca|all>', 'Una marca o all (por defecto all)')
    .action(
      toolAction('set_alarm_watch', (o) => {
        const v = String(o.enabled).toLowerCase();
        if (!['true', 'false', 'on', 'off', '1', '0'].includes(v)) {
          throw new Error('--enabled tiene que ser true o false.');
        }
        // `alarms` también tiene --provider (filtro) y Commander se lo queda
        // aunque venga detrás de `watch set`: se lee de los dos.
        const provider = o.provider ?? (alarms.opts().provider as string | undefined) ?? 'all';
        return { enabled: ['true', 'on', '1'].includes(v), provider };
      }),
    );

  // ─── alta de cuentas de fabricantes ───────────────────────────────────
  connect
    .command('catalog [marca]')
    .description('Marcas que se pueden conectar y los campos que pide cada una (sin valores)')
    .action(toolAction('get_connection_catalog', (provider?: string) => ({ provider })));

  connect
    .command('add <marca>')
    .summary('Conecta una cuenta de un fabricante (enlace por defecto; --field para directa)')
    .description(
      'Conecta una cuenta de un fabricante (huawei, goodwe, sungrow, deye, solis, growatt, fronius…).\n' +
        '\n' +
        'Por defecto crea un ENLACE de un solo uso (15 min) para que el usuario meta sus credenciales\n' +
        'en Suntropy: el agente no las ve. Es lo recomendado.\n' +
        '  suntropy connect add huawei --label "Cliente Pérez"\n' +
        '  suntropy connect add huawei --wait          (espera a que el usuario termine)\n' +
        '  suntropy connect link-status <id>           (consulta el enlace más tarde)\n' +
        '\n' +
        'Directa (--field): el agente manda los valores. Los secretos que no vengan se piden ocultos\n' +
        'por la terminal o, sin terminal, una línea por secreto en stdin. Nunca se imprimen.\n' +
        '  suntropy connect add huawei --field host=eu5.fusionsolar.huawei.com --field username=api \\\n' +
        '    --field password          (pide la contraseña)\n' +
        '  printf \'%s\\n\' "$CLAVE" | suntropy connect add huawei --field host=… --field username=api --field password\n' +
        'Campos de cada marca: suntropy connect catalog <marca>',
    )
    .option('--label <texto>', 'Nombre de la cuenta, p. ej. el del cliente')
    .option('--field <clave[=valor]>', 'Conexión directa: campo del formulario (repetible; sin valor, se pide oculto)', collect)
    .option('--wait', 'Con enlace: espera a que el usuario complete la conexión')
    .option('--timeout <s>', 'Segundos máximos de espera con --wait', intOpt)
    .action(async (provider: string, opts) => {
      try {
        const { ctx, global } = ctxOf();
        const fields: string[] = opts.field ?? [];
        if (fields.length > 0) {
          output(await addDirect(ctx, global, provider, opts.label, fields), global);
          return;
        }
        const r = await authedRequest(ctx, 'POST', '/integrations/connection-links', {
          body: compact({ provider, label: opts.label }),
        });
        if (r.status !== 201 && r.status !== 200) {
          throw new ConnectError(
            linkError(r.status, r.data),
            String(r.data?.error ?? 'link_failed'),
            r.status,
          );
        }
        const link = r.data;
        const openUrl = link.authorizeUrl ?? link.url;
        const result: Record<string, unknown> = {
          ...link,
          state: 'pending',
          message:
            `Pide al usuario que abra ${openUrl} antes de ${link.expiresAt} ` +
            (link.authorizeUrl
              ? 'y autorice el acceso en la web del fabricante.'
              : 'y meta allí las credenciales de su cuenta (el agente no las ve).'),
          next: `suntropy connect link-status ${link.id}`,
        };
        if (!opts.wait) {
          output(result, global);
          return;
        }
        notice(global, String(result.message));
        const timeoutMs = (opts.timeout ?? (isInteractive() ? 900 : AGENT_WAIT_S)) * 1000;
        output(await waitLink(ctx, link.id, timeoutMs, result), global);
      } catch (err) {
        fail(err);
      }
    });

  connect
    .command('link-status <id>')
    .description('Estado de un enlace de `connect add`: pending, done (con connectionId) o expired')
    .option('--wait', 'Espera hasta que deje de estar pending')
    .option('--timeout <s>', 'Segundos máximos de espera', intOpt)
    .action(async (id: string, opts) => {
      try {
        const { ctx, global } = ctxOf();
        if (opts.wait) {
          const timeoutMs = (opts.timeout ?? (isInteractive() ? 900 : AGENT_WAIT_S)) * 1000;
          output(await waitLink(ctx, id, timeoutMs, {}), global);
        } else {
          output(await linkStatus(ctx, id), global);
        }
      } catch (err) {
        fail(err);
      }
    });

  // ─── MCP en crudo ─────────────────────────────────────────────────────
  connect
    .command('tools')
    .description('Herramientas del MCP de monitorización (nombre, título y argumentos)')
    .option('--full', 'Con descripciones completas')
    .action(async (opts) => {
      try {
        const { ctx, global } = ctxOf();
        const r = await mcpRequest(ctx, 'tools/list');
        const tools = (r?.tools ?? []) as any[];
        output(
          opts.full
            ? tools
            : tools.map((t) => ({
                name: t.name,
                title: t.title,
                arguments: Object.keys(t.inputSchema?.properties ?? {}),
                required: t.inputSchema?.required ?? [],
              })),
          global,
        );
      } catch (err) {
        fail(err);
      }
    });

  connect
    .command('call <tool>')
    .summary('Llama a cualquier herramienta del MCP con argumentos JSON')
    .description(
      'Llama a cualquier herramienta del MCP de monitorización con argumentos JSON.\n' +
        'Ej.: suntropy connect call get_plant_power_curve --args \'{"plantId":"…","date":"2026-11-09"}\'',
    )
    .option('--args <json>', 'Argumentos en JSON', '{}')
    .action(async (tool: string, opts) => {
      try {
        const { ctx, global } = ctxOf();
        let args: unknown;
        try {
          args = JSON.parse(opts.args);
        } catch {
          throw new Error('--args no es JSON válido.');
        }
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('--args tiene que ser un objeto JSON.');
        output(await callTool(ctx, tool, args as Record<string, unknown>), global);
      } catch (err) {
        fail(err);
      }
    });
}

// ─── enlaces ──────────────────────────────────────────────────────────────

function linkError(status: number, data: any): string {
  if (status === 404) {
    return 'Este gateway todavía no admite enlaces de alta (`/integrations/connection-links`). Conecta la cuenta en https://app.suntropy.ai, Configuración > Suntropy Connect > Conectores.';
  }
  if (status === 429) return `${errorText(data, 'Demasiados enlaces.')} (30 por hora y cuenta)`;
  return errorText(data, `HTTP ${status}`);
}

async function linkStatus(ctx: GatewayContext, id: string): Promise<any> {
  const r = await authedRequest(ctx, 'GET', `/integrations/connection-links/${encodeURIComponent(id)}`);
  if (r.status === 404) {
    throw new ConnectError(
      'Ese enlace no existe o caducó hace más de 1 hora. Crea otro con `suntropy connect add <marca>`.',
      'not_found',
      404,
    );
  }
  if (r.status !== 200) throw new ConnectError(linkError(r.status, r.data), String(r.data?.error ?? 'link_failed'), r.status);
  return r.data;
}

async function waitLink(ctx: GatewayContext, id: string, timeoutMs: number, base: Record<string, unknown>): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = await linkStatus(ctx, id);
    const state = s?.state ?? s?.status;
    if (state && state !== 'pending') {
      return {
        ...s,
        ...(state === 'done'
          ? { message: 'Cuenta conectada. Las plantas aparecen en `suntropy connect plants` (algunas marcas tardan unos minutos).' }
          : { message: 'El enlace ha caducado sin usarse. Crea otro con `suntropy connect add <marca>`.' }),
      };
    }
    if (Date.now() + 10_000 > deadline) {
      return { ...base, ...s, state: 'pending', next: `suntropy connect link-status ${id} --wait` };
    }
    await sleep(10_000);
  }
}

// ─── alta directa ─────────────────────────────────────────────────────────

const SECRET_KEY = /pass|secret|token|key|pwd|pin/i;

interface CatalogField {
  key: string;
  secret?: boolean;
  required?: boolean;
  label?: string;
}

async function catalogFields(ctx: GatewayContext, provider: string): Promise<{ fields: CatalogField[]; howToConnect?: string } | null> {
  try {
    const data: any = await callTool(ctx, 'get_connection_catalog', { provider });
    const list: any[] = Array.isArray(data) ? data : (data?.providers ?? data?.integrations ?? (data?.provider ? [data] : []));
    const spec = list.find((p) => p?.provider === provider || p?.id === provider);
    if (!spec) return null;
    return { fields: spec.fields ?? [], howToConnect: spec.howToConnect };
  } catch {
    // Gateway sin el catálogo para agentes: se sigue con lo que haya dado el usuario.
    return null;
  }
}

async function addDirect(
  ctx: GatewayContext,
  global: GlobalOpts,
  provider: string,
  label: string | undefined,
  raw: string[],
): Promise<unknown> {
  const values: Record<string, string> = {};
  const ask_: string[] = [];
  for (const f of raw) {
    const i = f.indexOf('=');
    if (i === -1) ask_.push(f.trim());
    else values[f.slice(0, i).trim()] = f.slice(i + 1);
  }

  const catalog = await catalogFields(ctx, provider);
  if (catalog?.howToConnect === 'link_only') {
    throw new ConnectError(
      `${provider} se autoriza en la web del fabricante: no admite alta directa. Usa \`suntropy connect add ${provider}\` (enlace).`,
      'link_only',
    );
  }
  const secretKeys = new Set(
    catalog ? catalog.fields.filter((f) => f.secret).map((f) => f.key) : [...ask_, ...Object.keys(values)].filter((k) => SECRET_KEY.test(k)),
  );
  if (catalog) {
    for (const f of catalog.fields) {
      if (f.required && !(f.key in values) && !ask_.includes(f.key)) {
        if (f.secret) ask_.push(f.key);
      }
    }
    const missing = catalog.fields.filter((f) => f.required && !f.secret && !(f.key in values) && !ask_.includes(f.key));
    if (missing.length) {
      throw new ConnectError(
        `Faltan campos de ${provider}: ${missing.map((f) => f.key).join(', ')}. Pásalos con --field clave=valor (\`suntropy connect catalog ${provider}\`).`,
        'missing_fields',
        undefined,
        { missing: missing.map((f) => f.key) },
      );
    }
  }
  if (Object.keys(values).some((k) => secretKeys.has(k))) {
    notice(global, 'Aviso: un secreto pasado en la línea de comandos queda en el historial. Mejor --field <clave> sin valor (se pide oculto).');
  }
  for (const key of ask_) {
    const meta = catalog?.fields.find((f) => f.key === key);
    const hidden = secretKeys.has(key) || !catalog;
    values[key] = await ask(`${meta?.label ?? key}${hidden ? ' (oculto)' : ''}: `, { hidden });
    if (!values[key]) throw new Error(`El campo ${key} está vacío.`);
  }

  const r = await authedRequest(ctx, 'POST', '/integrations/connections', {
    body: compact({ provider, label, fields: values }),
  });
  if (r.status === 201 || r.status === 200) {
    return {
      success: true,
      ...r.data,
      message: 'Cuenta conectada. Sus plantas aparecen en `suntropy connect plants`.',
    };
  }
  if (r.status === 403) {
    throw new ConnectError(
      'Este acceso no tiene permiso para añadir cuentas con credenciales (connections:write). ' +
        `Usa el enlace: \`suntropy connect add ${provider}\`, o vuelve a hacer login aprobando ese permiso.`,
      String(r.data?.error ?? 'insufficient_scope'),
      403,
      { next: `suntropy connect add ${provider}` },
    );
  }
  if (r.status === 422) {
    throw new ConnectError(`El fabricante ha rechazado las credenciales: ${errorText(r.data, 'credenciales no válidas')}`, 'provider_rejected', 422);
  }
  throw new ConnectError(errorText(r.data, `HTTP ${r.status}`), String(r.data?.error ?? 'connection_failed'), r.status);
}
