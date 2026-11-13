import { Command } from 'commander';
import { readFileSync } from 'fs';
import { output, outputError, type OutputOptions } from '../../output.js';
import { createServiceClient, handleApiError, type ClientOptions } from '../../client.js';
import { buildForecastBody, OUTPUTS, pickOutput } from './forecast.js';

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

/** Read curve data from file, stdin, or --input flag */
async function readCurveInput(inputPath?: string): Promise<any> {
  let raw: string;
  if (inputPath && inputPath !== '-') {
    raw = readFileSync(inputPath, 'utf-8');
  } else {
    raw = await readStdin();
  }
  return JSON.parse(raw);
}

/** Build a PowerCurve from parsed JSON data */
async function buildCurve(data: any, identifier = 'curve') {
  const { PowerCurve } = await import('energy-types/lib/energy/classes/powerCurve.class.js');
  // Data might be: { days: [...], identifier } or just a DayCurve[]
  if (Array.isArray(data)) {
    return new PowerCurve(data, false, identifier, false);
  }
  return new PowerCurve(data.days || data, data.ignore0 ?? false, data.identifier || identifier, data.parseDate ?? false);
}

/** Serialize PowerCurve back to JSON-friendly format */
function serializeCurve(pc: any): any {
  return { days: pc.days, identifier: pc.identifier, ignore0: pc.ignore0 };
}

