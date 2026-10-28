import { Command } from 'commander';
import { handleApiError, assertFound, assertStudyObjectId } from '../../client.js';
import { invoke } from '../../api/core.js';
import { STUDIES } from '../../api/ops/studies.js';
import { output, outputError, outputPaginated, type OutputOptions } from '../../output.js';
import { registerStudyBuilderCommands } from './builder.js';

function getGlobalOpts(cmd: Command): OutputOptions & Record<string, any> {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

/** Replace PowerCurve objects with lightweight summaries to save tokens */
function compactCurves(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(compactCurves);

  const record = obj as Record<string, unknown>;

  // Detect PowerCurve: has 'days' array with objects containing 'valuesList'
  if (Array.isArray(record.days) && record.days.length > 0 && record.identifier !== undefined) {
    return { _type: 'PowerCurve', days: record.days.length, identifier: record.identifier };
  }

  // Detect inline DayCurve arrays (consumption, production fields that are PowerCurve-like)
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(record)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const v = val as Record<string, unknown>;
      if (Array.isArray(v.days) && v.days.length > 0 && v.identifier !== undefined) {
        result[key] = { _type: 'PowerCurve', days: v.days.length, identifier: v.identifier };
        continue;
      }
    }
    result[key] = compactCurves(val);
  }
  return result;
}

/** Expand sections: pick which parts of study to include */
const EXPAND_SECTIONS: Record<string, string[]> = {
  surfaces: ['surfaces'],
  results: ['results'],
  economics: ['economicResults'],
  batteries: ['activeBatteries', 'batteriesConfiguration', 'batteriesEnergyBalance', 'batteriesResults', 'bateries'],
  consumption: ['consumption', 'consumptionIntroductionMode', 'monthConsumptionDictionary', 'monthPeriodConsumptionDictionary', 'periodConsumptionDictionary'],
  equipment: ['solarPanel', 'solarKit', 'solarInverters', 'selectedChargers', 'selectedCustomAssets'],
  client: ['clientDetails', 'clientsDetails'],
  location: ['location', 'mapCenter', 'geographicalZone', 'atrTariff'],
};

/**
 * Fields that users often ask for on the study but actually live on the
 * metadata entity (MySQL) — surfaced via `studies list` or `studies metadata`.
 */
const METADATA_ONLY_FIELDS: Record<string, string> = {
  peakPower: 'metadata',
  sellingPrice: 'metadata',
  totalCost: 'metadata',
  anualProduction: 'metadata',
  anualConsumption: 'metadata',
  currentState: 'metadata',
  clientName: 'metadata',
  idSolarStudyMetadata: 'metadata',
  solarStudyId: 'metadata',
};

/**
 * Fields that don't exist on either the study document or its metadata —
 * they are computed client-side (builder) or simply don't exist in this API.
 */
const COMPUTED_OR_UNKNOWN_FIELDS: Record<string, string> = {
  completionPercentage: 'computed by `studies validate` / `studies save` from stepsProgress',
  isCompleted: 'not a persisted field; derive from solarStudyProgress or completionPercentage',
  stepsProgress: 'computed by `studies validate` / `studies save`',
};

function explainMissingStudyFields(missing: string[], studyId: string): void {
  const metadataFields = missing.filter(f => f in METADATA_ONLY_FIELDS);
  const computedFields = missing.filter(f => f in COMPUTED_OR_UNKNOWN_FIELDS);
  const unknownFields = missing.filter(f => !(f in METADATA_ONLY_FIELDS) && !(f in COMPUTED_OR_UNKNOWN_FIELDS));

  const lines: string[] = [];
  lines.push(`warning: ${missing.length} requested field(s) are not present on the study document returned by findById.`);

  if (metadataFields.length > 0) {
    lines.push('');
    lines.push(`  These fields live on the STUDY METADATA (MySQL), not on the study document:`);
    for (const f of metadataFields) lines.push(`    - ${f}`);
    lines.push(`  Use:  suntropy studies metadata ${studyId} --by-study-id --fields ${metadataFields.join(',')}`);
    lines.push(`  Or:   suntropy studies list --client-name <name>   (list already projects these fields)`);
  }

  if (computedFields.length > 0) {
    lines.push('');
    lines.push(`  These fields are not persisted on the study:`);
    for (const f of computedFields) lines.push(`    - ${f}: ${COMPUTED_OR_UNKNOWN_FIELDS[f]}`);
    lines.push(`  Use:  suntropy studies validate ${studyId}   (returns stepsProgress + completionPercentage)`);
  }

  if (unknownFields.length > 0) {
    lines.push('');
    lines.push(`  These fields were not found on the study document:`);
    for (const f of unknownFields) lines.push(`    - ${f}`);
    lines.push(`  If you expected them, try:  suntropy studies get ${studyId} --expand all --format json`);
    lines.push(`  and inspect the full payload to locate the correct field path.`);
  }

  process.stderr.write(lines.join('\n') + '\n');
}

