import { Command } from 'commander';
import chalk from 'chalk';
import { output, outputError, outputPaginated } from '../../output.js';
import {
  call,
  callMultipart,
  getGlobalOpts,
  parseId,
  parseIntOption,
  parseLatLng,
  readJsonArg,
  satvoltClient,
  satvoltError,
} from './api.js';

const TERMINAL_CAMPAIGN_STATES = new Set(['completed', 'failed', 'canceled']);

const CAMPAIGN_LIST_FIELDS =
  'idCampaign,name,state,source,totalLeads,maxLeads,leadsCompletionPercentage,creationTimestamp';

/**
 * --credit-limit <n> | --no-credit-limit | nothing.
 *
 * Commander turns the negated flag into `false`; leaving both out must send
 * nothing at all, so the backend applies its default cap.
 */
function creditLimitFromOpts(opts: Record<string, unknown>): number | null | undefined {
  if (opts.creditLimit === false) return null;
  if (opts.creditLimit === undefined) return undefined;
  const n = parseIntOption(String(opts.creditLimit), '--credit-limit');
  if (!n) throw new Error('--credit-limit must be greater than 0 (use --no-credit-limit for no cap)');
  return n;
}

/**
 * Where the campaign stands against its cap. It goes to stderr, like the usage
 * summary, because `credits` is a nested object and the human table would only
 * dump it as JSON.
 */
function creditSummary(campaign: any, campaignId: number | string): string {
  const credits = campaign?.credits;
  if (!credits) return '';
  const reserved = credits.reserved ? ` + ${credits.reserved} reserved` : '';
  const cap = credits.limit
    ? ` of ${credits.limit} · ${credits.remaining} left`
    : ' · no credit limit';
  let line = chalk.bold(`Credits: ${credits.spent ?? 0} spent${reserved}${cap}\n`);
  if (campaign?.pauseReason === 'credit_limit') {
    line += chalk.yellow(
      'Paused on its own after reaching that limit. Raise it with ' +
        `\`campaigns credit-limit ${campaignId} <credits>\` and then \`campaigns unpause ${campaignId}\`.\n`,
    );
  }
  return `${line}\n`;
}

/**
 * The credit cap 409 says what to do about it, not just that it happened: it
 * is the one error the caller fixes with another command. Same for a goal
 * (`limits`) the campaign already reached.
 */
function creditLimitError(err: unknown, campaignId: number | string) {
  const mapped = satvoltError(err);
  if (mapped.code === 'CREDIT_LIMIT_REACHED') {
    mapped.message =
      `${mapped.message} Raise it with: suntropy satvolt campaigns credit-limit ${campaignId} <credits> ` +
      '(or --off --yes to remove the cap).';
  }
  if (mapped.code === 'LIMIT_REACHED') {
    mapped.message =
      `${mapped.message} Raise or remove it with: suntropy satvolt campaigns limits ${campaignId} <key>=<value>|<key>=off.`;
  }
  return mapped;
}

/**
 * `key=value` pairs → limits patch. `off` (or `null`) removes that goal.
 * Keys are validated by the backend (see `satvolt catalog campaign-limits`).
 */
function parseLimitPairs(pairs: string[] | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const pair of pairs ?? []) {
    const match = /^([A-Za-z0-9_]+)=(.+)$/.exec(pair.trim());
    if (!match) throw new Error(`Invalid limit "${pair}": use key=value, e.g. completedLeads=200 or annualKwh=off`);
    const [, key, raw] = match;
    if (raw === 'off' || raw === 'null') {
      out[key] = null;
      continue;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`Invalid value for ${key}: "${raw}" (a positive number, or off)`);
    }
    out[key] = value;
  }
  return out;
}

const collect = (value: string, previous: string[] = []) => [...previous, value];

/**
 * How the campaign advances and where it stands against its goals. Goes to
 * stderr next to the credit summary, for the same reason.
 */
function deliverySummary(campaign: any, campaignId: number | string): string {
  let out = '';
  const progress = campaign?.sectorProgress;
  if (campaign?.executionMode === 'sectors' && progress) {
    const done = progress.settled + progress.skipped;
    out += chalk.bold(
      `Sector delivery: ${done} of ${progress.total} sectors done · ${progress.inFlight} in progress · ` +
        `${progress.waiting} waiting (${campaign.sectorsInFlight} at a time)\n`,
    );
    if (progress.waiting > 0) {
      out += chalk.dim(
        `Switch to a full sweep with \`campaigns full-sweep ${campaignId} --yes\` to search them all now.\n`,
      );
    }
  } else if (campaign?.executionMode === 'full') {
    out += chalk.bold('Full sweep: every sector searched at once\n');
  }
  const goals = (campaign?.limits ?? []).filter((l: any) => l.key !== 'credits');
  for (const goal of goals) {
    const pct = goal.value ? Math.min(100, Math.round((goal.current / goal.value) * 100)) : 0;
    const line = `Goal ${goal.key}: ${Math.round(goal.current)} of ${goal.value} ${goal.unit} (${pct}%)`;
    out += goal.reached ? chalk.green(`${line} · reached\n`) : `${line}\n`;
  }
  if (campaign?.pauseReason === 'limit_reached') {
    out += chalk.yellow(
      'Paused on its own after reaching a goal. Raise it with ' +
        `\`campaigns limits ${campaignId} <key>=<value>\` and then \`campaigns unpause ${campaignId}\`.\n`,
    );
  }
  return out ? `${out}\n` : '';
}

/**
 * Builds the `area` payload from the mutually exclusive area flags.
 * Polygons accept [[lat,lng],...], [{lat,lng},...] or GeoJSON (Polygon geometry
 * or Feature), whose coordinates are [lng,lat].
 */
