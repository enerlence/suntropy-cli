import { Command } from 'commander';
import { output, outputError } from '../../output.js';
import {
  call,
  getGlobalOpts,
  parseId,
  parseIntOption,
  readJsonArg,
  satvoltClient,
  satvoltError,
} from './api.js';

const TEMPLATE_LIST_FIELDS = 'id,name,description,steps,businessGroups,searchQuery,maxLeads,sourceCampaignId';

const splitList = (value: string) => value.split(',').map((s) => s.trim()).filter(Boolean);
const templatePath = (idOrName: string) => `/campaign-templates/${encodeURIComponent(idOrName)}`;

/**
 * `satvolt templates`: reusable campaign configuration (pipeline steps, business
 * groups, description, search query and lead limit) without name or area.
 */
export function registerSatvoltTemplateCommands(satvolt: Command): void {
  const templates = satvolt
    .command('templates')
    .summary('Campaign templates: reuse a pipeline for probes, final campaigns or new areas.')
    .description(
      'Campaign templates keep everything that defines a campaign except its name and area:\n' +
        'pipeline steps (with their uids), business groups, configuration description, search\n' +
        'query and lead limit. Reference them by id or by exact name.\n' +
        'Typical flow:\n' +
        '  satvolt templates create --name "Greenvolt industria" --from-campaign 62\n' +
        '  satvolt campaigns create --name "Sonda Elche" --template "Greenvolt industria" \\\n' +
        '    --circle 38.29,-0.61 --radius 3000 --max-leads 50',
    );

  templates
    .command('list')
    .description('List the campaign templates of your company.')
    .option('--search <text>', 'Filter by name')
    .action(async (opts) => {
      const global = getGlobalOpts(templates);
      try {
        const data = await call<any[]>(satvoltClient(global), 'get', '/campaign-templates', {
          params: { search: opts.search },
        });
        if (global.format === 'human' && !global.fields) {
          output(
            data.map((t) => ({ ...t, steps: t.steps.map((s: any) => s.action).join(' → '), businessGroups: t.businessGroups.join(',') })),
            { ...global, fields: TEMPLATE_LIST_FIELDS },
          );
          return;
        }
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  templates
    .command('get <idOrName>')
    .description('Template detail, with its full steps and config.')
    .action(async (idOrName) => {
      const global = getGlobalOpts(templates);
      try {
        output(await call(satvoltClient(global), 'get', templatePath(idOrName)), global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  templates
    .command('create')
    .summary('Create a template from a campaign or from JSON steps.')
    .description(
      'Create a template from a campaign (--from-campaign) or from JSON steps.\n' +
        'Steps are LEAD steps, validated like `campaigns create` (defaults filled, missing\n' +
        'dependencies added). Business groups default to "businesses".\n' +
        'Examples:\n' +
        '  suntropy satvolt templates create --name "Greenvolt industria" --from-campaign 62\n' +
        '  suntropy satvolt templates create --name "Solo tejados" --steps \'[{"action":"FIND_ROOFTOP"}]\' --max-leads 100\n' +
        '  suntropy satvolt templates create --data @template.json',
    )
    .option('--name <name>', 'Template name (unique in your company)')
    .option('--description <text>', 'What the template is for')
    .option('--from-campaign <id>', 'Copy the configuration of this Maps campaign')
    .option('--steps <json>', 'LEAD steps as JSON array, @file or -')
    .option('--business-groups <ids>', 'Comma-separated business group ids')
    .option('--configuration-description <text>', 'Natural language description copied to campaigns')
    .option('--search-query <text>', 'Places text search query')
    .option('--max-leads <n>', 'Default lead limit of campaigns created from it')
    .option('--data <json>', 'Full request body (JSON, @file or -); flags override its fields')
    .action(async (opts) => {
      const global = getGlobalOpts(templates);
      try {
        const body: Record<string, unknown> = opts.data ? readJsonArg(opts.data, '--data') : {};
        if (opts.name) body.name = opts.name;
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.fromCampaign) body.fromCampaignId = parseId(opts.fromCampaign, '--from-campaign');
        if (opts.steps) body.steps = readJsonArg(opts.steps, '--steps');
        if (opts.businessGroups) body.businessGroups = splitList(opts.businessGroups);
        if (opts.configurationDescription !== undefined) body.configurationDescription = opts.configurationDescription;
        if (opts.searchQuery) body.searchQuery = opts.searchQuery;
        if (opts.maxLeads !== undefined) body.maxLeads = parseIntOption(opts.maxLeads, '--max-leads');
        if (!body.name) throw new Error('--name is required');
        if (body.fromCampaignId === undefined && body.steps === undefined) {
          throw new Error('Pass --from-campaign <id> or --steps <json>');
        }
        output(await call(satvoltClient(global), 'post', '/campaign-templates', { data: body }), global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  templates
    .command('update <idOrName>')
    .summary('Replace a whole template (PUT).')
    .description(
      'Replace a template (PUT). The body is the whole template: steps are required and\n' +
        'omitted fields are cleared. Tip: `templates get <id> --save t.json`, edit, update.',
    )
    .requiredOption('--data <json>', 'Template body (JSON, @file or -)')
    .action(async (idOrName, opts) => {
      const global = getGlobalOpts(templates);
      try {
        output(
          await call(satvoltClient(global), 'put', templatePath(idOrName), { data: readJsonArg(opts.data, '--data') }),
          global,
        );
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  templates
    .command('patch <idOrName>')
    .summary('Change some fields or steps of a template.')
    .description(
      'Change some fields of a template. --steps takes step patches by uid, like\n' +
        '`config patch`: {uid, config} merges (null resets a key to its default),\n' +
        '{uid, remove: true} deletes, {action, config} without uid adds a step.\n' +
        'Examples:\n' +
        '  suntropy satvolt templates patch "Greenvolt industria" --max-leads 500\n' +
        '  suntropy satvolt templates patch "Greenvolt industria" --no-max-leads --business-groups businesses\n' +
        '  suntropy satvolt templates patch <id> --steps \'[{"uid":"8771dae3f9637027","config":{"tariffTemplate":"6.1TD"}}]\'',
    )
    .option('--name <name>', 'Rename the template')
    .option('--description <text>', 'New description')
    .option('--steps <json>', 'Step patches as JSON array, @file or -')
    .option('--business-groups <ids>', 'Comma-separated business group ids (empty string: no filter)')
    .option('--configuration-description <text>', 'Natural language description copied to campaigns')
    .option('--search-query <text>', 'Places text search query (empty string removes it)')
    .option('--max-leads <n>', 'Default lead limit')
    .option('--no-max-leads', 'Remove the default lead limit')
    .option('--data <json>', 'Patch body (JSON, @file or -); flags override its fields')
    .action(async (idOrName, opts) => {
      const global = getGlobalOpts(templates);
      try {
        const body: Record<string, unknown> = opts.data ? readJsonArg(opts.data, '--data') : {};
        if (opts.name) body.name = opts.name;
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.steps) body.steps = readJsonArg(opts.steps, '--steps');
        if (opts.businessGroups !== undefined) body.businessGroups = splitList(opts.businessGroups);
        if (opts.configurationDescription !== undefined) body.configurationDescription = opts.configurationDescription;
        if (opts.searchQuery !== undefined) body.searchQuery = opts.searchQuery === '' ? null : opts.searchQuery;
        // commander: --max-leads <n> sets a string, --no-max-leads sets false.
        if (opts.maxLeads === false) body.maxLeads = null;
        else if (opts.maxLeads !== undefined && opts.maxLeads !== true) body.maxLeads = parseIntOption(opts.maxLeads, '--max-leads');
        if (Object.keys(body).length === 0) throw new Error('Nothing to change: pass at least one option');
        output(await call(satvoltClient(global), 'patch', templatePath(idOrName), { data: body }), global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  templates
    .command('delete <idOrName>')
    .description('Delete a template. Campaigns created from it are not affected.')
    .option('--yes', 'Confirm the deletion (required)')
    .action(async (idOrName, opts) => {
      const global = getGlobalOpts(templates);
      try {
        if (!opts.yes) throw new Error('Re-run with --yes to delete the template.');
        output(await call(satvoltClient(global), 'delete', templatePath(idOrName)), global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });
}
