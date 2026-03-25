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

  inventory.addCommand(kits);
}