export function registerCurvesCommands(program: Command): void {
  const curves = program.command('curves').description(
    'PowerCurve operations (pipe-friendly). Accept input via --input <file> or stdin.\n' +
    'Curve-returning commands output serialized PowerCurve JSON for chaining.\n' +
    'Use --save <file> to persist and still output to stdout.'
  );

  // --- stats ---
  curves
    .command('stats')
    .description('Calculate comprehensive statistics: monthly/daily/hourly averages, max, min, period aggregation')
    .option('--input <file>', 'Input file (or - for stdin)')
    .action(async (opts) => {
      try {
        const data = await readCurveInput(opts.input);
        const pc = await buildCurve(data, 'stats');
        const raw = pc.calculateStatistics();
        output(raw.statistics || raw, getGlobalOpts(curves));
      } catch (err) {
        outputError(err);
      }
    });

  // --- total ---
  curves
    .command('total')
    .description('Calculate total accumulated value across all hours')
    .option('--input <file>', 'Input file (or - for stdin)')
    .action(async (opts) => {
      try {
        const data = await readCurveInput(opts.input);
        const pc = await buildCurve(data, 'total');
        output({ total: pc.getTotalAcumulate(), days: pc.days.length }, getGlobalOpts(curves));
      } catch (err) {
        outputError(err);
      }
    });

  // --- multiply ---
  curves
    .command('multiply <factor>')
    .description('Multiply all hourly values by a factor. Returns a new PowerCurve.')
    .option('--input <file>', 'Input file (or - for stdin)')
    .action(async (factor, opts) => {
      try {
        const data = await readCurveInput(opts.input);
        const pc = await buildCurve(data, 'multiplied');
        const result = pc.applyMultiplier(parseFloat(factor));
        output(serializeCurve(result), getGlobalOpts(curves));
      } catch (err) {
        outputError(err);
      }
    });

  // --- aggregate ---
  curves
    .command('aggregate')
    .description('Sum two PowerCurves (A + B). Returns a new PowerCurve.')
    .requiredOption('--a <file>', 'First curve file')
    .requiredOption('--b <file>', 'Second curve file')
    .action(async (opts) => {
      try {
        const dataA = JSON.parse(readFileSync(opts.a, 'utf-8'));
        const dataB = JSON.parse(readFileSync(opts.b, 'utf-8'));
        const pcA = await buildCurve(dataA, 'a');
        const pcB = await buildCurve(dataB, 'b');
        const result = pcA.aggregatePowerCurve(pcB);
        output(serializeCurve(result), getGlobalOpts(curves));
      } catch (err) {
        outputError(err);
      }
    });

  // --- subtract ---
  curves
    .command('subtract')
    .description('Subtract two PowerCurves (A - B). Returns a new PowerCurve.')
    .requiredOption('--a <file>', 'First curve file (minuend)')
    .requiredOption('--b <file>', 'Second curve file (subtrahend)')
    .action(async (opts) => {
      try {
        const dataA = JSON.parse(readFileSync(opts.a, 'utf-8'));
        const dataB = JSON.parse(readFileSync(opts.b, 'utf-8'));
        const pcA = await buildCurve(dataA, 'a');
        const pcB = await buildCurve(dataB, 'b');
        const negB = pcB.applyMultiplier(-1);
        const result = pcA.aggregatePowerCurve(negB);
        output(serializeCurve(result), getGlobalOpts(curves));
      } catch (err) {
        outputError(err);
      }
    });

  // --- filter-positive ---
  curves
    .command('filter-positive')
    .description('Keep only non-negative hourly values (zero out negatives). Returns a new PowerCurve.')
    .option('--input <file>', 'Input file (or - for stdin)')
    .action(async (opts) => {
      try {
        const data = await readCurveInput(opts.input);
        const pc = await buildCurve(data, 'positive');
        const result = pc.filterNegativeValues(); // filterNegativeValues returns curve with negatives zeroed
        output(serializeCurve(result), getGlobalOpts(curves));
      } catch (err) {
        outputError(err);
      }
    });

  // --- filter-negative ---
  curves
    .command('filter-negative')
    .description('Keep only non-positive hourly values (zero out positives). Returns a new PowerCurve.')
    .option('--input <file>', 'Input file (or - for stdin)')
    .action(async (opts) => {
      try {
        const data = await readCurveInput(opts.input);
        const pc = await buildCurve(data, 'negative');
        const result = pc.filterPositiveValues(); // filterPositiveValues returns curve with positives zeroed
        output(serializeCurve(result), getGlobalOpts(curves));
      } catch (err) {
        outputError(err);
      }
    });

  // --- sort ---
  curves
    .command('sort')
    .description('Sort curve days by date ascending. Returns a new PowerCurve.')
    .option('--input <file>', 'Input file (or - for stdin)')
    .action(async (opts) => {
      try {
        const data = await readCurveInput(opts.input);
        const pc = await buildCurve(data, 'sorted');
        const sortedDays = pc.sortByDate();
        output({ days: sortedDays, identifier: pc.identifier, ignore0: pc.ignore0 }, getGlobalOpts(curves));
      } catch (err) {
        outputError(err);
      }
    });

  // --- filter-dates ---
  curves
    .command('filter-dates')
    .description('Filter curve to a date range. Returns a new PowerCurve.')
    .option('--input <file>', 'Input file (or - for stdin)')
    .option('--start <date>', 'Start date (YYYY-MM-DD)')
    .option('--end <date>', 'End date (YYYY-MM-DD)')
    .action(async (opts) => {
      try {
        const data = await readCurveInput(opts.input);
        const pc = await buildCurve(data, 'filtered');
        const start = opts.start ? new Date(opts.start) : undefined;
        const end = opts.end ? new Date(opts.end) : undefined;
        const filteredDays = pc.filterByDates(start, end);
        output({ days: filteredDays, identifier: pc.identifier, ignore0: pc.ignore0 }, getGlobalOpts(curves));
      } catch (err) {
        outputError(err);
      }
    });

  // --- to-serie ---
  curves
    .command('to-serie')
    .description('Convert curve to chart-ready series format (x/y arrays)')
    .option('--input <file>', 'Input file (or - for stdin)')
    .action(async (opts) => {
      try {
        const data = await readCurveInput(opts.input);
        const pc = await buildCurve(data, 'serie');
        const serie = pc.convertoToSerie();
        output(serie, getGlobalOpts(curves));
      } catch (err) {
        outputError(err);
      }
    });

  // --- forecast ---
  curves
    .command('forecast')
    .description(
      'Forecast any PowerCurve (production, consumption…) with TimesFM 3.0 (Suntropy API).\n' +
      'forecast: predicts the next days/hours after the end of the curve, with a p10-p90 band.\n' +
      'backtest: hides the last points, predicts them and compares (MAE, WAPE, band coverage, possible anomalies).\n' +
      'For production curves pass --lat/--lon: the solar irradiance (Open-Meteo, real + 16-day forecast) is used as covariate.\n' +
      'Results are kept 7 days (use --refresh to recalculate).\n\n' +
      'Examples:\n' +
      '  suntropy curves forecast --input production.json --lat 36.72 --lon -4.42 --horizon 7\n' +
      '  suntropy curves forecast --input production.json --granularity hour --horizon 48 --lat 36.72 --lon -4.42 --output median > next48h.json\n' +
      '  suntropy curves forecast --input consumption.json --granularity hour --mode backtest --horizon 72 --output metrics\n' +
      '  suntropy studies curves <studyId> consumption | suntropy curves forecast --horizon 14'
    )
    .option('--input <file>', 'Input PowerCurve file (or - for stdin)')
    .option('--mode <mode>', 'forecast | backtest (default forecast)')
    .option('--granularity <g>', 'day | hour (default day)')
    .option('--horizon <n>', 'Points to predict: days 1-120 (default 7), hours 1-720 (default 48); 16 days at most with irradiance in forecast mode')
    .option('--lat <latitude>', 'Plant latitude (uses the irradiance covariate)')
    .option('--lon <longitude>', 'Plant longitude (uses the irradiance covariate)')
    .option('--covariate <c>', 'irradiance | none (default: irradiance with --lat/--lon, none otherwise)')
    .option('--confidence <level>', 'Band width, 0.5-0.98 (default 0.8 = p10-p90)')
    .option('--refresh', 'Recalculate instead of using the stored result')
    .option('--output <what>', `What to print: ${OUTPUTS.join(' | ')} (median/lower/upper are PowerCurves, hourly only)`, 'full')
    .action(async (opts) => {
      try {
        const data = await readCurveInput(opts.input);
        const body = buildForecastBody(data, opts);
        const global = getGlobalOpts(curves);
        const client = createServiceClient('solar', global as ClientOptions);
        const res = await client.post('/api/forecast/power-curve', body, { timeout: 180000 });
        const envelope = res.data as { code?: number; data?: any; error?: { code?: string; message?: string } };
        if (envelope?.error || (envelope?.code && envelope.code >= 400)) {
          outputError({
            error: true,
            status: envelope.code,
            message: envelope.error?.message || envelope.error?.code || 'Forecast error',
            details: envelope.error,
          });
          return;
        }
        output(pickOutput(envelope.data, opts.output), global);
      } catch (err) {
        outputError((err as any)?.isAxiosError ? handleApiError(err) : err);
      }
    });

  // --- by-period ---
  curves
    .command('by-period')
    .description(
      'Aggregate a PowerCurve by tariff periods (P1-P6) using a period distribution.\n' +
      'Returns { p1, p2, p3, p4, p5, p6 } with accumulated kWh per period.\n\n' +
      'The period distribution maps each hour of each day to a tariff period.\n' +
      'Get it with: suntropy consumption periods --save /tmp/periods.json\n\n' +
      'Examples:\n' +
      '  suntropy curves by-period --input /tmp/production.json --periods /tmp/periods.json\n' +
      '  suntropy curves by-period --input /tmp/consumption.json --periods /tmp/periods.json'
    )
    .requiredOption('--periods <file>', 'Period distribution file (DayCurve[] from consumption periods)')
    .option('--input <file>', 'Input PowerCurve file (or stdin)')
    .action(async (opts) => {
      try {
        const data = await readCurveInput(opts.input);
        const pc = await buildCurve(data, 'by-period');
        const periodsData = JSON.parse(readFileSync(opts.periods, 'utf-8'));
        const result = pc.aggregateByPeriod(periodsData);
        output(result, getGlobalOpts(curves));
      } catch (err) {
        outputError(err);
      }
    });
}
