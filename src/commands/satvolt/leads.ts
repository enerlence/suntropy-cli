import { Command } from 'commander';
import { output, outputError, outputPaginated } from '../../output.js';
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
        '  --step <uid|ACTION>    pipeline step (ACTION only if it appears once)\n' +
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
    .option('--step <uid|ACTION>', 'Filter by pipeline step')
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
        outputPaginated(page.items, page.total, page.limit, page.offset, outOpts);
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
    .command('fields <campaignId>')
    .description(
      'Data paths available for export table columns: lead.* columns, synthetic.* and the\n' +
        'fullData.* leaves found in a sample of the campaign leads, with type, coverage\n' +
        '(share of sampled leads that have it) and an example value.\n' +
        'Example:\n' +
        '  suntropy satvolt leads fields 59 --sample 50 --format human',
    )
    .option('--sample <n>', 'Leads to sample (max 100)', '25')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(leads);
      try {
        const data = await call(satvoltClient(global, 120000), 'get', `/campaigns/${parseId(campaignId, 'campaignId')}/fields`, {
          params: { sample: opts.sample },
        });
        if (global.format === 'json') {
          output(data, global);
        } else {
          output(
            [
              ...data.lead.map((f: { path: string }) => ({ path: f.path, type: 'column', coverage: 1, example: null })),
              ...data.synthetic.map((f: { path: string }) => ({ path: f.path, type: 'synthetic', coverage: 1, example: null })),
              ...data.fullData,
            ],
            global,
          );
        }
      } catch (err) {
        outputError(satvoltError(err));
      }
    });
}
