import { Command } from 'commander';
import { createResourceCommands } from './factory.js';
import { createServiceClient, handleApiError } from '../../client.js';
import { output, outputError, type OutputOptions } from '../../output.js';

function getGlobalOpts(cmd: Command): OutputOptions & Record<string, unknown> {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

function parseData(data: string): Record<string, unknown> {
  if (data === '-') {
    const { readFileSync } = require('fs');
    return JSON.parse(readFileSync(0, 'utf-8'));
  }
  return JSON.parse(data);
}

export function registerKitsCommands(inventory: Command): void {
  // Base kit CRUD via factory
  const kits = createResourceCommands({
    name: 'kits',
    singular: 'solar kit',
    basePath: '/solar-kits',
    idField: 'idSolarKit',
    listFields: ['identifier', 'peakPower', 'panelNumber', 'inverterNumber', 'price', 'totalPrice', 'phaseNumber', 'active'],
    filterPath: '/solar-kits/filters',
    batchDeletePath: 'delete-batch-solar-kits',
    getViaFilter: true,
  });

  // --- archive ---
  kits
    .command('archive <kitId>')
    .description('Archive a solar kit (soft-disable)')
    .action(async (kitId) => {
      try {
        const global = getGlobalOpts(kits);
        const client = createServiceClient('solar', global);
        const res = await client.put(`/solar-kits/archive/${kitId}`);
        output(res.data ?? { success: true, archived: kitId }, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.get('/solar-kits/solar-panels', { params: { limit: opts.limit, offset: opts.offset } });
        output(res.data, global);
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
        const client = createServiceClient('solar', global);
        // Use filter to get by ID since there's no direct GET by ID
        const res = await client.post('/solar-kits/solar-panels/filter', { idKitSolarPanel: id });
        const data = Array.isArray(res.data) ? res.data[0] : res.data?.data?.[0] || res.data;
        output(data, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.post('/solar-kits/solar-panels', parseData(opts.data));
        output(res.data, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.put(`/solar-kits/solar-panels/${id}`, parseData(opts.data));
        output(res.data, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.delete(`/solar-kits/solar-panels/${id}`);
        output(res.data ?? { success: true, deleted: id }, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.get(`/solar-kits/solar-panels/findFeaturedSolarKits/${kitPanelId}`);
        output(res.data, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.get('/solar-kits/inverters', { params: { limit: opts.limit, offset: opts.offset } });
        output(res.data, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.post('/solar-kits/inverters', parseData(opts.data));
        output(res.data, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.put(`/solar-kits/inverters/${id}`, parseData(opts.data));
        output(res.data, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.delete(`/solar-kits/inverters/${id}`);
        output(res.data ?? { success: true, deleted: id }, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.get(`/solar-kits/inverters/findFeaturedSolarKits/${kitInverterId}`);
        output(res.data, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.get('/solar-kits/batteries', { params: { limit: opts.limit, offset: opts.offset } });
        output(res.data, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.post('/solar-kits/batteries', parseData(opts.data));
        output(res.data, global);
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
        const client = createServiceClient('solar', global);
        const res = await client.delete(`/solar-kits/batteries/${id}`);
        output(res.data ?? { success: true, deleted: id }, global);
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
    .option('--price <eur>', 'Kit price in EUR')
    .option('--phase <type>', 'Phase: single_phase or three_phase', 'single_phase')
    .option('--coplanar', 'Coplanar mounting')
    .option('--taxes <pct>', 'Default tax percentage', '21')
    .option('--custom-asset <id:units>', 'Custom asset as id:units (repeatable)', collectCustomAssets, [])
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(kits);
        const client = createServiceClient('solar', global);

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
        if (opts.price) body.price = parseFloat(opts.price);
        if (opts.coplanar) body.coplanar = true;

        // Parse custom assets: [{id, units}, ...]
        if (opts.customAsset && opts.customAsset.length > 0) {
          body.solarKitCustomAssets = opts.customAsset.map((ca: { id: number; units: number }) => ({
            customAsset: { idCustomAsset: ca.id },
            units: ca.units,
          }));
        }

        const res = await client.post('/solar-kits', body);
        output(res.data, global);
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
