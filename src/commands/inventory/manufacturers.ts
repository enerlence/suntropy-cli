import { Command } from 'commander';
import { createServiceClient, handleApiError } from '../../client.js';
import { output, outputError, type OutputOptions } from '../../output.js';

function getGlobalOpts(cmd: Command): OutputOptions & Record<string, unknown> {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

export function registerManufacturersCommands(inventory: Command): void {
  const mfr = inventory.command('manufacturers').description('Manage manufacturers (referenced by all inventory devices)');

  mfr
    .command('list')
    .description('List all manufacturers. Fields: idManufacturer, name, imageUrl')
    .action(async () => {
      try {
        const global = getGlobalOpts(mfr);
        const client = createServiceClient('solar', global);
        const res = await client.get('/manufacturers');
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  mfr
    .command('create')
    .description('Create a new manufacturer')
    .requiredOption('--data <json>', 'JSON: { "name": "Manufacturer Name", "imageUrl": "..." }')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(mfr);
        const client = createServiceClient('solar', global);
        const body = JSON.parse(opts.data);
        const res = await client.post('/manufacturers', body);
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
