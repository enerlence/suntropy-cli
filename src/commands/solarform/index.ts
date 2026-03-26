import { Command } from 'commander';
import { readFileSync } from 'fs';
import { createServiceClient, handleApiError } from '../../client.js';
import { output, outputError, type OutputOptions } from '../../output.js';

function getGlobalOpts(cmd: Command): OutputOptions & Record<string, unknown> {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

/** Read all stdin as a promise */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

/** Read JSON data from --data flag or stdin */
async function parseData(data: string | undefined): Promise<Record<string, unknown> | undefined> {
  if (!data) return undefined;
  if (data === '-') {
    const input = await readStdin();
    return JSON.parse(input);
  }
  return JSON.parse(data);
}

/** Unwrap PublicApiResponse: { code, data, error } → data or throw */
function unwrapPublicApiResponse(resData: unknown): unknown {
  if (resData && typeof resData === 'object' && !Array.isArray(resData)) {
    const r = resData as Record<string, unknown>;
    // Detect PublicApiResponse shape: has 'code' field (number)
    if ('code' in r && typeof r.code === 'number') {
      // Prefer data if present (API may return both error and data)
      if (r.data !== undefined) return r.data;
      // No data — check for error
      if (r.error) {
        const err = r.error as Record<string, unknown>;
        throw new Error(`API error (${err.code || r.code}): ${err.message || JSON.stringify(err)}`);
      }
      // code present but no data and no error — return as-is
      return resData;
    }
  }
  return resData;
}

/** Compact study output: replace heavy PowerCurve objects with summaries */
function compactStudyOutput(study: unknown): unknown {
  if (study === null || study === undefined || typeof study !== 'object') return study;
  if (Array.isArray(study)) return study.map(compactStudyOutput);

  const record = study as Record<string, unknown>;

  // Detect PowerCurve: has 'days' array with objects and identifier
  if (Array.isArray(record.days) && record.days.length > 0 && record.identifier !== undefined) {
    return { _type: 'PowerCurve', days: record.days.length, identifier: record.identifier };
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(record)) {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      const v = val as Record<string, unknown>;
      if (Array.isArray(v.days) && v.days.length > 0 && v.identifier !== undefined) {
        result[key] = { _type: 'PowerCurve', days: v.days.length, identifier: v.identifier };
        continue;
      }
    }
    result[key] = compactStudyOutput(val);
  }
  return result;
}

