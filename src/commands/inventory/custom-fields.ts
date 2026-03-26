import { Command } from 'commander';
import { createServiceClient, handleApiError } from '../../client.js';
import { output, outputError, type OutputOptions } from '../../output.js';

function getGlobalOpts(cmd: Command): OutputOptions & Record<string, unknown> {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

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
        const client = createServiceClient('solar', global);
        const res = await client.get('/custom-asset/custom-field/all');
        output(res.data, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.get(`/custom-asset/custom-field/id/${id}`);
        output(res.data, global);
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
        const client = createServiceClient('solar', global);
        const body = parseData(opts.data);
        const res = await client.post('/custom-asset/custom-field', body);
        output(res.data, global);
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
        const client = createServiceClient('solar', global);
        const body = parseData(opts.data);
        const res = await client.put(`/custom-asset/custom-field/${id}`, body);
        output(res.data, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.delete(`/custom-asset/custom-field/${id}`);
        output(res.data ?? { success: true, deleted: id }, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
