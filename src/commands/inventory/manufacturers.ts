import { Command } from 'commander';
import { handleApiError } from '../../client.js';
import { output, outputError } from '../../output.js';
import { invoke } from '../../api/core.js';
import { MANUFACTURERS } from '../../api/ops/inventory.js';
import { getGlobalOpts } from './factory.js';

export function registerManufacturersCommands(inventory: Command): void {
  const mfr = inventory.command('manufacturers').description('Manage manufacturers (referenced by all inventory devices)');

  mfr
    .command('list')
    .description('List all manufacturers. Fields: idManufacturer, name, imageUrl')
    .action(async () => {
      try {
        const global = getGlobalOpts(mfr);
        output(await invoke(MANUFACTURERS.list, global, undefined), global);
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
        output(await invoke(MANUFACTURERS.create, global, { body: JSON.parse(opts.data) }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
