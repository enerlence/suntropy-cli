import { Command } from 'commander';
import chalk from 'chalk';
import { output, outputError, outputPaginated } from '../../output.js';
import {
  call,
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
    .description('Satvolt campaigns: list, create from an area, start, reset, resume, usage, logs and funnel.');

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
        outputPaginated(page.items, page.total, page.limit, page.offset, outOpts);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- get ---
  campaigns
    .command('get <campaignId>')
    .description('Campaign detail: area, lead counts by state and pipeline configuration.')
    .action(async (campaignId) => {
      const global = getGlobalOpts(campaigns);
      try {
        const data = await call(satvoltClient(global), 'get', `/campaigns/${parseId(campaignId, 'campaignId')}`);
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- create ---
  campaigns
    .command('create')
    .description(
      'Create a Maps campaign over an area. It stays queued unless --start is passed\n' +
        '(same as the web app). Steps are the LEAD steps only: SECTORIZE, FIND_LEADS\n' +
        'and COMPLETE are added by the backend, and missing dependencies are added too.\n\n' +
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
        '  suntropy satvolt campaigns create --data @campaign.json   (full request body)',
    )
    .option('--name <name>', 'Campaign name')
    .option('--circle <lat,lng>', 'Circle center')
    .option('--radius <meters>', 'Circle radius in meters')
    .option('--bounds <nwLat,nwLng,seLat,seLng>', 'Rectangle corners')
    .option('--polygon <json>', 'Polygon points, GeoJSON, @file or - for stdin')
    .option('--search-query <text>', 'Use Places text search with this query instead of nearby search')
    .option('--max-leads <n>', 'Stop discovering leads after this many')
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
        if (opts.searchQuery) body.searchQuery = opts.searchQuery;
        if (opts.maxLeads !== undefined) body.maxLeads = parseIntOption(opts.maxLeads, '--max-leads');
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

  // --- start ---
  campaigns
    .command('start <campaignId>')
    .description('Start the pipeline of a queued campaign (spends credits).')
    .action(async (campaignId) => {
      const global = getGlobalOpts(campaigns);
      try {
        const data = await call(satvoltClient(global), 'post', `/campaigns/${parseId(campaignId, 'campaignId')}/start`);
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- reset ---
  campaigns
    .command('reset <campaignId>')
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

  // --- resume ---
  campaigns
    .command('resume <campaignId>')
    .description(
      'Resume a finished campaign from a NEW step: appends it at the end of the pipeline\n' +
        '(before COMPLETE) and runs it over the existing leads that reached the previous\n' +
        'step. If the step cannot run, the configuration change is rolled back.\n' +
        'Examples:\n' +
        '  suntropy satvolt campaigns resume 59 --action ESTIMATE_CONSUMPTION --config \'{"tariffTemplate":"3.0TD"}\'\n' +
        '  suntropy satvolt campaigns resume 59 --action AI_AGENT --config @agent-step.json',
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
    .description(
      'Funnel of the campaign: for each LEAD step, how many leads reached it and how many\n' +
        'succeeded, failed, were skipped, are processing (async) or still pending, plus\n' +
        'the lead counts by state.',
    )
    .action(async (campaignId) => {
      const global = getGlobalOpts(campaigns);
      try {
        const data = await call(satvoltClient(global, 120000), 'get', `/campaigns/${parseId(campaignId, 'campaignId')}/funnel`);
        if (global.format === 'human' || global.format === 'csv') {
          output(data.steps, global);
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
