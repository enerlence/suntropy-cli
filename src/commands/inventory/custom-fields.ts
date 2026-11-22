import { Command } from 'commander';
import { handleApiError } from '../../client.js';
import { output, outputError } from '../../output.js';
import { invoke } from '../../api/core.js';
import { CUSTOM_FIELDS } from '../../api/ops/inventory.js';
import { getGlobalOpts } from './factory.js';

function parseData(data: string | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  return JSON.parse(data);
}

export function registerCustomFieldsCommands(inventory: Command): void {
  const fields = inventory.command('custom-fields').description(
    'Manage custom fields for custom asset types.\n' +
    'Fields define the schema of a custom asset type (e.g. text, number, options).\n' +
    'Types: text, number, date, datetime, time, email, phonenumber, website, options, labels, currency, large_text, user'
  );

  // --- list ---
  fields
    .command('list')
    .description('List all custom fields')
    .action(async () => {
      try {
        const global = getGlobalOpts(fields);
        output(await invoke(CUSTOM_FIELDS.list, global, undefined), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- get ---
  fields
    .command('get <id>')
    .description('Get a custom field by ID')
    .action(async (id) => {
      try {
        const global = getGlobalOpts(fields);
        output(await invoke(CUSTOM_FIELDS.get, global, { id }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- create ---
  fields
    .command('create')
    .description(
      'Create a custom field for a custom asset type.\n' +
      'Required: label, type, customAssetTypeId\n' +
      'For options/labels type, include customFieldOptions array.\n\n' +
      'Example:\n' +
      '  suntropy inventory custom-fields create --data \'{"label":"Power","type":"number","customAssetTypeId":1}\'\n' +
      '  suntropy inventory custom-fields create --data \'{"label":"Size","type":"options","customAssetTypeId":1,"customFieldOptions":[{"label":"S","value":"s"},{"label":"M","value":"m"},{"label":"L","value":"l"}]}\''
    )
    .requiredOption('--data <json>', 'Field definition as JSON')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(fields);
        output(await invoke(CUSTOM_FIELDS.create, global, { body: parseData(opts.data) }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- update ---
  fields
    .command('update <id>')
    .description('Update a custom field')
    .requiredOption('--data <json>', 'Updated field data as JSON')
    .action(async (id, opts) => {
      try {
        const global = getGlobalOpts(fields);
        output(await invoke(CUSTOM_FIELDS.update, global, { id, body: parseData(opts.data) }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- delete ---
  fields
    .command('delete <id>')
    .description('Delete a custom field')
    .action(async (id) => {
      try {
        const global = getGlobalOpts(fields);
        output(await invoke(CUSTOM_FIELDS.delete, global, { id }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
