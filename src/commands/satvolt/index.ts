import { Command } from 'commander';
import { output, outputError } from '../../output.js';
import { call, getGlobalOpts, satvoltClient, satvoltError } from './api.js';
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
        'Typical flow:\n' +
        '  satvolt catalog actions                      actions and their config schema\n' +
        '  satvolt campaigns create --circle ... --steps @steps.json\n' +
        '  satvolt campaigns start <id>   ·   satvolt campaigns logs <id> --follow\n' +
        '  satvolt campaigns funnel <id>  ·   satvolt leads list <id> --step QUALIFY\n' +
        '  satvolt export-tables create <id> ... · satvolt export-tables export <tableId>\n' +
        '  satvolt campaigns resume <id> --action AI_AGENT --config @step.json\n' +
        '  satvolt templates create --name <n> --from-campaign <id> · campaigns create --template <n>\n' +
        '  satvolt campaigns extend <id> --max-leads N · leads run-step <id> <leadId> <step>',
    );

  registerSatvoltCampaignCommands(satvolt);
  registerSatvoltPipelineCommands(satvolt);
  registerSatvoltLeadCommands(satvolt);
  registerSatvoltExportTableCommands(satvolt);
  registerSatvoltTemplateCommands(satvolt);

  const catalog = satvolt
    .command('catalog')
    .description('Reference data for building campaigns and pipelines.');

  const catalogEntries: Array<[string, string, string]> = [
    ['actions', '/catalog/actions', 'Pipeline actions: credits per lead, dependencies, multiple, and the JSON Schema of their config.'],
    ['ai-agents', '/catalog/ai-agents', 'AI agents allowed in AI_AGENT config.agentId.'],
    ['business-groups', '/catalog/business-groups', 'Business category groups for --business-groups.'],
    ['states', '/catalog/states', 'Campaign and lead states.'],
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