/** Core identity fields always included in get */
const CORE_FIELDS = [
  '_id', 'id', 'name', 'identifier', 'clientUID',
  'creationTimestamp', 'lastEditTimestamp',
  'assignedUserUID', 'creationUserUID',
  'selectedSolarStudyMode', 'solarStudyProgress',
  'market', 'layout',
  'peakPowerIntroductionMode', 'instalationPhaseNumber',
];

function filterStudy(study: Record<string, unknown>, expand?: string): Record<string, unknown> {
  if (expand === 'all') return study;

  const sections = expand ? expand.split(',').map(s => s.trim()) : [];
  const allowedFields = new Set(CORE_FIELDS);

  for (const section of sections) {
    const fields = EXPAND_SECTIONS[section];
    if (fields) fields.forEach(f => allowedFields.add(f));
  }

  // If no expand, include summary numeric fields
  if (sections.length === 0) {
    ['peakPowerIntroductionMode', 'instalationPhaseNumber', 'location', 'atrTariff'].forEach(f => allowedFields.add(f));
  }

  const result: Record<string, unknown> = {};
  for (const key of allowedFields) {
    if (key in study) result[key] = study[key];
  }

  return compactCurves(result) as Record<string, unknown>;
}

export function registerStudiesCommands(program: Command): void {
  const studies = program.command('studies').description(
    'Explore and manage solar studies. Progressive exploration: list → metadata → get → get --expand → curves'
  );

  // --- list ---
  studies
    .command('list')
    .description('List solar studies metadata. Fields: idSolarStudyMetadata, solarStudyId, clientName, peakPower, currentState, creationTimestamp')
    .option('--limit <n>', 'Max results', '20')
    .option('--offset <n>', 'Skip results', '0')
    .option('--state <state>', 'Filter by state name')
    .option('--client-name <name>', 'Filter by client name')
    .option('--from <date>', 'Filter from date (YYYY-MM-DD)')
    .option('--to <date>', 'Filter to date (YYYY-MM-DD)')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(studies);
        const limit = parseInt(opts.limit);
        const offset = parseInt(opts.offset);
        const page = await invoke(STUDIES.list, global, {
          limit,
          offset,
          state: opts.state,
          clientName: opts.clientName,
          from: opts.from,
          to: opts.to,
        });

        const outOpts: OutputOptions = { ...global };
        if (!global.fields) {
          outOpts.fields = 'idSolarStudyMetadata,solarStudyId,clientName,peakPower,anualProduction,anualConsumption,totalCost,sellingPrice,currentState,creationTimestamp';
        }
        outputPaginated(page.items, page.total, limit, offset, outOpts);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- metadata ---
  studies
    .command('metadata <id>')
    .description('Get solar study metadata by metadata ID (relational). Full MySQL record with state, costs, versions.')
    .option('--by-study-id', 'Interpret <id> as MongoDB solarStudyId instead of metadata ID')
    .action(async (id, opts) => {
      try {
        // --by-study-id resolves against the MongoDB solarStudyId, so guard it
        // the same way as `get`; the default path uses a numeric metadata id.
        if (opts.byStudyId) assertStudyObjectId(id);
        const global = getGlobalOpts(studies);
        output(await invoke(opts.byStudyId ? STUDIES.metadataByStudyId : STUDIES.metadata, global, { id }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- get ---
  studies
    .command('get <studyId>')
    .description(
      'Get solar study by MongoDB ID. By default returns summary (no heavy curves).\n' +
      'Expand sections: surfaces, results, economics, batteries, consumption, equipment, client, location\n' +
      'Examples:\n' +
      '  suntropy studies get abc123\n' +
      '  suntropy studies get abc123 --expand surfaces,results\n' +
      '  suntropy studies get abc123 --expand all\n' +
      '  suntropy studies get abc123 --fields name,market  (bypasses expand filter)'
    )
    .option('--expand <sections>', 'Comma-separated sections to expand (or "all")')
    .action(async (studyId, opts) => {
      try {
        assertStudyObjectId(studyId);
        const global = getGlobalOpts(studies);
        const study = assertFound(await invoke(STUDIES.get, global, { id: studyId }), 'Solar study', studyId) as Record<string, unknown>;
        // If the user passes --fields, they have already expressed exactly what
        // they want — don't pre-filter the study, let output() select from the
        // full object. Otherwise apply the expand-based summary filter.
        const filtered = global.fields ? study : filterStudy(study, opts.expand);

        if (global.fields) {
          const requested = global.fields.split(',').map(f => f.trim());
          const topLevel = requested.map(f => f.split('.')[0]);
          const missing = topLevel.filter(f => !(f in study));
          if (missing.length > 0) {
            explainMissingStudyFields(missing, studyId);
          }
        }

        output(filtered, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- curves ---
  studies
    .command('curves <studyId> <curveName>')
    .description(
      'Extract and analyze a PowerCurve from a study.\n' +
      'Curve names: consumption, production, net-consumption, excesses\n' +
      'Default: --stats. Use --raw for full hourly data (8760 values).\n' +
      'Use --monthly for monthly aggregates, --daily for daily totals.'
    )
    .option('--stats', 'Show statistics (default if no other flag)')
    .option('--monthly', 'Monthly accumulated values')
    .option('--daily', 'Daily accumulated values')
    .option('--raw', 'Full hourly DayCurve[] data')
    .option('--total', 'Just the total accumulated value')
    .option('--surface-index <n>', 'Surface index for production curve', '0')
    .option('--save <file>', 'Save curve data to file')
    .action(async (studyId, curveName, opts) => {
      try {
        assertStudyObjectId(studyId);
        const global = getGlobalOpts(studies);
        const study = assertFound(await invoke(STUDIES.get, global, { id: studyId }), 'Solar study', studyId) as Record<string, unknown>;

        // Extract the requested curve
        let curveData: unknown;
        switch (curveName) {
          case 'consumption':
            curveData = study.consumption;
            break;
          case 'production': {
            const surfaces = study.surfaces as any[];
            const idx = parseInt(opts.surfaceIndex);
            if (surfaces && surfaces[idx]?.production) {
              curveData = surfaces[idx].production;
            } else {
              outputError(new Error(`No production curve at surface index ${idx}. Study has ${surfaces?.length || 0} surfaces.`));
              return;
            }
            break;
          }
          case 'net-consumption':
            curveData = (study.results as any)?.netConsumption;
            break;
          case 'excesses':
            curveData = (study.results as any)?.excessesCurve;
            break;
          default:
            outputError(new Error(`Unknown curve: ${curveName}. Available: consumption, production, net-consumption, excesses`));
            return;
        }

        if (!curveData) {
          outputError(new Error(`Curve "${curveName}" not found or empty in this study.`));
          return;
        }

        // Import PowerCurve from energy-types
        const { PowerCurve } = await import('energy-types/lib/energy/classes/powerCurve.class.js');
        const cd = curveData as any;
        const pc = new PowerCurve(cd.days || cd, cd.ignore0 ?? false, cd.identifier || curveName, cd.parseDate ?? false);

        // Determine output mode
        const showRaw = opts.raw;
        const showMonthly = opts.monthly;
        const showDaily = opts.daily;
        const showTotal = opts.total;
        const showStats = opts.stats || (!showRaw && !showMonthly && !showDaily && !showTotal);

        let result: unknown;

        if (showRaw) {
          result = pc.days;
        } else if (showTotal) {
          result = { total: pc.getTotalAcumulate(), identifier: curveName, days: pc.days.length };
        } else if (showStats) {
          const raw = pc.calculateStatistics();
          result = raw.statistics || raw;
        } else if (showMonthly) {
          const raw = pc.calculateStatistics();
          const s = raw.statistics || raw;
          result = { anualMonthAccumulate: s.anualMonthAccumulate, anualMonthCount: s.anualMonthCount, anualMonthlyAverage: s.anualMonthlyAverage };
        } else if (showDaily) {
          const raw = pc.calculateStatistics();
          const s = raw.statistics || raw;
          result = { dailyAccumulate: s.dailyAccumulate };
        }

        const outOpts = { ...global, save: opts.save || global.save };
        output(result, outOpts);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- calculate-production ---
  studies
    .command('calculate-production')
    .description('Calculate solar production curve for given coordinates and configuration')
    .requiredOption('--lat <n>', 'Latitude')
    .requiredOption('--lon <n>', 'Longitude')
    .requiredOption('--power <w>', 'Installed power in Watts')
    .option('--angle <n>', 'Panel inclination degrees', '30')
    .option('--azimuth <n>', 'Panel orientation degrees (0=north, 180=south)', '180')
    .option('--losses <n>', 'Losses percentage', '14')
    .option('--year <n>', 'Year for calculation', String(new Date().getFullYear()))
    .option('--save <file>', 'Save result to file')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(studies);
        const body = {
          lat: parseFloat(opts.lat),
          long: parseFloat(opts.lon),
          instaledPower: parseFloat(opts.power),
          angle: parseFloat(opts.angle),
          azimuth: parseFloat(opts.azimuth),
          lossesPercentage: parseFloat(opts.losses),
          year: parseInt(opts.year),
          isOptimized: false,
        };
        output(await invoke(STUDIES.calculateProduction, global, body), { ...global, save: opts.save || global.save });
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- optimize-surfaces ---
  studies
    .command('optimize-surfaces')
    .description('Calculate optimal panel angle and azimuth for coordinates')
    .requiredOption('--lat <n>', 'Latitude')
    .requiredOption('--lon <n>', 'Longitude')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(studies);
        output(await invoke(STUDIES.optimalAngles, global, { lat: parseFloat(opts.lat), lon: parseFloat(opts.lon) }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // Register study builder commands (init, validate, save, pull, set, add, remove, calculate)
  registerStudyBuilderCommands(studies);
}
