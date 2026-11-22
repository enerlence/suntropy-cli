import { Command } from 'commander';
import { createResourceCommands, getGlobalOpts, parseData } from './factory.js';
import { handleApiError } from '../../client.js';
import { output, outputError } from '../../output.js';
import { invoke, type GlobalOptions, type Operation } from '../../api/core.js';
import { inventoryOps, KITS, KIT_BATTERIES, KIT_INVERTERS, KIT_PANELS } from '../../api/ops/inventory.js';
import { KITS_RESOURCE, resourceByName } from './resources.js';

/** Whether `op` finds `id`: a 404 or an empty body is «missing», anything else that fails is «error». */
async function lookup(op: Operation<{ id: string }, unknown>, global: GlobalOptions, id: string): Promise<'found' | 'missing' | 'error'> {
  try {
    const item = await invoke(op, global, { id });
    const empty = item == null || (typeof item === 'object' && Object.keys(item as object).length === 0);
    return empty ? 'missing' : 'found';
  } catch (err) {
    const api = handleApiError(err);
    return api.status === 404 || api.code === 'NOT_FOUND' || /not found/i.test(api.message) ? 'missing' : 'error';
  }
}

export function registerKitsCommands(inventory: Command): void {
  // Base kit CRUD via factory
  const kits = createResourceCommands(KITS_RESOURCE);

  // Remove factory-generated 'create' — use 'assemble' instead for safe kit creation
  const kitsCreateIdx = kits.commands.findIndex((c: Command) => c.name() === 'create');
  if (kitsCreateIdx !== -1) (kits.commands as Command[]).splice(kitsCreateIdx, 1);

  // --- archive ---
  kits
    .command('archive <kitId>')
    .description('Archive a solar kit (soft-disable)')
    .action(async (kitId) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KITS.archive, global, { id: kitId }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- Kit panels sub-commands ---
  const kitPanels = kits.command('panels').description('Manage kit solar panels');

  kitPanels
    .command('list')
    .description('List all kit solar panels. Fields: idKitSolarPanel, name, manufacturer, peakPower, efficiency, costPerUnit')
    .option('--limit <n>', 'Max results', '50')
    .option('--offset <n>', 'Skip results', '0')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KIT_PANELS.list, global, undefined), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  kitPanels
    .command('get <id>')
    .description('Get a kit solar panel by ID')
    .action(async (id) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KIT_PANELS.get, global, { id }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  kitPanels
    .command('create')
    .description('Create a kit solar panel')
    .requiredOption('--data <json>', 'JSON data')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KIT_PANELS.create, global, { body: parseData(opts.data) ?? {} }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  kitPanels
    .command('update <id>')
    .description('Update a kit solar panel')
    .requiredOption('--data <json>', 'JSON data')
    .action(async (id, opts) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KIT_PANELS.update, global, { id, body: parseData(opts.data) ?? {} }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  kitPanels
    .command('delete <id>')
    .description('Delete a kit solar panel')
    .action(async (id) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KIT_PANELS.delete, global, { id }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  kitPanels
    .command('featured <kitPanelId>')
    .description('List solar kits that feature this kit panel')
    .action(async (kitPanelId) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KIT_PANELS.featured, global, { id: kitPanelId }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- Kit inverters sub-commands ---
  const kitInverters = kits.command('inverters').description('Manage kit inverters');

  kitInverters
    .command('list')
    .description('List all kit inverters. Fields: idKitInverter, name, manufacturer, nominalPower, efficiency, costPerUnit')
    .option('--limit <n>', 'Max results', '50')
    .option('--offset <n>', 'Skip results', '0')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KIT_INVERTERS.list, global, undefined), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  kitInverters
    .command('create')
    .description('Create a kit inverter')
    .requiredOption('--data <json>', 'JSON data')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KIT_INVERTERS.create, global, { body: parseData(opts.data) ?? {} }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  kitInverters
    .command('update <id>')
    .description('Update a kit inverter')
    .requiredOption('--data <json>', 'JSON data')
    .action(async (id, opts) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KIT_INVERTERS.update, global, { id, body: parseData(opts.data) ?? {} }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  kitInverters
    .command('delete <id>')
    .description('Delete a kit inverter')
    .action(async (id) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KIT_INVERTERS.delete, global, { id }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  kitInverters
    .command('featured <kitInverterId>')
    .description('List solar kits that feature this kit inverter')
    .action(async (kitInverterId) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KIT_INVERTERS.featured, global, { id: kitInverterId }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- Kit batteries sub-commands ---
  const kitBatteries = kits.command('batteries').description('Manage kit batteries');

  kitBatteries
    .command('list')
    .description('List all kit batteries. Fields: idKitBattery, name, manufacturer, capacity, costPerUnit')
    .option('--limit <n>', 'Max results', '50')
    .option('--offset <n>', 'Skip results', '0')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KIT_BATTERIES.list, global, undefined), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  kitBatteries
    .command('create')
    .description('Create a kit battery')
    .requiredOption('--data <json>', 'JSON data')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KIT_BATTERIES.create, global, { body: parseData(opts.data) ?? {} }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  kitBatteries
    .command('delete <id>')
    .description('Delete a kit battery')
    .action(async (id) => {
      try {
        const global = getGlobalOpts(kits);
        output(await invoke(KIT_BATTERIES.delete, global, { id }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- assemble: create kit from existing components by ID ---
  kits
    .command('assemble')
    .description(
      'Assemble a solar kit from existing components by ID.\n' +
      'References kit panels, inverters, batteries, and custom assets by their IDs.\n\n' +
      'Custom assets format: --custom-asset <assetId>:<units> (repeatable)\n\n' +
      'Examples:\n' +
      '  suntropy inventory kits assemble --name "Kit 5kW" --panel 123 --inverter 456 --panels-count 12 --price 6500\n' +
      '  suntropy inventory kits assemble --name "Kit Premium" --panel 123 --inverter 456 --battery 789 \\\n' +
      '    --panels-count 12 --inverters-count 1 --batteries-count 1 --peak-power 5.4 --price 8500 \\\n' +
      '    --custom-asset 100:12 --custom-asset 200:1 --phase single_phase'
    )
    .requiredOption('--name <identifier>', 'Kit name/identifier')
    .option('--panel <kitPanelId>', 'Kit panel ID (idKitSolarPanel)')
    .option('--inverter <kitInverterId>', 'Kit inverter ID (idKitInverter)')
    .option('--battery <batteryId>', 'Battery ID from inventory (batteryId)')
    .option('--panels-count <n>', 'Number of panels', '12')
    .option('--inverters-count <n>', 'Number of inverters', '1')
    .option('--batteries-count <n>', 'Number of batteries', '0')
    .option('--peak-power <kW>', 'Total peak power in kW')
    .requiredOption('--price <eur>', 'Kit price in EUR (required)')
    .option('--phase <type>', 'Phase: single_phase or three_phase', 'single_phase')
    .option('--coplanar', 'Coplanar mounting')
    .option('--taxes <pct>', 'Default tax percentage', '21')
    .option('--custom-asset <id:units>', 'Custom asset as id:units (repeatable)', collectCustomAssets, [])
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(kits);

        // Validate component IDs exist before assembling: kit panel, kit
        // inverter and inventory battery (the kit's `battery` is a Battery).
        const validationErrors: string[] = [];
        const checks: Array<[string | undefined, Operation<{ id: string }, unknown>, string, string]> = [
          [
            opts.panel,
            KIT_PANELS.get,
            `Panel ID ${opts.panel} is not a KitSolarPanel. Use "suntropy inventory kits panels list" to see available kit panels, ` +
              `or "suntropy inventory kits panels create --data '{...}'" to create one first.`,
            `Could not validate panel ID ${opts.panel}. Make sure it is a KitSolarPanel ID (not a regular inventory panel). ` +
              `Use "suntropy inventory kits panels list" to see available kit panels.`,
          ],
          [
            opts.inverter,
            KIT_INVERTERS.get,
            `Inverter ID ${opts.inverter} is not a KitInverter. Use "suntropy inventory kits inverters list" to see available kit inverters, ` +
              `or "suntropy inventory kits inverters create --data '{...}'" to create one first.`,
            `Could not validate inverter ID ${opts.inverter}. Make sure it is a KitInverter ID (not a regular inventory inverter). ` +
              `Use "suntropy inventory kits inverters list" to see available kit inverters.`,
          ],
          [
            opts.battery,
            inventoryOps(resourceByName('batteries')).get,
            `Battery ID ${opts.battery} is not a battery of your inventory (batteryId). Use "suntropy inventory batteries list" to see them.`,
            `Could not validate battery ID ${opts.battery}. Use "suntropy inventory batteries list" to see your batteries.`,
          ],
        ];
        for (const [id, op, missing, failed] of checks) {
          if (!id) continue;
          const found = await lookup(op, global, id);
          if (found === 'missing') validationErrors.push(missing);
          if (found === 'error') validationErrors.push(failed);
        }

        if (validationErrors.length > 0) {
          outputError({
            error: true,
            message: 'Kit assembly validation failed',
            issues: validationErrors,
            hint: 'The assemble command requires KitSolarPanel and KitInverter IDs (kit-specific entities) and a battery from your inventory.',
          });
          return;
        }

        const body: Record<string, unknown> = {
          identifier: opts.name,
          panelNumber: parseInt(opts.panelsCount),
          inverterNumber: parseInt(opts.invertersCount),
          batteriesNumber: parseInt(opts.batteriesCount),
          phaseNumber: opts.phase,
          defaultTaxesPercentage: parseFloat(opts.taxes),
          active: true,
        };

        if (opts.panel) body.kitSolarPanel = { idKitSolarPanel: parseInt(opts.panel) };
        if (opts.inverter) body.kitInverter = { idKitInverter: parseInt(opts.inverter) };
        if (opts.battery) body.battery = { batteryId: parseInt(opts.battery) };
        if (opts.peakPower) body.peakPower = parseFloat(opts.peakPower);
        body.price = parseFloat(opts.price);
        if (opts.coplanar) body.coplanar = true;

        if (opts.customAsset && opts.customAsset.length > 0) {
          body.solarKitCustomAssets = opts.customAsset.map((ca: { id: number; units: number }) => ({
            customAsset: { idCustomAsset: ca.id },
            units: ca.units,
          }));
        }

        output(await invoke(KITS.assemble, global, { body }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  inventory.addCommand(kits);
}

/** Collector for repeatable --custom-asset <id:units> option */
function collectCustomAssets(value: string, previous: { id: number; units: number }[]): { id: number; units: number }[] {
  const [idStr, unitsStr] = value.split(':');
  const id = parseInt(idStr);
  const units = unitsStr ? parseInt(unitsStr) : 1;
  if (isNaN(id)) throw new Error(`Invalid custom asset format: "${value}". Use <id>:<units> (e.g. 100:12)`);
  return [...previous, { id, units }];
}