function buildArea(opts: Record<string, string | undefined>) {
  const given = ['circle', 'polygon', 'bounds'].filter((k) => opts[k] !== undefined);
  if (given.length !== 1) {
    throw new Error('Pass exactly one area: --circle <lat,lng> --radius <m> | --polygon <json|@file> | --bounds <nwLat,nwLng,seLat,seLng>');
  }
  if (opts.circle !== undefined) {
    if (opts.radius === undefined) throw new Error('--circle requires --radius <meters>');
    return {
      type: 'circle',
      center: parseLatLng(opts.circle, '--circle'),
      radiusMeters: Number(opts.radius),
    };
  }
  if (opts.bounds !== undefined) {
    const n = opts.bounds.split(',').map((p) => Number(p.trim()));
    if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) {
      throw new Error('--bounds must be "nwLat,nwLng,seLat,seLng"');
    }
    return { type: 'bounds', northWest: [n[0], n[1]], southEast: [n[2], n[3]] };
  }
  const parsed = readJsonArg(opts.polygon as string, '--polygon');
  const geometry = parsed?.type === 'Feature' ? parsed.geometry : parsed;
  if (geometry?.type === 'Polygon') {
    const ring = geometry.coordinates?.[0] as [number, number][];
    if (!Array.isArray(ring)) throw new Error('GeoJSON Polygon has no outer ring');
    return { type: 'polygon', coordinates: ring.map(([lng, lat]) => [lat, lng]) };
  }
  if (!Array.isArray(parsed)) {
    throw new Error('--polygon must be an array of [lat,lng] points or a GeoJSON Polygon');
  }
  return { type: 'polygon', coordinates: parsed };
}

