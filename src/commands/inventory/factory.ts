import { Command } from 'commander';
import { readFileSync } from 'fs';
import { handleApiError } from '../../client.js';
import { output, outputError, outputPaginated, type OutputOptions } from '../../output.js';
import { invoke, type GlobalOptions } from '../../api/core.js';
import { inventoryOps, type ResourceConfig } from '../../api/ops/inventory.js';

export type { ResourceConfig } from '../../api/ops/inventory.js';

export function getGlobalOpts(cmd: Command): OutputOptions & GlobalOptions {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as OutputOptions & GlobalOptions;
}

/** JSON from `--data` / `--query`, or from stdin with `-`. */
export function parseData(data: string | undefined): Record<string, any> | undefined {
  if (!data) return undefined;
  if (data === '-') return JSON.parse(readFileSync(0, 'utf-8'));
  return JSON.parse(data);
}

/**
 * `inventory <resource> list|get|create|update|delete|delete-batch|filter`.
 * The routes of each version live in `inventoryOps` (src/api/ops/inventory.ts):
 * a user JWT goes to the v1 service routes, a `sun_` key to `/api/v2/inventory`.
 */
export function createResourceCommands(cfg: ResourceConfig): Command {
  const cmd = new Command(cfg.name).description(`Manage ${cfg.singular}s`);
  const ops = inventoryOps(cfg);

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
        const limit = parseInt(opts.limit);
        const offset = parseInt(opts.offset);
        const page = await invoke(ops.list, global, { limit, offset, activeOnly: Boolean(opts.activeOnly) });

        // Apply list field summary unless user specified --fields
        const outOpts: OutputOptions = { ...global };
        if (!global.fields && cfg.listFields.length > 0) {
          outOpts.fields = [cfg.idField, ...cfg.listFields].join(',');
        }
        outputPaginated(page.items, page.total, limit, offset, outOpts);
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
        output(await invoke(ops.get, global, { id }), global);
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
        output(await invoke(ops.create, global, { body: parseData(opts.data) }), global);
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
        output(await invoke(ops.update, global, { id, body: parseData(opts.data) }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- delete ---
  cmd
    .command('delete <id>')
    .description(`Delete a ${cfg.singular}. Output: {"success":true,"deleted":"<id>"}`)
    .action(async (id) => {
      try {
        const global = getGlobalOpts(cmd);
        output(await invoke(ops.delete, global, { id }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- delete-batch ---
  if (cfg.batchDeletePath) {
    cmd
      .command('delete-batch')
      .description(`Batch delete ${cfg.singular}s. Output: {"success":true,"deleted":<n>}`)
      .requiredOption('--ids <ids>', 'Comma-separated IDs')
      .action(async (opts) => {
        try {
          const global = getGlobalOpts(cmd);
          const ids = opts.ids.split(',').map((s: string) => s.trim()).filter(Boolean);
          output(await invoke(ops.deleteBatch, global, { ids }), global);
        } catch (err) {
          outputError(handleApiError(err));
        }
      });
  }

  // --- filter ---
  cmd
    .command('filter')
    .description(`Advanced filter for ${cfg.singular}s (active ones). Pass filter query as JSON.`)
    .requiredOption('--query <json>', 'Filter query JSON (or - for stdin)')
    .option('--limit <n>', 'Max results', '20')
    .option('--offset <n>', 'Skip results', '0')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(cmd);
        const limit = parseInt(opts.limit);
        const offset = parseInt(opts.offset);
        const page = await invoke(ops.filter, global, { query: parseData(opts.query) ?? {}, limit, offset });
        outputPaginated(page.items, page.total, limit, offset, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  return cmd;
}
