import chalk from 'chalk';
import type { Command } from 'commander';
import { readJsonArg } from './api.js';

/**
 * Cadastral parcel campaigns: every lead is a cadastral parcel of the area
 * instead of a Google Maps business. Shared by `campaigns create`,
 * `campaigns estimate`, `config patch` and `templates create|patch`.
 */

export const LEAD_SOURCES = ['google_places', 'cadastral_parcels'] as const;
export const PARCEL_USES = ['residential', 'agriculture', 'industrial', 'office', 'retail', 'publicServices'] as const;
const PARCEL_CLASSES = ['urban', 'rustic'];
const WITH_WITHOUT = ['any', 'with', 'without'];

/** Help block appended to the commands that take the parcel flags. */
export const PARCELS_HELP =
  'Lead source (cadastral parcels):\n' +
  '  By default leads are Google Maps businesses. With --lead-source cadastral_parcels\n' +
  '  (or any --parcel-* / --parcels flag) every lead is a cadastral parcel of the area that\n' +
  '  passes the filters: undeclared pools, built vs declared area, vacant plots… No\n' +
  '  --search-query, and --business-groups is not used. The sweep costs 1 credit per 10\n' +
  '  parcels turned into leads; most credits go to the steps run on each parcel later.\n' +
  '  --parcels <json|@file|->           filters object; the flags below override its keys\n' +
  '  --parcel-classes urban,rustic      class of land (state cadastre only)\n' +
  '  --parcel-uses <list>               declared building use: residential, agriculture,\n' +
  '                                     industrial, office, retail, publicServices\n' +
  '  --parcel-min-area / --parcel-max-area <m2>             parcel area\n' +
  '  --parcel-building any|with|without                    declared building\n' +
  '  --parcel-min-built-area / --parcel-max-built-area <m2>  official built area\n' +
  '  --parcel-pools any|with|without                       declared pools\n' +
  '  --parcel-tile <m>                  side of each Cadastre request, 100-1000 (default 500)\n' +
  '  --no-parcel-declared               skip declared buildings and pools (faster; not\n' +
  '                                     compatible with the use, building and pool filters)\n' +
  '  Use, building and pool filters need the state Cadastre: parcels of the regional\n' +
  '  cadastres (Navarra, País Vasco), France and Italy have no such data and fail them.\n';

/** Registers the parcel flags on a command. `clearable` adds --no-parcels (patch commands). */
export function addParcelOptions(cmd: Command, opts: { clearable?: boolean } = {}): Command {
  cmd
    .option('--lead-source <source>', 'google_places (default: Maps businesses) or cadastral_parcels (one lead per parcel)')
    .option('--parcels <json>', 'Parcel filters as JSON, @file or - (implies cadastral_parcels)');
  if (opts.clearable) cmd.option('--no-parcels', 'Remove the parcel filters (keeps the lead source)');
  return cmd
    .option('--parcel-classes <list>', 'Comma-separated: urban, rustic')
    .option('--parcel-uses <list>', `Comma-separated declared uses: ${PARCEL_USES.join(', ')}`)
    .option('--parcel-min-area <m2>', 'Minimum parcel area in m²')
    .option('--parcel-max-area <m2>', 'Maximum parcel area in m²')
    .option('--parcel-building <mode>', 'any | with (declared building) | without (vacant plots)')
    .option('--parcel-min-built-area <m2>', 'Minimum official built area in m²')
    .option('--parcel-max-built-area <m2>', 'Maximum official built area in m²')
    .option('--parcel-pools <mode>', 'any | with (declared pool) | without')
    .option('--parcel-tile <m>', 'Side of each Cadastre request in m (100-1000, default 500)')
    .option('--no-parcel-declared', 'Do not fetch declared buildings and pools (faster)');
}

const list = (value: string) => value.split(',').map((s) => s.trim()).filter(Boolean);

