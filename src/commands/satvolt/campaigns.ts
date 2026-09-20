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
    .description('Satvolt campaigns: list, create from an area, start, pause, cancel, reset, resume, usage, logs and funnel.');

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
    .summary('Create a Maps campaign over an area, optionally from a template or campaign.')
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
        'Example:\n' +
        '  suntropy satvolt campaigns unpause 72',
    )
    .action(async (campaignId) => {
      const global = getGlobalOpts(campaigns);
      try {
        const data = await call(satvoltClient(global, 120000), 'post', `/campaigns/${parseId(campaignId, 'campaignId')}/unpause`);
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
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
        outputError(satvoltError(err));
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
