import { Command } from 'commander';
import { output, outputError, outputPaginated } from '../../output.js';
import { registerFieldsCommand } from './fields.js';
import {
  call,
  getGlobalOpts,
  parseId,
  satvoltClient,
  satvoltError,
} from './api.js';

const LEAD_LIST_FIELDS = 'idLead,commercialName,state,stateError,lastAction,address,phone,url';

export function registerSatvoltLeadCommands(satvolt: Command): void {
  const leads = satvolt
    .command('leads')
    .description('Leads of a campaign: paginated list with state, filters by step, detail and available data fields.');

  leads
    .command('list <campaignId>')
    .description(
      'List leads with their state (plus stateError, last action and QUALIFY verdicts).\n\n' +
        'Filters:\n' +
        '  --name <text>          commercial name contains (like the web table)\n' +
        '  --search <text>        name, address, phone, place id or reference\n' +
        '  --state <a,b>          lead states (see: satvolt catalog states)\n' +
        '  --step <step>          pipeline step: uid, ACTION (if it appears once), step name\n' +
        '                         ("Buscador de CIF") or fullData key (cif)\n' +
        '  --step-status <s>      reached (default) | success | failure | skipped | processing | pending\n\n' +
        'Examples:\n' +
        '  suntropy satvolt leads list 59 --name "logistica" --limit 25\n' +
        '  suntropy satvolt leads list 59 --step QUALIFY --step-status failure\n' +
        '  suntropy satvolt leads list 59 --step 95161b8b080180e4 --step-status pending --format csv',
    )
    .option('--limit <n>', 'Page size (max 200)', '25')
    .option('--offset <n>', 'Skip results', '0')
    .option('--page <n>', 'Page number (1-based); overrides --offset')
    .option('--name <text>', 'Commercial name contains')
    .option('--search <text>', 'Broad search')
    .option('--state <states>', 'Comma-separated lead states')
    .option('--step <step>', 'Filter by pipeline step: uid, ACTION (if unique), step name or fullData key')
    .option('--step-status <status>', 'Status in that step')
    .option('--with-steps', 'Include the status of every LEAD step on each lead')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(leads);
      try {
        const limit = Number(opts.limit);
        const offset = opts.page ? (Math.max(1, Number(opts.page)) - 1) * limit : Number(opts.offset);
        const page = await call(satvoltClient(global), 'get', `/campaigns/${parseId(campaignId, 'campaignId')}/leads`, {
          params: {
            limit,
            offset,
            name: opts.name,
            search: opts.search,
            state: opts.state,
            step: opts.step,
            stepStatus: opts.stepStatus,
            include: opts.withSteps ? 'steps' : undefined,
          },
        });
        const outOpts = { ...global, fields: global.fields ?? (global.format !== 'json' ? LEAD_LIST_FIELDS : undefined) };
        // CSV: solo las filas (el sobre paginado no se puede aplanar).
        if (outOpts.format === 'csv') output(page.items, outOpts);
        else outputPaginated(page.items, page.total, page.limit, page.offset, outOpts);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  leads
    .command('get <campaignId> <leadId>')
    .description(
      'Lead detail: columns, status of each pipeline step, state history and the list of\n' +
        'fullData keys. --full-data adds the enriched data (all of it, or only some keys).\n' +
        'Examples:\n' +
        '  suntropy satvolt leads get 59 1216\n' +
        '  suntropy satvolt leads get 59 1216 --full-data consumptionEstimate,solarPanelAnalysis',
    )
    .option('--full-data [keys]', 'Include fullData (optionally comma-separated top-level keys)')
    .action(async (campaignId, leadId, opts) => {
      const global = getGlobalOpts(leads);
      try {
        const fullData = opts.fullData === true ? 'true' : opts.fullData;
        const data = await call(
          satvoltClient(global),
          'get',
          `/campaigns/${parseId(campaignId, 'campaignId')}/leads/${parseId(leadId, 'leadId')}`,
          { params: { fullData } },
        );
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  leads
    .command('full-data <campaignId> <leadId>')
    .summary('Only the enriched data of a lead (all, some keys or one path).')
    .description(
      'Print only the enriched data (fullData) of a lead, optionally a subset of keys or a\n' +
        'single nested path.\n' +
        'Examples:\n' +
        '  suntropy satvolt leads full-data 62 2078\n' +
        '  suntropy satvolt leads full-data 62 2078 --keys consumptionEstimate,cif\n' +
        '  suntropy satvolt leads full-data 62 2078 --path cif.response.extras.cnae',
    )
    .option('--keys <keys>', 'Comma-separated top-level keys')
    .option('--path <dotted.path>', 'Return the value at this path inside fullData')
    .action(async (campaignId, leadId, opts) => {
      const global = getGlobalOpts(leads);
      try {
        const topKey = opts.path ? String(opts.path).split('.')[0] : undefined;
        const data = await call(
          satvoltClient(global),
          'get',
          `/campaigns/${parseId(campaignId, 'campaignId')}/leads/${parseId(leadId, 'leadId')}`,
          { params: { fullData: topKey ?? opts.keys ?? 'true' } },
        );
        let value: unknown = data.fullData ?? {};
        if (opts.path) {
          for (const part of String(opts.path).split('.')) {
            value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
          }
          if (value === undefined) throw new Error(`Path "${opts.path}" not found in the fullData of lead ${leadId}`);
        }
        output(value, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  leads
    .command('run-step <campaignId> <leadId> <step>')
    .summary('Run one pipeline step on a single lead (only that step, or --continue).')
    .description(
      'Run one pipeline step on a single lead, through the same queue as the pipeline.\n' +
        'Step: uid, action if it appears once, step name or fullData key (e.g. cif).\n' +
        'Spends the credits of that step (a failed or skipped run is free). A campaign\n' +
        'that reached its credit cap answers 409 CREDIT_LIMIT_REACHED.\n' +
        '  default       only that step: later steps are not queued and a completed or\n' +
        '                unqualified lead keeps its state (except when re-running QUALIFY)\n' +
        '  --continue    continue the pipeline from that step (later steps run again)\n' +
        '  --force       skip the check that the lead completed the step dependencies\n' +
        'Examples:\n' +
        '  suntropy satvolt leads run-step 62 2034 ESTIMATE_CONSUMPTION\n' +
        '  suntropy satvolt leads run-step 62 2081 f8771dae3f963702 --continue',
    )
    .option('--continue', 'Continue the pipeline after the step')
    .option('--force', 'Run even if the lead has not completed the step dependencies')
    .action(async (campaignId, leadId, step, opts) => {
      const global = getGlobalOpts(leads);
      try {
        const data = await call(
          satvoltClient(global),
          'post',
          `/campaigns/${parseId(campaignId, 'campaignId')}/leads/${parseId(leadId, 'leadId')}/steps/${encodeURIComponent(step)}/run`,
          { data: { mode: opts.continue ? 'continue' : 'only', force: opts.force === true } },
        );
        output(data, global);
      } catch (err) {
        const mapped = satvoltError(err);
        if (mapped.code === 'CREDIT_LIMIT_REACHED') {
          mapped.message =
            `${mapped.message} Raise it with: suntropy satvolt campaigns credit-limit ${campaignId} <credits>.`;
        }
        outputError(mapped);
      }
    });

  registerFieldsCommand(leads, 'Same as `satvolt export-tables fields`.');
}