function nonNegative(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label} must be a number >= 0`);
  return n;
}

function oneOf(value: string, allowed: readonly string[], label: string): string {
  if (!allowed.includes(value)) throw new Error(`${label} must be one of: ${allowed.join(', ')}`);
  return value;
}

/**
 * `leadSource` and `parcels` from the flags. Undefined keys mean "not passed".
 * `parcels: null` only comes from --no-parcels. Any parcel flag implies
 * `cadastral_parcels` when --lead-source is not given.
 */
export function parcelFieldsFromOpts(opts: Record<string, any>): {
  leadSource?: string;
  parcels?: Record<string, unknown> | null;
} {
  let leadSource: string | undefined;
  if (opts.leadSource !== undefined) leadSource = oneOf(String(opts.leadSource), LEAD_SOURCES, '--lead-source');

  let parcels: Record<string, unknown> | null | undefined;
  if (opts.parcels === false) parcels = null;
  else if (typeof opts.parcels === 'string') {
    const parsed = readJsonArg(opts.parcels, '--parcels');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('--parcels must be a JSON object');
    parcels = parsed;
  }

  const flags: Record<string, unknown> = {};
  if (opts.parcelClasses !== undefined) {
    flags.classes = list(opts.parcelClasses).map((c) => oneOf(c, PARCEL_CLASSES, '--parcel-classes'));
  }
  if (opts.parcelUses !== undefined) {
    flags.uses = list(opts.parcelUses).map((u) => oneOf(u, PARCEL_USES, '--parcel-uses'));
  }
  if (opts.parcelMinArea !== undefined) flags.minAreaM2 = nonNegative(opts.parcelMinArea, '--parcel-min-area');
  if (opts.parcelMaxArea !== undefined) flags.maxAreaM2 = nonNegative(opts.parcelMaxArea, '--parcel-max-area');
  if (opts.parcelBuilding !== undefined) flags.building = oneOf(opts.parcelBuilding, WITH_WITHOUT, '--parcel-building');
  if (opts.parcelMinBuiltArea !== undefined) {
    flags.minBuiltAreaM2 = nonNegative(opts.parcelMinBuiltArea, '--parcel-min-built-area');
  }
  if (opts.parcelMaxBuiltArea !== undefined) {
    flags.maxBuiltAreaM2 = nonNegative(opts.parcelMaxBuiltArea, '--parcel-max-built-area');
  }
  if (opts.parcelPools !== undefined) flags.pools = oneOf(opts.parcelPools, WITH_WITHOUT, '--parcel-pools');
  if (opts.parcelTile !== undefined) {
    const n = Number(opts.parcelTile);
    if (!Number.isInteger(n) || n < 100 || n > 1000) throw new Error('--parcel-tile must be an integer between 100 and 1000');
    flags.tileM = n;
  }
  // commander: --no-parcel-declared sets false; its default is true.
  if (opts.parcelDeclared === false) flags.declared = false;

  if (Object.keys(flags).length) {
    if (parcels === null) throw new Error('--no-parcels cannot be combined with --parcel-* filters');
    parcels = { ...(parcels ?? {}), ...flags };
  }

  if (leadSource === undefined && parcels) leadSource = 'cadastral_parcels';
  if (leadSource === 'google_places' && parcels) {
    throw new Error('Parcel filters only apply with --lead-source cadastral_parcels');
  }
  return {
    ...(leadSource !== undefined ? { leadSource } : {}),
    ...(parcels !== undefined ? { parcels } : {}),
  };
}

/**
 * Applies the parcel flags to a request body. Flags win over the body (`--data`).
 * Returns true when the body ends up in parcel mode.
 */
export function applyParcelFields(opts: Record<string, any>, body: Record<string, unknown>): boolean {
  const fields = parcelFieldsFromOpts(opts);
  if (fields.leadSource !== undefined) body.leadSource = fields.leadSource;
  if (fields.parcels !== undefined) {
    body.parcels =
      fields.parcels && body.parcels && typeof body.parcels === 'object'
        ? { ...(body.parcels as object), ...fields.parcels }
        : fields.parcels;
  }
  return body.leadSource === 'cadastral_parcels';
}

const fmt = (n: unknown) => (typeof n === 'number' ? n.toLocaleString('es-ES') : n === null || n === undefined ? '-' : String(n));

function filtersText(filters: Record<string, any> | undefined): string {
  if (!filters || !Object.keys(filters).length) return 'none (every parcel of the area)';
  const parts: string[] = [];
  if (filters.classes) parts.push(`class ${filters.classes.join('/')}`);
  if (filters.uses) parts.push(`use ${filters.uses.join('/')}`);
  if (filters.minAreaM2 !== undefined || filters.maxAreaM2 !== undefined) {
    parts.push(`area ${fmt(filters.minAreaM2 ?? 0)}–${filters.maxAreaM2 !== undefined ? fmt(filters.maxAreaM2) : '∞'} m²`);
  }
  if (filters.building && filters.building !== 'any') parts.push(`building ${filters.building}`);
  if (filters.minBuiltAreaM2 !== undefined || filters.maxBuiltAreaM2 !== undefined) {
    parts.push(
      `built ${fmt(filters.minBuiltAreaM2 ?? 0)}–${filters.maxBuiltAreaM2 !== undefined ? fmt(filters.maxBuiltAreaM2) : '∞'} m²`,
    );
  }
  if (filters.pools && filters.pools !== 'any') parts.push(`pools ${filters.pools}`);
  if (filters.declared === false) parts.push('no declared data');
  if (filters.tileM) parts.push(`tile ${filters.tileM} m`);
  return parts.join(' · ');
}

/**
 * Summary of a parcel estimate for `--format human`, written to stderr like
 * the other summaries; the sample goes to stdout as a table.
 */
export function parcelEstimateSummary(data: any): string {
  const p = data?.parcels ?? {};
  const s = p.sampled ?? {};
  const lines: string[] = [];
  const area = data?.area;
  if (area) {
    const shape = area.shape ?? area.storedShape;
    const where =
      area.radiusMeters
        ? `circle of ${fmt(area.radiusMeters)} m radius`
        : area.widthMeters && area.heightMeters
          ? `${shape ?? 'rectangle'} of ${fmt(area.widthMeters)} × ${fmt(area.heightMeters)} m`
          : (shape ?? 'area');
    lines.push(`Area: ${where}`);
  }
  lines.push(`Filters: ${filtersText(data?.parcelFilters)}`);
  lines.push(
    chalk.bold(
      `Parcels: ~${fmt(p.estimated)} would become leads` +
        ` (of ~${fmt(p.inAreaEstimated)} in the area)` +
        (p.exact ? ' · exact count' : ' · extrapolated'),
    ),
  );
  lines.push(
    `Counted ${fmt(p.tilesSampled)} of ${fmt(p.tilesTotal)} tiles of ${fmt(p.tileM)} m: ` +
      `${fmt(s.inArea)} parcels in the area, ${fmt(s.matching)} pass the filters`,
  );
  const rejected = Object.entries(s.rejected ?? {}).filter(([, v]) => v);
  if (rejected.length) lines.push(`Rejected in the sample: ${rejected.map(([k, v]) => `${k} ${fmt(v)}`).join(' · ')}`);
  lines.push(
    chalk.bold(`Sweep (FIND_LEADS): ~${fmt(data?.estimatedSweepCredits)} credits`) +
      chalk.dim(' (1 per 10 parcels; the steps run on each parcel are extra)'),
  );
  for (const w of data?.warnings ?? []) lines.push(chalk.yellow(`! ${w}`));
  const sample = data?.sample ?? [];
  lines.push(
    sample.length
      ? chalk.dim(`Sample: ${sample.length} parcel${sample.length === 1 ? '' : 's'} from #${data?.sampleOffset ?? 0} (--sample/--offset for more)`)
      : chalk.dim('No parcel in the sampled tiles passes the filters.'),
  );
  return `${lines.join('\n')}\n\n`;
}

/** Flat rows of the parcel sample for the human table. */
export function parcelSampleRows(data: any): Record<string, unknown>[] {
  return (data?.sample ?? []).map((p: any) => ({
    ref: p.ref,
    class: p.parcelClass,
    areaM2: p.areaM2 !== undefined && p.areaM2 !== null ? Math.round(p.areaM2) : null,
    use: p.use,
    builtAreaM2: p.builtAreaM2,
    pools: p.pools,
    source: p.source,
    location: p.location ? `${Number(p.location.lat).toFixed(5)},${Number(p.location.lng).toFixed(5)}` : null,
  }));
}
