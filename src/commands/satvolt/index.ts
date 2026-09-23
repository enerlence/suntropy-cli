import { Command } from 'commander';
import { output, outputError } from '../../output.js';
import { call, getGlobalOpts, satvoltClient, satvoltError, SATVOLT_DEV_BASE_URL } from './api.js';
import { registerSatvoltCampaignCommands } from './campaigns.js';
import { registerSatvoltPipelineCommands } from './pipeline.js';
import { registerSatvoltLeadCommands } from './leads.js';
import { registerSatvoltExportTableCommands } from './export-tables.js';
import { registerSatvoltTemplateCommands } from './templates.js';

export function registerSatvoltCommands(program: Command): void {
  const satvolt = program
    .command('satvolt')
    .description(
      'Satvolt lead-generation campaigns (public API /satvolt/api/v1), with the same auth token.\n' +
        `Preliminary testing phase: every call is pinned to the dev cluster (${SATVOLT_DEV_BASE_URL}),\n` +
        'whatever the active profile says. Override with SUNTROPY_SATVOLT_URL, or use a localhost server.\n' +
        'Typical flow:\n' +
        '  satvolt catalog actions                      actions and their config schema\n' +
        '  satvolt campaigns create --circle ... --steps @steps.json\n' +
        '  satvolt campaigns start <id>   ·   satvolt campaigns logs <id> --follow\n' +
        '  satvolt campaigns funnel <id>  ·   satvolt leads list <id> --step QUALIFY\n' +
        '  satvolt export-tables create <id> ... · satvolt export-tables export <tableId>\n' +
        '  satvolt campaigns resume <id> --action AI_AGENT --config @step.json\n' +
        '  satvolt templates create --name <n> --from-campaign <id> · campaigns create --template <n>\n' +
        '  satvolt campaigns extend <id> --max-leads N · leads run-step <id> <leadId> <step>\n' +
        '  satvolt campaigns pause <id> · unpause <id> · cancel <id> --yes\n' +
        '  satvolt usage [--month YYYY-MM]              credits spent by the account this month',
    );

  registerSatvoltCampaignCommands(satvolt);
  registerSatvoltPipelineCommands(satvolt);
  registerSatvoltLeadCommands(satvolt);
  registerSatvoltExportTableCommands(satvolt);
  registerSatvoltTemplateCommands(satvolt);

  // --- usage (account) ---
  satvolt
    .command('usage')
    .summary('Credits spent by the whole account in a calendar month, by campaign and by step.')
    .description(
      'Credits spent by the whole account in a calendar month (UTC): total, previous\n' +
        'month for comparison, and the breakdown by campaign and by step. It sums every\n' +
        'charge in the period, including the Google Maps search (FIND_LEADS), so it\n' +
        'does not have to match `campaigns usage`, which reconstructs the cost of one\n' +
        'campaign and leaves the search out.\n' +
        'Examples:\n' +
        '  suntropy satvolt usage\n' +
        '  suntropy satvolt usage --month 2026-08 --format human',
    )
    .option('--month <YYYY-MM>', 'Month to report (default: current month)')
    .action(async (opts) => {
      const global = getGlobalOpts(satvolt);
      try {
        if (opts.month !== undefined && !/^\d{4}-\d{2}$/.test(String(opts.month))) {
          throw new Error('--month must be YYYY-MM, e.g. 2026-08');
        }
        const data = await call(satvoltClient(global, 120000), 'get', '/usage', { params: { month: opts.month } });
        if (global.format === 'human' || global.format === 'csv') {
          if (global.format === 'human') {
            process.stderr.write(
              `${data.month}: ${data.credits} credits · ${data.executions} executions · previous month (${data.previous.month}): ${data.previous.credits} credits\n\n`,
            );
          }
          output(data.byCampaign, global);
          return;
        }
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  const catalog = satvolt
    .command('catalog')
    .description('Reference data for building campaigns and pipelines.');

  const catalogEntries: Array<[string, string, string]> = [
    ['actions', '/catalog/actions', 'Pipeline actions: credits per lead (fixed per action; failed or skipped runs are free), dependencies, multiple, and the JSON Schema of their config (the input). The data each step writes: satvolt export-tables fields <campaignId>.'],
    ['ai-agents', '/catalog/ai-agents', 'AI agents allowed in AI_AGENT config.agentId: id, name and description. Every agent costs the AI_AGENT credits.'],
    ['business-groups', '/catalog/business-groups', 'Business category groups for --business-groups.'],
    ['states', '/catalog/states', 'Campaign and lead states.'],
    ['campaign-limits', '/catalog/campaign-limits', 'Goals a campaign can stop at (campaigns create --limit, campaigns limits): key, unit, description.'],
  ];
  for (const [name, path, description] of catalogEntries) {
    catalog
      .command(name)
      .description(description)
      .action(async () => {
        const global = getGlobalOpts(catalog);
        try {
          output(await call(satvoltClient(global), 'get', path), global);
        } catch (err) {
          outputError(satvoltError(err));
        }
      });
  }

  addSummaries(satvolt);
}

/**
 * Commander lists subcommands with their whole description, so multi-line ones
 * (with examples) break the command list. Use the first line as the summary
 * when a command does not set one.
 */
function addSummaries(cmd: Command): void {
  for (const sub of cmd.commands) {
    const description = sub.description();
    if (!sub.summary() && description.includes('\n')) {
      const first = description.split('\n')[0].trim();
      sub.summary(/[.:)]$/.test(first) ? first.replace(/:$/, '.') : `${first}…`);
    }
    addSummaries(sub);
  }
}