export function registerSatvoltCampaignCommands(satvolt: Command): void {
  const campaigns = satvolt
    .command('campaigns')
    .description(
      'Satvolt campaigns: list, create from an area, start, pause, cancel, reset, resume, ' +
        'credit-limit, usage, logs and funnel.',
    );

  // --- list ---
  campaigns
    .command('list')
    .description(
      'List campaigns, newest first.\n' +
        'Examples:\n' +
        '  suntropy satvolt campaigns list --state completed,inProgress\n' +
        '  suntropy satvolt campaigns list --search "Alcobendas" --format human',
    )
    .option('--limit <n>', 'Max results (max 200)', '50')
    .option('--offset <n>', 'Skip results', '0')
    .option('--search <text>', 'Match name, region or input address')
    .option('--state <states>', 'Comma-separated campaign states (see: satvolt catalog states)')
    .option('--source <source>', 'maps | excel | campaign')
    .action(async (opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        const client = satvoltClient(global);
        const page = await call(client, 'get', '/campaigns', {
          params: { limit: opts.limit, offset: opts.offset, search: opts.search, state: opts.state, source: opts.source },
        });
        const outOpts = { ...global, fields: global.fields ?? (global.format !== 'json' ? CAMPAIGN_LIST_FIELDS : undefined) };
        // CSV: solo las filas (el sobre paginado no se puede aplanar).
        if (outOpts.format === 'csv') output(page.items, outOpts);
        else outputPaginated(page.items, page.total, page.limit, page.offset, outOpts);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- get ---
  campaigns
    .command('get <campaignId>')
    .description(
      'Campaign detail: area, lead counts by state, credits against the campaign cap\n' +
        'and pipeline configuration.',
    )
    .action(async (campaignId) => {
      const global = getGlobalOpts(campaigns);
      try {
        const id = parseId(campaignId, 'campaignId');
        const data = await call(satvoltClient(global), 'get', `/campaigns/${id}`);
        if (global.format === 'human') {
          process.stderr.write(creditSummary(data, id));
          process.stderr.write(deliverySummary(data, id));
        }
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- create ---
  campaigns
    .command('create')
    .summary('Create a Maps campaign over an area, optionally from a template or campaign.')
    .description(
      'Create a Maps campaign over an area. It stays queued unless --start is passed\n' +
        '(same as the web app). Steps are the LEAD steps only: SECTORIZE, FIND_LEADS\n' +
        'and COMPLETE are added by the backend, and missing dependencies are added too.\n' +
        'The campaign is capped at 100000 credits and pauses itself instead of\n' +
        'spending more: --credit-limit <n> sets another cap, --no-credit-limit removes it.\n\n' +
        'Execution mode:\n' +
        '  sectors (default)  search a sector, finish its leads, then the next one, from the\n' +
        '                     centre of the area outwards (--sectors-in-flight at a time, 2 by\n' +
        '                     default). Stopping it at any point leaves finished leads.\n' +
        '  full               search every sector at once and put all leads in flight together\n' +
        '                     (to study the whole area fast). `campaigns full-sweep` switches a\n' +
        '                     sectors campaign to full at any time.\n\n' +
        'Goals (--limit key=value, repeatable): stop when the campaign has delivered that\n' +
        'much, counting completed leads only. Keys: completedLeads, annualKwh, roofAreaM2\n' +
        '(see: satvolt catalog campaign-limits).\n' +
        '  --limit completedLeads=200 --limit annualKwh=50000000\n\n' +
        'Area (exactly one):\n' +
        '  --circle <lat,lng> --radius <meters>   stored as a circle (100 m - 50 km)\n' +
        '  --bounds <nwLat,nwLng,seLat,seLng>     rectangle\n' +
        '  --polygon <json|@file|->               [[lat,lng],...] or GeoJSON; searched as its\n' +
        '                                         bounding rectangle (a warning is returned)\n\n' +
        'Examples:\n' +
        '  suntropy satvolt campaigns create --name "Polígono Cobo Calleja" \\\n' +
        '    --circle 40.2597,-3.7545 --radius 1500 --max-leads 300 \\\n' +
        '    --business-groups businesses --steps @steps.json\n' +
        '  suntropy satvolt campaigns create --name "Test" --bounds 40.45,-3.70,40.44,-3.68 \\\n' +
        '    --steps \'[{"action":"FIND_ROOFTOP"},{"action":"SOLAR_ANALYSIS"}]\' --start\n' +
        '  suntropy satvolt campaigns create --data @campaign.json   (full request body)\n\n' +
        'Base configuration (optional, one of them): steps, business groups, description,\n' +
        'search query and lead limit come from it; any flag you pass wins.\n' +
        '  --template <id|name>     a campaign template (see: satvolt templates list)\n' +
        '  --from-campaign <id>     copy the pipeline of another Maps campaign\n' +
        '  suntropy satvolt campaigns create --name "Sonda Huévar" --template "Greenvolt industria" \\\n' +
        '    --circle 37.3509,-6.2757 --radius 5000 --max-leads 50',
    )
    .option('--name <name>', 'Campaign name')
    .option('--template <idOrName>', 'Base the campaign on a campaign template')
    .option('--from-campaign <id>', 'Base the campaign on the configuration of another Maps campaign')
    .option('--description <text>', 'Natural language description of the configuration')
    .option('--circle <lat,lng>', 'Circle center')
    .option('--radius <meters>', 'Circle radius in meters')
    .option('--bounds <nwLat,nwLng,seLat,seLng>', 'Rectangle corners')
    .option('--polygon <json>', 'Polygon points, GeoJSON, @file or - for stdin')
    .option('--search-query <text>', 'Use Places text search with this query instead of nearby search')
    .option('--max-leads <n>', 'Stop discovering leads after this many')
    .option('--credit-limit <n>', 'Spend ceiling in credits (default: 100000)')
    .option('--no-credit-limit', 'No spend ceiling: the campaign can spend without limit')
    .option('--execution-mode <mode>', 'sectors (default: sector by sector) or full (every sector at once)')
    .option('--sectors-in-flight <n>', 'Sectors mode only: sectors in progress at a time (1-20, default 2)')
    .option('--limit <key=value>', 'Goal: stop when reached (repeatable). See: satvolt catalog campaign-limits', collect)
    .option('--business-groups <ids>', 'Comma-separated group ids (default: businesses). See: satvolt catalog business-groups')
    .option('--steps <json>', 'LEAD steps as JSON array, @file or -. See: satvolt catalog actions')
    .option('--address <text>', 'Reference address shown in the web app')
    .option('--region <text>', 'Region shown in the web app')
    .option('--start', 'Start the pipeline right after creating it (spends credits)')
    .option('--data <json>', 'Full request body (JSON, @file or -); flags override its fields')
    .action(async (opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        const body: Record<string, unknown> = opts.data ? readJsonArg(opts.data, '--data') : {};
        if (opts.name) body.name = opts.name;
        if (opts.circle !== undefined || opts.polygon !== undefined || opts.bounds !== undefined) {
          body.area = buildArea(opts);
        }
        if (!body.name) throw new Error('--name is required');
        if (!body.area) throw new Error('An area is required: --circle/--radius, --bounds or --polygon');
        if (opts.template && opts.fromCampaign) throw new Error('Use either --template or --from-campaign, not both');
        if (opts.template) body.templateId = opts.template;
        if (opts.fromCampaign) body.fromCampaignId = parseId(opts.fromCampaign, '--from-campaign');
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.searchQuery) body.searchQuery = opts.searchQuery;
        if (opts.maxLeads !== undefined) body.maxLeads = parseIntOption(opts.maxLeads, '--max-leads');
        const creditLimit = creditLimitFromOpts(opts);
        if (creditLimit !== undefined) body.creditLimit = creditLimit;
        if (opts.executionMode !== undefined) {
          if (!['sectors', 'full'].includes(opts.executionMode)) {
            throw new Error('--execution-mode must be sectors or full');
          }
          body.executionMode = opts.executionMode;
        }
        if (opts.sectorsInFlight !== undefined) {
          body.sectorsInFlight = parseIntOption(opts.sectorsInFlight, '--sectors-in-flight');
        }
        if (opts.limit?.length) {
          const limits = parseLimitPairs(opts.limit);
          if (Object.values(limits).some((v) => v === null)) throw new Error('--limit key=off only makes sense in `campaigns limits`');
          body.limits = { ...((body.limits as object) ?? {}), ...limits };
        }
        if (opts.businessGroups) body.businessGroups = opts.businessGroups.split(',').map((s: string) => s.trim()).filter(Boolean);
        if (opts.steps) body.steps = readJsonArg(opts.steps, '--steps');
        if (opts.address) body.inputAddress = opts.address;
        if (opts.region) body.region = opts.region;
        if (opts.start) body.start = true;

        const data = await call(satvoltClient(global), 'post', '/campaigns', { data: body });
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- estimate ---
  campaigns
    .command('estimate')
    .summary('Count the businesses a campaign would find over an area, without creating it.')
    .description(
      'Preview of FIND_LEADS: how many businesses Google Maps returns inside the area with\n' +
        'the given business groups (nearby search) or text query, plus a sample to inspect.\n' +
        'Nothing is created and no credits are spent. Use it to iterate the filters before\n' +
        '`campaigns create`: check `places.atLeast`, `byType` and the `sample` names, then\n' +
        'tighten or widen --business-groups until the sample looks like the target.\n\n' +
        'The count is a minimum: the preview has a request budget and is cached (7 days) per\n' +
        'area, groups and query; `places.exhaustive:false` means dense zones were left out.\n' +
        'A text query matches place NAMES, not categories ("manufactura" only finds businesses\n' +
        'called "Manufacturas …"): for a category, use business groups without --search-query.\n\n' +
        'Area (exactly one): --circle <lat,lng> --radius <m> | --bounds <nwLat,nwLng,seLat,seLng>\n' +
        '| --polygon <json|@file|->. Base (optional): --template or --from-campaign give the\n' +
        'groups and query when not passed explicitly.\n\n' +
        'Examples:\n' +
        '  suntropy satvolt campaigns estimate --circle 43.3934,-3.8445 --radius 1500 \\\n' +
        '    --business-groups businesses --format human\n' +
        '  suntropy satvolt campaigns estimate --circle 43.3934,-3.8445 --radius 1500 \\\n' +
        '    --business-groups industrial_logistics,automotive --sample 50\n' +
        '  suntropy satvolt campaigns estimate --bounds 40.45,-3.70,40.44,-3.68 --template "Industria"',
    )
    .option('--circle <lat,lng>', 'Circle center')
    .option('--radius <meters>', 'Circle radius in meters')
    .option('--bounds <nwLat,nwLng,seLat,seLng>', 'Rectangle corners')
    .option('--polygon <json>', 'Polygon points, GeoJSON, @file or - for stdin')
    .option('--template <idOrName>', 'Take business groups and query from a campaign template')
    .option('--from-campaign <id>', 'Take business groups and query from another Maps campaign')
    .option('--business-groups <ids>', 'Comma-separated group ids or raw Google Places types. See: satvolt catalog business-groups')
    .option('--search-query <text>', 'Places text search with this query instead of nearby search (matches names, not categories)')
    .option('--sample <n>', 'Sample places to return (1-100, default 20)')
    .option('--offset <n>', 'Skip this many sample places (to page through them)')
    .action(async (opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        const body: Record<string, unknown> = { area: buildArea(opts) };
        if (opts.template && opts.fromCampaign) throw new Error('Use either --template or --from-campaign, not both');
        if (opts.template) body.templateId = opts.template;
        if (opts.fromCampaign) body.fromCampaignId = parseId(opts.fromCampaign, '--from-campaign');
        if (opts.businessGroups) body.businessGroups = opts.businessGroups.split(',').map((s: string) => s.trim()).filter(Boolean);
        if (opts.searchQuery) body.searchQuery = opts.searchQuery;
        if (opts.sample !== undefined) body.sample = parseIntOption(opts.sample, '--sample');
        if (opts.offset !== undefined) body.offset = parseIntOption(opts.offset, '--offset');

        const data = await call(satvoltClient(global, 120000), 'post', '/campaigns/estimate', { data: body });
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- excel ---
  const columnFlag = (value?: string) => (value ? { column: value } : undefined);
  const columnsList = (value?: string) =>
    value ? value.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

  campaigns
    .command('excel-preview <file>')
    .summary('Headers and first rows of an Excel, to decide the column mapping.')
    .description(
      'Reads the first sheet of an .xlsx (headers in row 1) and returns `headers`,\n' +
        '`sampleRows` and `totalRows`, without creating anything. Run it before\n' +
        '`create-from-excel` to see which column holds the name, the address parts,\n' +
        'the coordinates ("lat,lng"), the phone, the website or the email.\n\n' +
        'Example:\n' +
        '  suntropy satvolt campaigns excel-preview empresas.xlsx --sample 10 --format human',
    )
    .option('--sample <n>', 'Rows to return (1-50, default 5)')
    .action(async (file, opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        const data = await callMultipart(satvoltClient(global), '/campaigns/excel/preview', file, undefined, {
          sampleSize: opts.sample !== undefined ? parseIntOption(opts.sample, '--sample') : undefined,
        });
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  campaigns
    .command('excel-geocode-test <file>')
    .summary('Geocode the first rows with the chosen address columns, before creating.')
    .description(
      'When the Excel has no coordinates, the campaign geocodes each row from the\n' +
        'columns you choose (concatenated with commas). This runs that geocoding on the\n' +
        'first rows only and shows the query, the coordinates and the formatted address\n' +
        'found, so you can check the columns are right before paying for every lead.\n' +
        'Costs one Google geocoding request per sampled row.\n\n' +
        'Example:\n' +
        '  suntropy satvolt campaigns excel-geocode-test empresas.xlsx \\\n' +
        '    --columns "Dirección,CP,Municipio" --region Cantabria --sample 5 --format human',
    )
    .requiredOption('--columns <headers>', 'Comma-separated Excel headers that form the address, in order')
    .option('--sample <n>', 'Rows to test (1-25, default 5)')
    .option('--region <text>', 'Region appended to every query to disambiguate (province, country)')
    .action(async (file, opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        const data = await callMultipart(satvoltClient(global, 120000), '/campaigns/excel/geocode-test', file, {
          columns: columnsList(opts.columns),
          sampleSize: opts.sample !== undefined ? parseIntOption(opts.sample, '--sample') : undefined,
          region: opts.region,
        });
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  campaigns
    .command('create-from-excel <file>')
    .summary('Create a campaign whose leads come from an Excel (no Maps search).')
    .description(
      'Imports the rows of the first sheet as leads (one row = one lead) and builds the\n' +
        'pipeline on them. The campaign stays queued unless --start is passed, and it\n' +
        'cannot be extended later: the leads are fixed at creation.\n\n' +
        'Mapping (see `excel-preview` for the headers):\n' +
        '  --name-column <h>            required: commercial name of the business\n' +
        '  --coordinates-column <h>     column with "lat,lng"  — OR —\n' +
        '  --geocode-columns <h1,h2>    address columns to geocode per lead (GEOCODE_ADDRESS,\n' +
        '                               10 credits per lead; test them with excel-geocode-test)\n' +
        '  --address-columns <h1,h2>    address shown on the lead (joined with ", ")\n' +
        '  --phone-column, --url-column, --email-column, --type-column <h>\n' +
        '  --country <text>             literal applied to every row\n' +
        '  --mapping <json|@file>       full columnMapping object instead of the flags above\n\n' +
        'Pipeline: --template, --from-campaign or --steps, as in `campaigns create`.\n\n' +
        'Examples:\n' +
        '  suntropy satvolt campaigns create-from-excel empresas.xlsx --name "Clientes CRM" \\\n' +
        '    --name-column Empresa --geocode-columns "Dirección,CP,Municipio" --region Cantabria \\\n' +
        '    --template "Industria" --max-leads 100\n' +
        '  suntropy satvolt campaigns create-from-excel leads.xlsx --name "Con coordenadas" \\\n' +
        '    --name-column Nombre --coordinates-column Coordenadas --phone-column Teléfono \\\n' +
        '    --steps @steps.json',
    )
    .requiredOption('--name <name>', 'Campaign name')
    .option('--name-column <header>', 'Column with the commercial name (required unless --mapping)')
    .option('--coordinates-column <header>', 'Column with "lat,lng" coordinates')
    .option('--geocode-columns <headers>', 'Comma-separated address columns to geocode when there are no coordinates')
    .option('--address-columns <headers>', 'Comma-separated columns joined as the lead address')
    .option('--phone-column <header>', 'Column with the phone')
    .option('--url-column <header>', 'Column with the website')
    .option('--email-column <header>', 'Column with the email (stored in fullData.importMetadata.email)')
    .option('--type-column <header>', 'Column with the business type (googlePlacesType)')
    .option('--country <text>', 'Country applied to every lead')
    .option('--mapping <json>', 'columnMapping as JSON, @file or - (overrides the *-column flags)')
    .option('--template <idOrName>', 'Base the pipeline on a campaign template')
    .option('--from-campaign <id>', 'Copy the pipeline of another campaign')
    .option('--steps <json>', 'LEAD steps as JSON array, @file or -')
    .option('--max-leads <n>', 'Import only the first n rows')
    .option('--credit-limit <n>', 'Spend ceiling in credits (default: 100000)')
    .option('--no-credit-limit', 'No spend ceiling: the campaign can spend without limit')
    .option('--region <text>', 'Region of the leads (also biases the geocoding)')
    .option('--description <text>', 'Natural language description of the configuration')
    .option('--start', 'Start the pipeline right after creating it (spends credits)')
    .action(async (file, opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        const columnMapping: Record<string, unknown> = opts.mapping
          ? readJsonArg(opts.mapping, '--mapping')
          : {
              commercialName: columnFlag(opts.nameColumn),
              coordinates: columnFlag(opts.coordinatesColumn),
              address: columnsList(opts.addressColumns)?.map((column) => ({ column })),
              phone: columnFlag(opts.phoneColumn),
              url: columnFlag(opts.urlColumn),
              email: columnFlag(opts.emailColumn),
              googlePlacesType: columnFlag(opts.typeColumn),
              country: opts.country ? { literal: opts.country } : undefined,
            };
        if (!columnMapping.commercialName) throw new Error('--name-column is required (or a --mapping with commercialName)');
        const geocodeColumns = columnsList(opts.geocodeColumns);
        if (!columnMapping.coordinates && !geocodeColumns) {
          throw new Error('Pass --coordinates-column <header> or --geocode-columns <h1,h2,...>');
        }
        if (opts.template && opts.fromCampaign) throw new Error('Use either --template or --from-campaign, not both');
        const payload: Record<string, unknown> = {
          name: opts.name,
          columnMapping,
          geocoding: geocodeColumns ? { enabled: true, columns: geocodeColumns } : undefined,
          templateId: opts.template,
          fromCampaignId: opts.fromCampaign ? parseId(opts.fromCampaign, '--from-campaign') : undefined,
          steps: opts.steps ? readJsonArg(opts.steps, '--steps') : undefined,
          maxLeads: opts.maxLeads !== undefined ? parseIntOption(opts.maxLeads, '--max-leads') : undefined,
          creditLimit: creditLimitFromOpts(opts),
          region: opts.region,
          description: opts.description,
          start: opts.start ? true : undefined,
        };
        const data = await callMultipart(satvoltClient(global, 300000), '/campaigns/from-excel', file, payload);
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- delete ---
  campaigns
    .command('delete <campaignId>')
    .summary('Delete a campaign and everything it generated (irreversible, --yes).')
    .description(
      'Delete a campaign with its sectors, leads, step executions, pipeline configuration\n' +
        'and queued jobs. Irreversible. Export tables of the campaign stop working.\n' +
        'Example:\n' +
        '  suntropy satvolt campaigns delete 63 --yes',
    )
    .option('--yes', 'Confirm the deletion (required)')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        if (!opts.yes) throw new Error('Deleting a campaign is irreversible. Re-run with --yes to confirm.');
        const data = await call(satvoltClient(global), 'delete', `/campaigns/${parseId(campaignId, 'campaignId')}`);
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- credit-limit ---
  campaigns
    .command('credit-limit <campaignId> [credits]')
    .summary('Set or remove the spend ceiling of a campaign, in credits.')
    .description(
      'Every new campaign is capped at 100000 credits. When the cap is reached the\n' +
        'campaign pauses itself instead of spending more (`campaigns get` shows pauseReason:\n' +
        'credit_limit), and unpause, extend and `leads run-step` answer 409\n' +
        'CREDIT_LIMIT_REACHED until the cap is raised or removed.\n\n' +
        'What counts against the cap is the credits already charged plus the ones reserved\n' +
        'by async steps still waiting for their webhook (`campaigns get` → credits).\n' +
        'It is a soft ceiling: steps already running when it is reached finish and are\n' +
        'charged, so the final figure can land slightly above it.\n' +
        'Raising the cap does NOT resume the campaign: run `campaigns unpause` afterwards.\n' +
        'Examples:\n' +
        '  suntropy satvolt campaigns credit-limit 8 150000\n' +
        '  suntropy satvolt campaigns credit-limit 8 --off --yes',
    )
    .option('--off', 'Remove the cap: the campaign can spend without limit')
    .option('--yes', 'Confirm removing the cap (required with --off)')
    .action(async (campaignId, credits, opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        const id = parseId(campaignId, 'campaignId');
        let creditLimit: number | null;
        if (opts.off) {
          if (credits !== undefined) throw new Error('Pass either the new limit in credits or --off, not both.');
          if (!opts.yes) {
            throw new Error('Without a cap the campaign can spend without limit. Re-run with --yes to confirm.');
          }
          creditLimit = null;
        } else {
          if (credits === undefined) throw new Error('Pass the new limit in credits, or --off --yes to remove the cap.');
          const parsed = parseIntOption(credits, 'credits');
          if (!parsed) throw new Error('credits must be greater than 0 (use --off --yes to remove the cap)');
          creditLimit = parsed;
        }
        const data = await call(satvoltClient(global), 'put', `/campaigns/${id}/credit-limit`, {
          data: { creditLimit },
        });
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- limits ---
  campaigns
    .command('limits <campaignId> [pairs...]')
    .summary('Set or remove the goals of a campaign (completed leads, consumption, roof surface).')
    .description(
      'Goals stop a campaign once it has DELIVERED that much, counting completed leads only\n' +
        '(a discarded, failed or half-processed lead does not add up):\n' +
        '  completedLeads   leads that went through the whole pipeline\n' +
        '  annualKwh        estimated annual consumption (a shared parcel counts once)\n' +
        '  roofAreaM2       roof surface, once per catastral parcel\n' +
        'In sectors mode, reaching one stops admitting sectors: the sectors in progress finish\n' +
        'and the campaign completes by itself. In a full sweep the campaign pauses\n' +
        '(`campaigns get` → pauseReason: limit_reached).\n' +
        'Pairs patch the current goals; key=off removes one. With no pairs, shows them.\n' +
        'Raising a goal does NOT resume the campaign: run `campaigns unpause` afterwards.\n' +
        'Examples:\n' +
        '  suntropy satvolt campaigns limits 91 completedLeads=200 annualKwh=50000000\n' +
        '  suntropy satvolt campaigns limits 91 annualKwh=off\n' +
        '  suntropy satvolt campaigns limits 91',
    )
    .action(async (campaignId, pairs) => {
      const global = getGlobalOpts(campaigns);
      try {
        const id = parseId(campaignId, 'campaignId');
        if (!pairs?.length) {
          const data = await call(satvoltClient(global), 'get', `/campaigns/${id}`);
          output({ campaignId: id, limits: data?.limits ?? [] }, global);
          return;
        }
        const data = await call(satvoltClient(global), 'patch', `/campaigns/${id}/limits`, {
          data: parseLimitPairs(pairs),
        });
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- full-sweep ---
  campaigns
    .command('full-sweep <campaignId>')
    .summary('Switch a sector-by-sector campaign to a full sweep: search every waiting sector now (--yes).')
    .description(
      'A campaign in sectors mode searches a sector, finishes its leads and moves on. A full\n' +
        'sweep searches every sector that is still waiting right now, and all their leads go\n' +
        'through the pipeline at once: faster to cover the whole area, but the search of\n' +
        'every remaining sector is paid now and stopping it later leaves many leads half done.\n' +
        'Irreversible for this campaign. A paused campaign keeps the sectors queued until\n' +
        '`campaigns unpause`.\n' +
        '`campaigns get` shows how many sectors are waiting (sectorProgress.waiting).\n' +
        'Example:\n' +
        '  suntropy satvolt campaigns full-sweep 91 --yes',
    )
    .option('--yes', 'Confirm the switch (required)')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        const id = parseId(campaignId, 'campaignId');
        if (!opts.yes) {
          throw new Error(
            'A full sweep searches every waiting sector now and cannot be undone. Check ' +
              `\`campaigns get ${id}\` (sectorProgress.waiting) and re-run with --yes to confirm.`,
          );
        }
        const data = await call(satvoltClient(global, 120000), 'post', `/campaigns/${id}/full-sweep`);
        output(data, global);
      } catch (err) {
        outputError(creditLimitError(err, campaignId));
      }
    });

  // --- start ---
  campaigns
    .command('start <campaignId>')
    .description(
      'Start the pipeline of a queued campaign (spends credits, up to its credit cap:\n' +
        'see `campaigns credit-limit`).',
    )
    .action(async (campaignId) => {
      const global = getGlobalOpts(campaigns);
      try {
        const data = await call(satvoltClient(global), 'post', `/campaigns/${parseId(campaignId, 'campaignId')}/start`);
        output(data, global);
      } catch (err) {
        outputError(creditLimitError(err, campaignId));
      }
    });

  // --- pause ---
  campaigns
    .command('pause <campaignId>')
    .summary('Pause a running campaign: nothing else runs or is charged until unpause.')
    .description(
      'Pause a running campaign. Queued work is withdrawn and steps already in flight\n' +
        'finish without queuing their successors, so no more credits are spent. Results\n' +
        'of async steps whose webhook arrives meanwhile are kept. Only a running\n' +
        'campaign (inProgress, sectorized, leadsFound, analyzed) can be paused;\n' +
        'otherwise 409 INVALID_CAMPAIGN_STATE.\n' +
        'Example:\n' +
        '  suntropy satvolt campaigns pause 72',
    )
    .action(async (campaignId) => {
      const global = getGlobalOpts(campaigns);
      try {
        const data = await call(satvoltClient(global, 120000), 'post', `/campaigns/${parseId(campaignId, 'campaignId')}/pause`);
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- unpause ---
  campaigns
    .command('unpause <campaignId>')
    .summary('Resume a paused campaign where it stopped (no step is run twice).')
    .description(
      'Resume a paused campaign where it stopped: every lead that is not finished gets\n' +
        'its next pending step queued, and steps already executed are neither re-run\n' +
        'nor charged again. Only a paused campaign can be unpaused. This is not\n' +
        '`resume`, which appends a NEW step to a finished campaign.\n' +
        'A campaign that reached its credit cap answers 409 CREDIT_LIMIT_REACHED: raise\n' +
        'the cap with `campaigns credit-limit` before unpausing it.\n' +
        'Example:\n' +
        '  suntropy satvolt campaigns unpause 72',
    )
    .action(async (campaignId) => {
      const global = getGlobalOpts(campaigns);
      try {
        const data = await call(satvoltClient(global, 120000), 'post', `/campaigns/${parseId(campaignId, 'campaignId')}/unpause`);
        output(data, global);
      } catch (err) {
        outputError(creditLimitError(err, campaignId));
      }
    });

  // --- cancel ---
  campaigns
    .command('cancel <campaignId>')
    .summary('Cancel a running or paused campaign for good, keeping its leads and data (--yes).')
    .description(
      'Cancel a running, paused or queued campaign. Irreversible: it cannot be unpaused\n' +
        'or started again (reset relaunches it from scratch, deleting the leads). Leads\n' +
        'and the data already enriched are kept, can be exported and are still charged.\n' +
        'Example:\n' +
        '  suntropy satvolt campaigns cancel 72 --yes',
    )
    .option('--yes', 'Confirm the cancellation (required)')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        if (!opts.yes) throw new Error('Cancelling a campaign is irreversible. Re-run with --yes to confirm.');
        const data = await call(satvoltClient(global, 120000), 'post', `/campaigns/${parseId(campaignId, 'campaignId')}/cancel`);
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- reset ---
  campaigns
    .command('reset <campaignId>')
    .summary('Relaunch a campaign from scratch: deletes its leads and results (--yes).')
    .description(
      'Relaunch a campaign from scratch: deletes its sectors, leads and processing data\n' +
        'and returns it to queued, keeping the configuration. Excel/campaign-sourced\n' +
        'campaigns keep their imported leads. Irreversible.\n' +
        'Example:\n' +
        '  suntropy satvolt campaigns reset 59 --yes --start',
    )
    .option('--start', 'Start the pipeline again after resetting')
    .option('--yes', 'Confirm the reset (required)')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        if (!opts.yes) throw new Error('Reset deletes the campaign leads and results. Re-run with --yes to confirm.');
        const data = await call(satvoltClient(global), 'post', `/campaigns/${parseId(campaignId, 'campaignId')}/reset`, {
          params: { start: opts.start ? 'true' : undefined },
        });
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- extend ---
  campaigns
    .command('extend <campaignId>')
    .summary('Get more leads from a finished Maps campaign without relaunching it.')
    .description(
      'Get more leads from a finished Maps campaign without relaunching it: raises (or\n' +
        'removes) its lead limit and searches again only in the sectors whose search was\n' +
        'cut short. Existing leads are kept and only the new ones go through the pipeline\n' +
        '(spends credits). `campaigns get` shows sectorSearch: incomplete + unknown > 0\n' +
        'means more leads can still be found; 0 means the area is exhausted.\n' +
        'Cost: new leads x credits per lead (`campaigns usage` → avgCreditsPerLead). With\n' +
        '--max-leads the new leads are at most the difference; with --no-limit estimate them\n' +
        'from the leads found per sector so far.\n' +
        'Examples:\n' +
        '  suntropy satvolt campaigns extend 62 --max-leads 500\n' +
        '  suntropy satvolt campaigns extend 62 --no-limit',
    )
    .option('--max-leads <n>', 'New lead limit (must be greater than the current number of leads)')
    .option('--no-limit', 'Remove the lead limit and search every pending sector fully')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        // commander turns --no-limit into opts.limit === false.
        const removeLimit = opts.limit === false;
        if (removeLimit === (opts.maxLeads !== undefined)) {
          throw new Error('Pass exactly one of --max-leads <n> or --no-limit.');
        }
        const maxLeads = removeLimit ? null : parseIntOption(opts.maxLeads, '--max-leads');
        const data = await call(satvoltClient(global, 120000), 'post', `/campaigns/${parseId(campaignId, 'campaignId')}/extend`, {
          data: { maxLeads },
        });
        output(data, global);
      } catch (err) {
        outputError(creditLimitError(err, campaignId));
      }
    });

  // --- resume ---
  campaigns
    .command('resume <campaignId>')
    .summary('Append a new step at the end and run it over the existing leads.')
    .description(
      'Resume a finished campaign from a NEW step: appends it at the end of the pipeline\n' +
        '(before COMPLETE) and runs it over the existing leads that reached the previous\n' +
        'step. Missing dependencies are added before it. If the step cannot run, the\n' +
        'configuration change is rolled back. --config is only the config object of the step\n' +
        '(see configSchema in `satvolt catalog actions`), not { action, config }.\n' +
        'Cost: leads that reached the last step (`campaigns funnel`) x creditCost of the action.\n' +
        'Examples:\n' +
        '  suntropy satvolt campaigns resume 59 --action ESTIMATE_CONSUMPTION --config \'{"tariffTemplate":"3.0TD"}\'\n' +
        '  suntropy satvolt campaigns resume 59 --action AI_AGENT \\\n' +
        '    --config \'{"customName":"Web corporativa","agentId":"<id from catalog ai-agents>","outputKey":"web"}\'',
    )
    .requiredOption('--action <ACTION>', 'Action to add (see: satvolt catalog actions)')
    .option('--config <json>', 'Step config as JSON, @file or -')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        const step: Record<string, unknown> = { action: String(opts.action).toUpperCase() };
        if (opts.config) step.config = readJsonArg(opts.config, '--config');
        const data = await call(satvoltClient(global, 120000), 'post', `/campaigns/${parseId(campaignId, 'campaignId')}/resume`, {
          data: { step },
        });
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- usage ---
  campaigns
    .command('usage <campaignId>')
    .description(
      'Credits consumed by the campaign, as shown in the Usage tab: total, per lead\n' +
        'average and per step. --by-lead adds the per-lead breakdown.',
    )
    .option('--by-lead', 'Include the per-lead breakdown')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        const data = await call(satvoltClient(global, 120000), 'get', `/campaigns/${parseId(campaignId, 'campaignId')}/usage`, {
          params: { include: opts.byLead ? 'leads' : undefined },
        });
        if (global.format === 'human' || global.format === 'csv') {
          // Tables read better per step; the summary goes to stderr in human mode.
          if (global.format === 'human') {
            process.stderr.write(
              chalk.bold(`Total ${data.totalCredits} credits · ${data.totalLeads} leads · ${data.avgCreditsPerLead} per lead\n\n`),
            );
          }
          output(data.byStep, global);
          return;
        }
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- funnel ---
  campaigns
    .command('funnel <campaignId>')
    .summary('Leads per pipeline step, by execution or by success criteria')
    .description(
      'Funnel of the campaign: for each LEAD step, how many leads reached it and how many\n' +
        'succeeded, failed, were skipped, are processing (async) or still pending, plus\n' +
        'the lead counts by state.\n' +
        '\n' +
        '--mode success shows how many leads the step actually brought data for, which is\n' +
        'not the same thing: an agent can finish without error answering that it found\n' +
        'nothing. It uses the `successIf` paths configured on each step, evaluated against\n' +
        "the lead's current data — change the criteria and the numbers change, with no\n" +
        're-run. Steps without criteria fall back to their successful executions.\n' +
        'Examples:\n' +
        '  suntropy satvolt campaigns funnel 62\n' +
        '  suntropy satvolt campaigns funnel 62 --mode success',
    )
    .option('--mode <mode>', 'execution (default) | success', 'execution')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        const mode = String(opts.mode || 'execution').toLowerCase();
        if (mode !== 'execution' && mode !== 'success') {
          outputError({ code: 'INVALID_MODE', message: '--mode must be execution or success' });
          return;
        }
        const data = await call(satvoltClient(global, 120000), 'get', `/campaigns/${parseId(campaignId, 'campaignId')}/funnel`);
        if (global.format === 'human' || global.format === 'csv') {
          output(
            (data.steps ?? []).map((s: any) =>
              mode === 'success'
                ? {
                    step: s.name,
                    action: s.action,
                    reached: s.reached,
                    withData: s.criteria ? s.criteria.met : s.success,
                    pctOfTotal: s.criteria ? s.criteria.metPct : s.reachedPct,
                    missingData: s.criteria ? s.criteria.unmet : '',
                    retries: s.criteria?.maxRetries || '',
                    successIf: s.criteria ? s.criteria.paths.join(', ') : '(no criteria)',
                  }
                : {
                    step: s.name,
                    action: s.action,
                    reached: s.reached,
                    pctOfTotal: s.reachedPct,
                    success: s.success,
                    failure: s.failure,
                    skipped: s.skipped,
                    processing: s.processing,
                    pending: s.pending,
                  },
            ),
            global,
          );
          return;
        }
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- logs ---
  campaigns
    .command('logs <campaignId>')
    .description(
      'Campaign processing logs (kept 30 days, last 5000 entries).\n' +
        '--follow keeps polling and stops by itself when the campaign reaches a final state.\n' +
        'Examples:\n' +
        '  suntropy satvolt campaigns logs 59 --level error\n' +
        '  suntropy satvolt campaigns logs 59 --follow --format human',
    )
    .option('--limit <n>', 'Max entries (max 5000)', '500')
    .option('--since <ts>', 'Only entries after this epoch-ms timestamp (use lastTs from a previous call)')
    .option('--level <level>', 'debug | log | warn | error')
    .option('--follow', 'Poll for new entries until the campaign finishes')
    .option('--interval <seconds>', 'Polling interval with --follow', '3')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(campaigns);
      try {
        const id = parseId(campaignId, 'campaignId');
        const client = satvoltClient(global);
        const fetchLogs = (sinceTs?: number | string) =>
          call(client, 'get', `/campaigns/${id}/logs`, {
            params: { limit: opts.limit, sinceTs, level: opts.level },
          });

        const printEntries = (entries: Array<{ ts: number; level: string; source: string; message: string }>) => {
          for (const e of entries) {
            if (global.format === 'human') {
              const color = e.level === 'error' ? chalk.red : e.level === 'warn' ? chalk.yellow : chalk.dim;
              process.stdout.write(`${chalk.dim(new Date(e.ts).toISOString())} ${color(e.level.padEnd(5))} ${e.source}: ${e.message}\n`);
            } else {
              process.stdout.write(JSON.stringify(e) + '\n');
            }
          }
        };

        const first = await fetchLogs(opts.since);
        if (!opts.follow) {
          if (global.format === 'human') printEntries(first.entries);
          else output(first, global);
          return;
        }

        // --follow streams JSON lines (one entry per line) so it can be piped.
        printEntries(first.entries);
        let lastTs = first.lastTs;
        const intervalMs = Math.max(1, Number(opts.interval) || 3) * 1000;
        for (;;) {
          const campaign = await call(client, 'get', `/campaigns/${id}`);
          await new Promise((r) => setTimeout(r, intervalMs));
          const next = await fetchLogs(lastTs ?? undefined);
          printEntries(next.entries);
          lastTs = next.lastTs ?? lastTs;
          if (TERMINAL_CAMPAIGN_STATES.has(campaign.state)) {
            process.stderr.write(`Campaign ${id} is ${campaign.state}; stopped following.\n`);
            return;
          }
        }
      } catch (err) {
        outputError(satvoltError(err));
      }
    });
}
