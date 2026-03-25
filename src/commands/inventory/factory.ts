import { Command } from 'commander';
import { createServiceClient, handleApiError } from '../../client.js';
import { output, outputError, outputPaginated, type OutputOptions } from '../../output.js';

export interface ResourceConfig {
  /** Command name (e.g. 'panels') */
  name: string;
  /** Singular display name (e.g. 'solar panel') */
  singular: string;
  /** API base path (e.g. '/solar-panels') */
  basePath: string;
  /** ID field name in the entity (e.g. 'solarPanelId') */
  idField: string;
  /** Fields to show in list view (summary) */
  listFields: string[];
  /** POST path for advanced filter, if different from basePath + '/filter' */
  filterPath?: string;
  /** Batch delete path suffix */
  batchDeletePath?: string;
  /** PUT uses body without ID in URL (some endpoints use PUT / with body containing id) */
  putBodyOnly?: boolean;
  /** Backend service */
  service?: 'solar' | 'templates' | 'security';
}

function getGlobalOpts(cmd: Command): OutputOptions & { server?: string; token?: string; profile?: string; verbose?: boolean } {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

function parseData(data: string | undefined): Record<string, unknown> | undefined {
  if (!data) return undefined;
  if (data === '-') {
    // Read from stdin - synchronous for simplicity
    const { readFileSync } = require('fs');
    const input = readFileSync(0, 'utf-8');
    return JSON.parse(input);
  }
  return JSON.parse(data);
}

export function createResourceCommands(cfg: ResourceConfig): Command {
  const cmd = new Command(cfg.name).description(`Manage ${cfg.singular}s`);
  const service = cfg.service || 'solar';

  // --- list ---
  cmd
    .command('list')
    .description(`List ${cfg.singular}s with pagination. Fields: ${cfg.listFields.join(', ')}`)
    .option('--limit <n>', 'Max results', '20')
    .option('--offset <n>', 'Skip results', '0')
    .option('--active-only', 'Only active items (exclude inactive)')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(cmd);
        const client = createServiceClient(service, global);
        const params: Record<string, unknown> = {
          limit: parseInt(opts.limit),
          offset: parseInt(opts.offset),
        };
        if (!opts.activeOnly) params.unactive = true;

        const res = await client.get(cfg.basePath, { params });
        // API may return: [items[], totalCount] tuple, {data: [], total} object, or plain array
        let data: unknown[];
        let total: number;
        if (Array.isArray(res.data) && res.data.length >= 2 && Array.isArray(res.data[0]) && typeof res.data[1] === 'number') {
          // Tuple format: [items[], totalCount]
          data = res.data[0];
          total = res.data[1];
        } else if (Array.isArray(res.data)) {
          data = res.data;
          total = res.data.length;
        } else {
          data = res.data?.data || [];
          total = res.data?.total ?? data.length;
        }

        // Apply list field summary unless user specified --fields
        const outOpts: OutputOptions = { ...global };
        if (!global.fields && cfg.listFields.length > 0) {
          outOpts.fields = [cfg.idField, ...cfg.listFields].join(',');
        }

        if (Array.isArray(data)) {
          outputPaginated(data, total, parseInt(opts.limit), parseInt(opts.offset), outOpts);
        } else {
          output(data, outOpts);
        }
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- get ---
  cmd
    .command('get <id>')
    .description(`Get a ${cfg.singular} by ID. All fields returned by default.`)
    .action(async (id) => {
      try {
        const global = getGlobalOpts(cmd);
        const client = createServiceClient(service, global);
        const res = await client.get(`${cfg.basePath}/${id}`);
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- create ---
  cmd
    .command('create')
    .description(`Create a new ${cfg.singular}. Pass JSON via --data or stdin (--data -)`)
    .requiredOption('--data <json>', 'JSON data (or - for stdin)')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(cmd);
        const client = createServiceClient(service, global);
        const body = parseData(opts.data);
        const res = await client.post(cfg.basePath, body);
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- update ---
  cmd
    .command('update <id>')
    .description(`Update a ${cfg.singular}`)
    .requiredOption('--data <json>', 'JSON data with fields to update (or - for stdin)')
    .action(async (id, opts) => {
      try {
        const global = getGlobalOpts(cmd);
        const client = createServiceClient(service, global);
        const body = parseData(opts.data);
        if (cfg.putBodyOnly) {
          const res = await client.put(cfg.basePath, { ...body, [cfg.idField]: id });
          output(res.data, global);
        } else {
          const res = await client.put(`${cfg.basePath}/${id}`, body);
          output(res.data, global);
        }
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- delete ---
  cmd
    .command('delete <id>')
    .description(`Delete a ${cfg.singular}`)
    .action(async (id) => {
      try {
        const global = getGlobalOpts(cmd);
        const client = createServiceClient(service, global);
        const res = await client.delete(`${cfg.basePath}/${id}`);
        output(res.data ?? { success: true, deleted: id }, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- delete-batch ---
  if (cfg.batchDeletePath) {
    cmd
      .command('delete-batch')
      .description(`Batch delete ${cfg.singular}s`)
      .requiredOption('--ids <ids>', 'Comma-separated IDs')
      .action(async (opts) => {
        try {
          const global = getGlobalOpts(cmd);
          const client = createServiceClient(service, global);
          const ids = opts.ids.split(',').map((s: string) => s.trim());
          const res = await client.post(`${cfg.basePath}/${cfg.batchDeletePath}`, ids);
          output(res.data ?? { success: true, deleted: ids.length }, global);
        } catch (err) {
          outputError(handleApiError(err));
        }
      });
  }

  // --- filter ---
  cmd
    .command('filter')
    .description(`Advanced filter for ${cfg.singular}s. Pass filter query as JSON.`)
    .requiredOption('--query <json>', 'Filter query JSON (or - for stdin)')
    .option('--limit <n>', 'Max results', '20')
    .option('--offset <n>', 'Skip results', '0')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(cmd);
        const client = createServiceClient(service, global);
        const query = parseData(opts.query);
        const filterUrl = cfg.filterPath || `${cfg.basePath}/filter`;
        const res = await client.post(filterUrl, {
          ...query,
          limit: parseInt(opts.limit),
          offset: parseInt(opts.offset),
        });
        const data = Array.isArray(res.data) ? res.data : res.data?.data || res.data;
        const total = res.data?.total ?? (Array.isArray(data) ? data.length : 0);
        outputPaginated(data, total, parseInt(opts.limit), parseInt(opts.offset), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  return cmd;
}
