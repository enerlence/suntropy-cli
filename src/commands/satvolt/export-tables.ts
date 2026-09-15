import { Command } from 'commander';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { output, outputError, outputPaginated } from '../../output.js';
import {
  call,
  getGlobalOpts,
  parseId,
  parseIntOption,
  readJsonArg,
  satvoltClient,
  satvoltError,
} from './api.js';
import { registerFieldsCommand } from './fields.js';

interface Column {
  id: string;
  label: string;
  path: string;
  type: string;
}

/**
 * Columns can be given as full objects or as shorthand strings
 * "Label=path[:type]" (e.g. "CIF=fullData.webData.tax_id"). Without a type
 * the server uses the one the pipeline step declares for that path, or string.
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
    return { label: m[1].trim(), path: m[2].trim(), ...(m[3] ? { type: m[3] } : {}) };
  });
}

export function registerSatvoltExportTableCommands(satvolt: Command): void {
  const tables = satvolt
    .command('export-tables')
    .summary('Export tables: column sets over lead data, paged reads and XLSX/CSV downloads.')
    .description(
      'Export tables of a campaign: named column sets over lead data, readable page by page\n' +
        'and downloadable as XLSX or CSV. Column paths: lead.<column>, fullData.<path> and\n' +
        'synthetic.googleMapsUrl. `export-tables fields <campaignId>` lists them by pipeline step.',
    );

  registerFieldsCommand(tables, 'Same as `satvolt leads fields`.');

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
    .summary('Create an export table with its columns.')
    .description(
      'Create an export table. Column ids are generated when omitted. Without a type, the\n' +
        'column takes the one declared by the step that writes the path, or string.\n' +
        'Find paths with: suntropy satvolt export-tables fields <campaignId>\n' +
        'Examples:\n' +
        '  suntropy satvolt export-tables create 59 --name "CRM" \\\n' +
        '    --columns "Empresa=lead.commercialName;Web=lead.url;Consumo kWh=fullData.consumptionEstimate.annualKwh;Maps=synthetic.googleMapsUrl"\n' +
        'fullData paths depend on the steps of each campaign (an AI agent with outputKey "cif"\n' +
        'writes fullData.cif.response.<field>): take them from `export-tables fields`.\n' +
        'Synthetic paths: synthetic.googleMapsUrl (Google Maps link built from the coordinates).\n' +
        'The response is the table: { id, campaignId, name, description, columns, warnings }.\n' +
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
    .summary('Change the name, description or the whole column list.')
    .description(
      'Change the name, the description or the whole column list. To add, edit, move or\n' +
        'remove single columns use `export-tables columns`.\n' +
        'Example:\n' +
        '  suntropy satvolt export-tables patch 6650... --name "CRM v2"',
    )
    .option('--name <name>', 'New name')
    .option('--description <text>', 'New description')
    .option('--columns <spec>', 'Replace all columns: "Label=path[:type];..." or JSON')
    .action(async (tableId, opts) => {
      const global = getGlobalOpts(tables);
      try {
        const body: Record<string, unknown> = {};
        if (opts.name) body.name = opts.name;
        if (opts.description !== undefined) body.description = opts.description;
        if (opts.columns) body.columns = parseColumns(opts.columns);
        if (Object.keys(body).length === 0) throw new Error('Nothing to change');
        output(await call(satvoltClient(global), 'patch', `/export-tables/${tableId}`, { data: body }), global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  registerColumnCommands(tables);

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
        // CSV: solo las filas (el sobre paginado no se puede aplanar).
        if (global.format === 'csv') output(rows, global);
        else outputPaginated(rows, page.total, page.limit, page.offset, global);
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

const normalizeLabel = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

/** Column by id, or by label (ignoring case and accents) when no id matches. */
function resolveColumn(columns: Column[], ref: string): Column {
  const byId = columns.find((c) => c.id === ref);
  if (byId) return byId;
  const byLabel = columns.filter((c) => normalizeLabel(c.label) === normalizeLabel(ref));
  if (byLabel.length === 1) return byLabel[0];
  if (byLabel.length > 1) {
    throw new Error(`Label "${ref}" matches several columns; use one of the ids: ${byLabel.map((c) => c.id).join(', ')}`);
  }
  throw new Error(
    `No column "${ref}". Columns: ${columns.map((c) => `${c.id} (${c.label})`).join(', ') || '(none)'}`,
  );
}

