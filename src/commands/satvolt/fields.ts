import type { Command } from 'commander';
import { output, outputError } from '../../output.js';
import { call, getGlobalOpts, parseId, satvoltClient, satvoltError } from './api.js';

interface Field {
  path: string;
  label: string;
  type: string;
  source?: string;
  coverage?: number | null;
  example?: unknown;
}

interface FieldCatalog {
  sampledLeads: number;
  lead: Field[];
  synthetic: Field[];
  steps: Array<{
    uid: string | null;
    action: string;
    name: string;
    keys: string[];
    coverage: number | null;
    fields: Field[];
    dynamic: Array<{ path: string; description: string; inferredFrom?: { campaignId: number; sampledLeads: number } }>;
  }>;
  other: Field[];
}

const pct = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${Math.round(v * 100)}%`);

/** One row per path, with the step it belongs to, for human and CSV output. */
function flatten(catalog: FieldCatalog, onlyStep: boolean): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  const push = (group: string, f: Field, source = f.source) =>
    rows.push({ group, path: f.path, label: f.label, type: f.type, source, coverage: pct(f.coverage), example: f.example ?? null });
  if (!onlyStep) {
    for (const f of catalog.lead) push('Lead', f, 'lead');
    for (const f of catalog.synthetic) push('Lead', f, 'synthetic');
  }
  for (const step of catalog.steps) {
    const group = `${step.name} [${step.action}]`;
    for (const f of step.fields) push(group, f);
    for (const d of step.dynamic) {
      rows.push({
        group,
        path: `${d.path}.*`,
        label: '-',
        type: '-',
        source: 'dynamic',
        coverage: '-',
        example: d.inferredFrom
          ? `${d.description} Fields above inferred from campaign ${d.inferredFrom.campaignId}.`
          : d.description,
      });
    }
  }
  if (!onlyStep) for (const f of catalog.other) push('Other (no current step)', f);
  return rows;
}

export function registerFieldsCommand(parent: Command, note?: string): void {
  parent
    .command('fields <campaignId>')
    .summary('Fields for export table columns, grouped by pipeline step.')
    .description(
      'Data paths for export table columns, grouped by pipeline step. Each step lists the\n' +
        'fields it declares (available before the campaign has data) plus the ones seen in a\n' +
        'sample of leads, with column type, coverage and an example. AI agent responses depend\n' +
        'on the agent: until this campaign has answers they are inferred from another campaign\n' +
        'of yours with the same agent (source: otherCampaign).\n' +
        'source: catalog (declared by the step) | observed (seen in leads) | otherCampaign |\n' +
        '        dynamic (shape depends on the step config) | lead | synthetic\n' +
        '--search matches path and label (labels are in English: consumption, email…).\n' +
        (note ? `${note}\n` : '') +
        'Examples:\n' +
        '  suntropy satvolt export-tables fields 59 --format human\n' +
        '  suntropy satvolt export-tables fields 59 --step QUALIFY --format human\n' +
        '  suntropy satvolt export-tables fields 59 --search cnae --format human',
    )
    .option('--sample <n>', 'Leads to sample (max 100)', '25')
    .option('--step <step>', 'Only this step: uid, ACTION (if unique), step name or fullData key')
    .option('--search <text>', 'Only paths or labels containing this text')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(parent);
      try {
        const catalog: FieldCatalog = await call(
          satvoltClient(global, 120000),
          'get',
          `/campaigns/${parseId(campaignId, 'campaignId')}/fields`,
          { params: { sample: opts.sample, step: opts.step } },
        );
        const search = typeof opts.search === 'string' ? opts.search.toLowerCase() : undefined;
        if (global.format === 'json') {
          if (search) {
            const match = (f: Field) => f.path.toLowerCase().includes(search) || f.label?.toLowerCase().includes(search);
            catalog.lead = catalog.lead.filter(match);
            catalog.synthetic = catalog.synthetic.filter(match);
            catalog.other = catalog.other.filter(match);
            catalog.steps = catalog.steps
              .map((s) => ({ ...s, fields: s.fields.filter(match) }))
              .filter((s) => s.fields.length > 0);
          }
          output(catalog, global);
          return;
        }
        let rows = flatten(catalog, Boolean(opts.step));
        if (search) {
          rows = rows.filter(
            (r) => String(r.path).toLowerCase().includes(search) || String(r.label).toLowerCase().includes(search),
          );
        }
        output(rows, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });
}
