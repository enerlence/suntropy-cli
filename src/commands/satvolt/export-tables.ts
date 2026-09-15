import { Command } from 'commander';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { output, outputError, outputPaginated } from '../../output.js';
import {
  call,
  getGlobalOpts,
  parseId,
  readJsonArg,
  satvoltClient,
  satvoltError,
} from './api.js';

interface Column {
  id: string;
  label: string;
  path: string;
  type: string;
}

/**
 * Columns can be given as full objects or as shorthand strings
 * "Label=path[:type]" (e.g. "CIF=fullData.webData.tax_id").
 */
function parseColumns(value: string): unknown[] {
  const trimmed = value.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('@') || trimmed === '-') {
    const parsed = readJsonArg(value, '--columns');
    if (!Array.isArray(parsed)) throw new Error('--columns JSON must be an array');
    return parsed;
  }
  return trimmed.split(';').map((part) => {
    const m = /^(.+?)=([^:]+)(?::(string|number|boolean|date|url))?$/.exec(part.trim());
    if (!m) throw new Error(`Invalid column "${part}". Use "Label=path[:type]" separated by ";" or a JSON array`);
    return { label: m[1].trim(), path: m[2].trim(), type: m[3] ?? 'string' };
  });
}

export function registerSatvoltExportTableCommands(satvolt: Command): void {
  const tables = satvolt
    .command('export-tables')
    .summary('Export tables: column sets over lead data, paged reads and XLSX/CSV downloads.')
    .description(
      'Export tables of a campaign: named column sets over lead data, readable page by page\n' +
        'and downloadable as XLSX or CSV. Column paths: lead.<column>, fullData.<path>,\n' +
        'synthetic.googleMapsUrl (see: satvolt leads fields <campaignId>).',
    );

  tables
    .command('list <campaignId>')
    .description('List the export tables of a campaign.')
    .action(async (campaignId) => {
      const global = getGlobalOpts(tables);
      try {
        const data = await call(satvoltClient(global), 'get', `/campaigns/${parseId(campaignId, 'campaignId')}/export-tables`);
        output(global.format === 'json' ? data : data.map((t: { columns: Column[] }) => ({ ...t, columns: t.columns.length })), global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  tables
    .command('get <tableId>')
    .description('Get an export table with its columns.')
    .action(async (tableId) => {
      const global = getGlobalOpts(tables);
      try {
        output(await call(satvoltClient(global), 'get', `/export-tables/${tableId}`), global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  tables
    .command('create <campaignId>')
    .description(
      'Create an export table. Column ids are generated when omitted; type defaults to string.\n' +
        'Examples:\n' +
        '  suntropy satvolt export-tables create 59 --name "CRM" \\\n' +
        '    --columns "Empresa=lead.commercialName;CIF=fullData.webData.tax_id;Consumo kWh=fullData.consumptionEstimate.annualKwh:number;Maps=synthetic.googleMapsUrl:url"\n' +
        '  suntropy satvolt export-tables create 59 --data @table.json   ({ name, description?, columns })',
    )
    .option('--name <name>', 'Table name')
    .option('--description <text>', 'Description')
    .option('--columns <spec>', '"Label=path[:type];..." or JSON array, @file or -')
    .option('--data <json>', 'Full body as JSON, @file or -; flags override its fields')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(tables);
      try {
        const body: Record<string, unknown> = opts.data ? readJsonArg(opts.data, '--data') : {};
        if (opts.name) body.name = opts.name;
        if (opts.description) body.description = opts.description;
        if (opts.columns) body.columns = parseColumns(opts.columns);
        if (!body.name) throw new Error('--name is required');
        if (!Array.isArray(body.columns) || body.columns.length === 0) throw new Error('--columns is required');
        const data = await call(satvoltClient(global), 'post', `/campaigns/${parseId(campaignId, 'campaignId')}/export-tables`, { data: body });
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  tables
    .command('update <tableId>')
    .description(
      'Replace a table (PUT): name and the full columns list are required. Keep column ids\n' +
        'from `export-tables get` to preserve them.\n' +
        'Example:\n' +
        '  suntropy satvolt export-tables get 6650... --save table.json  # edit, then:\n' +
        '  suntropy satvolt export-tables update 6650... --data @table.json',
    )
    .requiredOption('--data <json>', '{ name, description?, columns } as JSON, @file or -')
    .action(async (tableId, opts) => {
      const global = getGlobalOpts(tables);
      try {
        const body = readJsonArg(opts.data, '--data');
        output(await call(satvoltClient(global), 'put', `/export-tables/${tableId}`, { data: body }), global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  tables
    .command('patch <tableId>')
    .description(
      'Change only the given fields. --columns replaces the column list; use --add-columns\n' +
        'to append and --remove-columns to drop by id or label.\n' +
        'Example:\n' +
        '  suntropy satvolt export-tables patch 6650... --add-columns "Teléfono=lead.phone" --remove-columns Maps',
    )
    .option('--name <name>', 'New name')
    .option('--description <text>', 'New description')
    .option('--columns <spec>', 'Replace columns: "Label=path[:type];..." or JSON')
    .option('--add-columns <spec>', 'Append columns')
    .option('--remove-columns <idsOrLabels>', 'Comma-separated column ids or labels to drop')
    .action(async (tableId, opts) => {
      const global = getGlobalOpts(tables);
      try {
        const client = satvoltClient(global);
        const body: Record<string, unknown> = {};
        if (opts.name) body.name = opts.name;
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.columns) body.columns = parseColumns(opts.columns);
        if (opts.addColumns || opts.removeColumns) {
          if (opts.columns) throw new Error('--columns cannot be combined with --add-columns/--remove-columns');
          const current = await call(client, 'get', `/export-tables/${tableId}`);
          const drop = new Set<string>((opts.removeColumns ?? '').split(',').map((s: string) => s.trim()).filter(Boolean));
          const kept = (current.columns as Column[]).filter((c) => !drop.has(c.id) && !drop.has(c.label));
          if (drop.size && kept.length === current.columns.length) {
            throw new Error(`No column matches --remove-columns ${opts.removeColumns}`);
          }
          body.columns = [...kept, ...(opts.addColumns ? parseColumns(opts.addColumns) : [])];
        }
        if (Object.keys(body).length === 0) throw new Error('Nothing to change');
        output(await call(client, 'patch', `/export-tables/${tableId}`, { data: body }), global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  tables
    .command('delete <tableId>')
    .description('Delete an export table.')
    .action(async (tableId) => {
      const global = getGlobalOpts(tables);
      try {
        output(await call(satvoltClient(global), 'delete', `/export-tables/${tableId}`), global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  tables
    .command('duplicate <tableId>')
    .description('Copy a table (its columns) into another campaign.')
    .requiredOption('--campaign <campaignId>', 'Target campaign')
    .option('--name <name>', 'Name of the copy (default: same name)')
    .action(async (tableId, opts) => {
      const global = getGlobalOpts(tables);
      try {
        const data = await call(satvoltClient(global), 'post', `/export-tables/${tableId}/duplicate`, {
          data: { targetCampaignId: parseId(opts.campaign, '--campaign'), name: opts.name },
        });
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  tables
    .command('data <tableId>')
    .description(
      'Read table rows page by page, one object per lead keyed by column label.\n' +
        'Example:\n' +
        '  suntropy satvolt export-tables data 6650... --limit 100 --format csv',
    )
    .option('--limit <n>', 'Page size (max 500)', '50')
    .option('--offset <n>', 'Skip rows', '0')
    .option('--search <text>', 'Name, address or phone contains')
    .action(async (tableId, opts) => {
      const global = getGlobalOpts(tables);
      try {
        const page = await call(satvoltClient(global), 'get', `/export-tables/${tableId}/data`, {
          params: { limit: opts.limit, offset: opts.offset, search: opts.search },
        });
        const columns = page.columns as Column[];
        const rows = (page.items as Array<{ idLead: number; values: Record<string, unknown> }>).map((r) => {
          const row: Record<string, unknown> = { 'Lead ID': r.idLead };
          for (const c of columns) row[c.label] = r.values[c.id] ?? null;
          return row;
        });
        outputPaginated(rows, page.total, page.limit, page.offset, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  tables
    .command('export <tableId>')
    .description(
      'Download every row of the table (up to 100k) as XLSX or CSV (UTF-8 with BOM).\n' +
        'Example:\n' +
        '  suntropy satvolt export-tables export 6650... --file-format csv --out leads.csv',
    )
    .option('--file-format <format>', 'xlsx | csv', 'xlsx')
    .option('--out <path>', 'Output file (default: the name suggested by the server, in the current directory)')
    .action(async (tableId, opts) => {
      const global = getGlobalOpts(tables);
      try {
        const format = String(opts.fileFormat).toLowerCase();
        if (format !== 'xlsx' && format !== 'csv') throw new Error('--file-format must be xlsx or csv');
        const client = satvoltClient(global, 300000);
        const res = await client.get<ArrayBuffer>(`/export-tables/${tableId}/export`, {
          params: { format },
          responseType: 'arraybuffer',
        });
        const disposition = String(res.headers['content-disposition'] ?? '');
        const suggested = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `export-${tableId}.${format}`;
        const path = resolve(opts.out ?? suggested);
        const buffer = Buffer.from(res.data);
        writeFileSync(path, buffer);
        output(
          {
            saved: path,
            format,
            bytes: buffer.length,
            rows: res.headers['x-row-count'] !== undefined ? Number(res.headers['x-row-count']) : null,
          },
          global,
        );
      } catch (err) {
        outputError(satvoltError(err));
      }
    });
}