/**
 * 0-based position for the API from --position, --before or --after. `moving`
 * is the column being moved: positions count the other columns.
 */
function targetPosition(
  columns: Column[],
  opts: { position?: string; before?: string; after?: string },
  moving?: Column,
): number | undefined {
  const given = [opts.position, opts.before, opts.after].filter((v) => v !== undefined).length;
  if (given > 1) throw new Error('Use only one of --position, --before or --after');
  if (opts.position !== undefined) return parseIntOption(opts.position, '--position');
  const anchorRef = opts.before ?? opts.after;
  if (anchorRef === undefined) return undefined;
  const others = columns.filter((c) => c.id !== moving?.id);
  const anchor = resolveColumn(others, anchorRef);
  const index = others.findIndex((c) => c.id === anchor.id);
  return opts.before !== undefined ? index : index + 1;
}

function registerColumnCommands(tables: Command): void {
  const columns = tables
    .command('columns')
    .summary('Add, edit, move, reorder or remove single columns of an export table.')
    .description(
      'Edit one column at a time without resending the whole list. Columns are referenced\n' +
        'by id or by label (case and accents ignored; if two share a label, use the id).\n' +
        'Positions are 0-based (0 = first column). Each change returns { table, column, warnings }.\n' +
        'Find paths with: suntropy satvolt export-tables fields <campaignId>',
    );

  const list = async (client: ReturnType<typeof satvoltClient>, tableId: string): Promise<Column[]> =>
    call(client, 'get', `/export-tables/${tableId}/columns`);

  columns
    .command('list <tableId>')
    .description('List the columns of a table in order, with their position.')
    .action(async (tableId) => {
      const global = getGlobalOpts(tables);
      try {
        const cols = await list(satvoltClient(global), tableId);
        output(cols.map((c, position) => ({ position, ...c })), global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  columns
    .command('add <tableId>')
    .summary('Add one or more columns, optionally at a position.')
    .description(
      'Add a column (at the end unless --position, --before or --after). Without --type the\n' +
        'server uses the type the pipeline step declares for the path, or string. --columns adds\n' +
        'several at once.\n' +
        'Examples:\n' +
        '  suntropy satvolt export-tables columns add 6650... --label "Consumo kWh" --path fullData.consumptionEstimate.annualKwh\n' +
        '  suntropy satvolt export-tables columns add 6650... --label CIF --path fullData.cif.response.cif --after Empresa\n' +
        '  suntropy satvolt export-tables columns add 6650... --columns "Web=lead.url:url;Teléfono=lead.phone"',
    )
    .option('--label <label>', 'Column header')
    .option('--path <path>', 'lead.<column>, fullData.<path> or synthetic.googleMapsUrl')
    .option('--type <type>', 'string | number | boolean | date | url')
    .option('--id <id>', 'Column id (letters, digits, _ or -); generated when omitted')
    .option('--columns <spec>', 'Several columns: "Label=path[:type];..." or JSON array')
    .option('--position <n>', '0-based position')
    .option('--before <column>', 'Insert before this column (id or label)')
    .option('--after <column>', 'Insert after this column (id or label)')
    .action(async (tableId, opts) => {
      const global = getGlobalOpts(tables);
      try {
        const client = satvoltClient(global);
        const specs: Array<Record<string, unknown>> = opts.columns
          ? (parseColumns(opts.columns) as Array<Record<string, unknown>>)
          : [{ label: opts.label, path: opts.path, ...(opts.type ? { type: opts.type } : {}), ...(opts.id ? { id: opts.id } : {}) }];
        if (opts.columns && (opts.label || opts.path || opts.type || opts.id)) {
          throw new Error('--columns cannot be combined with --label/--path/--type/--id');
        }
        if (specs.some((c) => !c.label || !c.path)) throw new Error('--label and --path are required (or --columns)');
        let position = targetPosition(await list(client, tableId), opts);
        let result: { table: unknown; column: unknown; warnings: unknown[] } | undefined;
        const added: unknown[] = [];
        const warnings: unknown[] = [];
        for (const spec of specs) {
          result = await call(client, 'post', `/export-tables/${tableId}/columns`, {
            data: { ...spec, ...(position !== undefined ? { position } : {}) },
          });
          added.push(result!.column);
          warnings.push(...(result!.warnings ?? []));
          if (position !== undefined) position++;
        }
        output(specs.length === 1 ? result : { table: result!.table, columns: added, warnings }, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  columns
    .command('set <tableId> <column>')
    .summary('Change the label, path, type or position of one column.')
    .description(
      'Change the label, path, type and/or position of one column (id or label). What is not\n' +
        'given stays the same; changing the path keeps the type unless --type is given.\n' +
        'Examples:\n' +
        '  suntropy satvolt export-tables columns set 6650... "Consumo kWh" --label "Consumo anual (kWh)"\n' +
        '  suntropy satvolt export-tables columns set 6650... c_1a2b3c4d --path fullData.cif.response.revenue.value --type number',
    )
    .option('--label <label>', 'New header')
    .option('--path <path>', 'New data path')
    .option('--type <type>', 'string | number | boolean | date | url')
    .option('--position <n>', 'Move to this 0-based position')
    .option('--before <column>', 'Move before this column')
    .option('--after <column>', 'Move after this column')
    .action(async (tableId, columnRef, opts) => {
      const global = getGlobalOpts(tables);
      try {
        const client = satvoltClient(global);
        const cols = await list(client, tableId);
        const column = resolveColumn(cols, columnRef);
        const position = targetPosition(cols, opts, column);
        const body: Record<string, unknown> = {};
        if (opts.label !== undefined) body.label = opts.label;
        if (opts.path !== undefined) body.path = opts.path;
        if (opts.type !== undefined) body.type = opts.type;
        if (position !== undefined) body.position = position;
        if (Object.keys(body).length === 0) throw new Error('Nothing to change: give --label, --path, --type or a position');
        output(await call(client, 'patch', `/export-tables/${tableId}/columns/${encodeURIComponent(column.id)}`, { data: body }), global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  columns
    .command('move <tableId> <column>')
    .summary('Move one column to a position, or before/after another.')
    .description(
      'Move one column to a 0-based position, or before/after another column.\n' +
        'Examples:\n' +
        '  suntropy satvolt export-tables columns move 6650... Maps --position 0\n' +
        '  suntropy satvolt export-tables columns move 6650... CIF --after Empresa',
    )
    .option('--position <n>', '0-based position')
    .option('--before <column>', 'Move before this column')
    .option('--after <column>', 'Move after this column')
    .action(async (tableId, columnRef, opts) => {
      const global = getGlobalOpts(tables);
      try {
        const client = satvoltClient(global);
        const cols = await list(client, tableId);
        const column = resolveColumn(cols, columnRef);
        const position = targetPosition(cols, opts, column);
        if (position === undefined) throw new Error('Give --position, --before or --after');
        output(
          await call(client, 'patch', `/export-tables/${tableId}/columns/${encodeURIComponent(column.id)}`, { data: { position } }),
          global,
        );
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  columns
    .command('reorder <tableId> <columns...>')
    .description(
      'Set the order of all columns at once (ids or labels, every column exactly once).\n' +
        'Example:\n' +
        '  suntropy satvolt export-tables columns reorder 6650... Empresa CIF Teléfono Maps',
    )
    .action(async (tableId, refs: string[]) => {
      const global = getGlobalOpts(tables);
      try {
        const client = satvoltClient(global);
        const cols = await list(client, tableId);
        const columnIds = refs.map((ref) => resolveColumn(cols, ref).id);
        output(await call(client, 'put', `/export-tables/${tableId}/columns/order`, { data: { columnIds } }), global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  columns
    .command('remove <tableId> <columns...>')
    .summary('Remove one or more columns (ids or labels).')
    .description(
      'Remove one or more columns (ids or labels).\n' +
        'Example:\n' +
        '  suntropy satvolt export-tables columns remove 6650... Maps c_1a2b3c4d',
    )
    .action(async (tableId, refs: string[]) => {
      const global = getGlobalOpts(tables);
      try {
        const client = satvoltClient(global);
        const cols = await list(client, tableId);
        const targets = [...new Map(refs.map((ref) => resolveColumn(cols, ref)).map((c) => [c.id, c])).values()];
        let result: { table: unknown } | undefined;
        for (const column of targets) {
          result = await call(client, 'delete', `/export-tables/${tableId}/columns/${encodeURIComponent(column.id)}`);
        }
        output({ table: result!.table, removed: targets }, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });
}