export function registerSolarformCommands(program: Command): void {
  const solarform = program.command('solarform').description(
    'Create solar studies via the Solar Form API.\n' +
    'Two modes: "simple" (minimal params, auto-optimized) and "calculate" (full control).\n' +
    'Use --save flag to persist the study to the database.'
  );

  // --- simple ---
  solarform
    .command('simple')
    .description(
      'Create a solar study with minimal parameters (simplified mode).\n' +
      'Automatically resolves location from region/subregion, applies consumption patterns,\n' +
      'and optimizes kit selection.\n\n' +
      'Consumption patterns: Balance, Nightly, Morning, Afternoon, Domestic, Commercial\n' +
      'Consumption mode: monthlyConsumption (kWh) or monthlySpending (EUR)\n' +
      'Excesses modes: PPA, gridSelling, noInjection, virtualBattery\n\n' +
      'Examples:\n' +
      '  suntropy solarform simple --region "Andalucía" --sub-region "Sevilla" --consumption 5000\n' +
      '  suntropy solarform simple --region "Cataluña" --sub-region "Barcelona" --consumption 300 --consumption-mode monthlySpending --save\n' +
      '  suntropy solarform simple --region "Madrid" --sub-region "Madrid" --consumption 8000 --pattern Domestic --kit-id abc123 --save'
    )
    .requiredOption('--region <name>', 'Region name (must exist in database)')
    .requiredOption('--sub-region <name>', 'Sub-region name')
    .requiredOption('--consumption <value>', 'Consumption value (kWh or EUR depending on --consumption-mode)')
    .option('--pattern <name>', 'Consumption pattern: Balance, Nightly, Morning, Afternoon, Domestic, Commercial', 'Balance')
    .option('--consumption-mode <mode>', 'monthlyConsumption (kWh) or monthlySpending (EUR)', 'monthlyConsumption')
    .option('--kit-id <id>', 'Use a specific solar kit instead of auto-optimization')
    .option('--excesses-mode <mode>', 'Excesses compensation: PPA, gridSelling, noInjection, virtualBattery')
    .option('--assigned-user <uid>', 'Assign study to a user UID')
    .option('--email <email>', 'Send results to this email')
    .option('--save', 'Save study to database')
    .option('--raw', 'Return full study with PowerCurve data (no compaction)')
    .option('--save-file <file>', 'Save result to local file')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(solarform);
        const client = createServiceClient('solar', global);

        const body: Record<string, unknown> = {
          region: opts.region,
          subRegion: opts.subRegion,
          selectedConsumptionPattern: opts.pattern,
          consumptionQuantity: parseFloat(opts.consumption),
          consumptionQuantityIntroductionMode: opts.consumptionMode,
        };

        if (opts.assignedUser) body.assignedUserUID = opts.assignedUser;

        // Build query params
        const params: Record<string, string> = {};
        if (opts.save) params.save = 'true';
        if (opts.email) params.email = opts.email;
        if (opts.kitId) params.solarKitId = opts.kitId;
        if (opts.excessesMode) params.excessesCompensationMode = opts.excessesMode;

        const queryString = Object.entries(params)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join('&');

        const url = `/api/solar-form/simple${queryString ? '?' + queryString : ''}`;
        const res = await client.post(url, body);

        const study = unwrapPublicApiResponse(res.data);
        const result = opts.raw ? study : compactStudyOutput(study);
        output(result, { ...global, save: opts.saveFile || global.save });
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- calculate ---
  solarform
    .command('calculate')
    .description(
      'Create a solar study with full control over all parameters.\n' +
      'Pass the complete SimplifiedSolarStudy body as JSON.\n\n' +
      'Required body fields:\n' +
      '  center: { lat, lng } — Installation coordinates\n' +
      '  surfaces: [{ path, inclination, orientation }] — Panel surfaces\n' +
      '  consumptionMode: "cups" | "consumptionPatterns"\n' +
      '  clientDetails: { name, email, phone }\n\n' +
      'Optional: atrTariff, geographicalZone, location, contractedPower,\n' +
      '  monthPeriodConsumptionDictionary, selectedConsumptionPattern,\n' +
      '  consumptionQuantity, consumptionQuantityIntroductionMode\n\n' +
      'Examples:\n' +
      '  suntropy solarform calculate --data \'{"center":{"lat":37.39,"lng":-5.99},...}\' --save\n' +
      '  cat study-input.json | suntropy solarform calculate --data - --save --email client@co.com'
    )
    .requiredOption('--data <json>', 'Full SimplifiedSolarStudy JSON body (or - for stdin)')
    .option('--save', 'Save study to database')
    .option('--email <email>', 'Send results to this email')
    .option('--raw', 'Return full study with PowerCurve data (no compaction)')
    .option('--save-file <file>', 'Save result to local file')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(solarform);
        const client = createServiceClient('solar', global);

        const body = await parseData(opts.data);
        if (!body) {
          outputError(new Error('--data is required. Pass JSON or - for stdin.'));
          return;
        }

        const params: Record<string, string> = {};
        if (opts.save) params.save = 'true';
        if (opts.email) params.email = opts.email;

        const queryString = Object.entries(params)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join('&');

        const url = `/api/solar-form${queryString ? '?' + queryString : ''}`;
        const res = await client.post(url, body);

        const study = unwrapPublicApiResponse(res.data);
        if (!study || (typeof study === 'object' && !Array.isArray(study) && !('selectedSolarStudyMode' in (study as Record<string, unknown>)))) {
          outputError(new Error('API returned no study data. The /api/solar-form endpoint requires a complete body with: center, surfaces, consumptionMode, and typically locationMode. Use "solarform simple" for minimal-parameter study creation.'));
          return;
        }
        const result = opts.raw ? study : compactStudyOutput(study);
        output(result, { ...global, save: opts.saveFile || global.save });
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- config ---
  solarform
    .command('config')
    .description(
      'Get the solar form configuration for the authenticated client.\n' +
      'Returns form settings, appearance, enabled steps, custom fields, etc.'
    )
    .action(async () => {
      try {
        const global = getGlobalOpts(solarform);
        const client = createServiceClient('solar', global);
        const res = await client.get('/solar-form/solar-form-config');
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- statistics ---
  solarform
    .command('statistics')
    .description(
      'List or create solar form submission statistics.\n' +
      'Used for tracking form analytics and conversion data.'
    )
    .option('--create', 'Create a new statistics entry')
    .option('--update', 'Update an existing statistics entry')
    .option('--data <json>', 'Statistics data as JSON')
    .option('--stats-id <id>', 'Statistics ID (for update or linking)')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(solarform);
        const client = createServiceClient('solar', global);

        if (opts.update) {
          const body = await parseData(opts.data);
          const res = await client.put('/solar-form/solar-form-statistics', body);
          output(res.data, global);
        } else if (opts.create) {
          const body = (await parseData(opts.data)) || {};
          const params: Record<string, string> = {};
          if (opts.statsId) params.statsId = opts.statsId;
          const res = await client.post('/solar-form/solar-form-statistics', body, { params });
          output(res.data, global);
        } else {
          outputError(new Error('Specify --create or --update'));
        }
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
