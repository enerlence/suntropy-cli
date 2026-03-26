import { Command } from 'commander';
import { readFileSync } from 'fs';
import { createServiceClient, handleApiError } from '../../client.js';
import { output, outputError, type OutputOptions } from '../../output.js';

function getGlobalOpts(cmd: Command): OutputOptions & Record<string, unknown> {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

export function registerConsumptionCommands(program: Command): void {
  const consumption = program.command('consumption').description(
    'Generate consumption curves using the profiles service.\n' +
    'Supports multiple estimation methods: standard patterns, custom profiles, monthly data.\n' +
    'Returns PowerCurve JSON compatible with `suntropy curves` for further processing.'
  );

  // --- estimate ---
  consumption
    .command('estimate')
    .description(
      'Generate a consumption PowerCurve from patterns and annual consumption.\n' +
      'Patterns: Balance, Nightly, Morning, Afternoon, Domestic, Commercial\n' +
      'Examples:\n' +
      '  suntropy consumption estimate --annual 5000 --pattern Balance\n' +
      '  suntropy consumption estimate --annual 8000 --pattern Domestic --tariff 3.0TD --market es\n' +
      '  suntropy consumption estimate --annual 3500 --monthly-data \'{"1":300,"2":280,...}\'\n' +
      '  suntropy consumption estimate --annual 5000 --custom-profile-id abc123'
    )
    .requiredOption('--annual <kWh>', 'Annual consumption in kWh')
    .option('--pattern <name>', 'Consumption pattern: Balance, Nightly, Morning, Afternoon, Domestic, Commercial')
    .option('--start-date <YYYY-MM-DD>', 'Start date (default: Jan 1 current year)')
    .option('--end-date <YYYY-MM-DD>', 'End date (default: Dec 31 current year)')
    .option('--tariff <code>', 'Electricity tariff code (e.g. 3.0TD)', '3.0TD')
    .option('--type <type>', 'Profile type: Initial or Final', 'Final')
    .option('--market <code>', 'Market: es, pt, it', 'es')
    .option('--custom-profile-id <id>', 'Use a custom consumption profile by ID')
    .option('--monthly-data <json>', 'Monthly consumption JSON: {"1":val,"2":val,...,"12":val}')
    .option('--daily-curve <json>', 'Custom daily curve JSON (DayCurve format)')
    .option('--save <file>', 'Save result to file')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(consumption);
        const client = createServiceClient('profiles', global);

        const year = new Date().getFullYear();
        const startDate = opts.startDate || `${year}-01-01`;
        const endDate = opts.endDate || `${year}-12-31`;

        // Build query params
        const params: Record<string, string> = {
          startDate,
          endDate,
          tariff: opts.tariff,
          type: opts.type,
          anualConsumption: opts.annual,
          market: opts.market,
        };

        if (opts.pattern) params.consumptionType = opts.pattern;
        if (opts.customProfileId) params.customProfileId = opts.customProfileId;

        // Build optional body
        let body: Record<string, unknown> | undefined;
        if (opts.monthlyData || opts.dailyCurve) {
          body = {};
          if (opts.monthlyData) body.consumptionByMonth = JSON.parse(opts.monthlyData);
          if (opts.dailyCurve) body.dailyCurve = JSON.parse(opts.dailyCurve);
        }

        const queryString = Object.entries(params)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join('&');

        const res = await client.post(`/consumption-estimation?${queryString}`, body || {});
        output(res.data, { ...global, save: opts.save || global.save });
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- ree-profiles ---
  consumption
    .command('ree-profiles')
    .description(
      'Fetch REE (Red Eléctrica) hourly profiles for a date range and tariff.\n' +
      'Returns the raw profile data used as basis for consumption estimation.\n' +
      'Example: suntropy consumption ree-profiles --start 2024-01-01 --end 2024-12-31 --tariff 3.0TD'
    )
    .requiredOption('--start <YYYY-MM-DD>', 'Start date')
    .requiredOption('--end <YYYY-MM-DD>', 'End date')
    .option('--tariff <code>', 'Tariff code', '3.0TD')
    .option('--type <type>', 'Profile type: Initial or Final', 'Final')
    .option('--market <code>', 'Market code: es, pt, it', 'es')
    .option('--save <file>', 'Save result to file')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(consumption);
        const client = createServiceClient('profiles', global);
        const res = await client.get('/ree-profiles', {
          params: {
            startDate: opts.start,
            endDate: opts.end,
            tariff: opts.tariff,
            type: opts.type,
            market: opts.market,
          },
        });
        output(res.data, { ...global, save: opts.save || global.save });
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- custom-tags ---
  consumption
    .command('custom-tags')
    .description('List available custom consumption profile tags for the authenticated client')
    .action(async () => {
      try {
        const global = getGlobalOpts(consumption);
        const client = createServiceClient('profiles', global);
        const res = await client.get('/custom-profiles/getTags');
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- custom-profile-info ---
  consumption
    .command('custom-profile-info')
    .description('Get details of a custom consumption profile by ID')
    .requiredOption('--id <profileId>', 'Custom profile ID')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(consumption);
        const client = createServiceClient('profiles', global);
        const res = await client.get('/custom-profiles/getInfo', {
          params: { id: opts.id },
        });
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- periods ---
  consumption
    .command('periods')
    .description(
      'Fetch period distribution (hour→P1-P6 mapping) from the periods service.\n' +
      'Returns DayCurve[] where each hour\'s value is the period number (1-6).\n' +
      'Use with `suntropy curves by-period` to aggregate any curve by tariff period.\n\n' +
      'Common tariff IDs (Spain): 13=2.0TD, 14=3.0TD\n' +
      'Zone IDs (Spain): 1=Peninsula, 2=Canarias, 3=Baleares\n\n' +
      'Examples:\n' +
      '  suntropy consumption periods --tariff-id 14 --zone-id 1 --save /tmp/periods.json\n' +
      '  suntropy consumption periods --tariff-id 13 --start 2025-01-01 --end 2025-12-31'
    )
    .option('--tariff-id <n>', 'ATR tariff ID (13=2.0TD, 14=3.0TD)', '14')
    .option('--zone-id <n>', 'Geographical zone ID (1=Peninsula)', '1')
    .option('--start <YYYY-MM-DD>', 'Start date (default: Jan 1 current year)')
    .option('--end <YYYY-MM-DD>', 'End date (default: Dec 31 current year)')
    .option('--market <code>', 'Market: es, pt, it, fr', 'es')
    .option('--save <file>', 'Save result to file')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(consumption);
        const client = createServiceClient('periods', global);
        const year = new Date().getFullYear();
        const res = await client.get('/periodos', {
          params: {
            idTarifa: parseInt(opts.tariffId),
            idZona: parseInt(opts.zoneId),
            fechaInicio: opts.start || `${year}-01-01`,
            fechaFin: opts.end || `${year}-12-31`,
            market: opts.market,
          },
        });
        output(res.data, { ...global, save: opts.save || global.save });
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- from-file ---
  consumption
    .command('from-file')
    .description(
      'Generate consumption curve from an uploaded file.\n' +
      'Supported formats: Portuguese EREDES ZIP files.\n' +
      'Example: suntropy consumption from-file --eredes-zip /path/to/file.zip'
    )
    .option('--eredes-zip <path>', 'Path to Portuguese EREDES ZIP file')
    .option('--save <file>', 'Save result to file')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(consumption);
        const client = createServiceClient('profiles', global);

        if (opts.eredesZip) {
          const FormData = (await import('form-data')).default;
          const form = new FormData();
          form.append('file', readFileSync(opts.eredesZip), {
            filename: opts.eredesZip.split('/').pop(),
            contentType: 'application/zip',
          });
          const res = await client.post('/consumption-files-processor/portugal/eredes-zip', form, {
            headers: form.getHeaders(),
          });
          output(res.data, { ...global, save: opts.save || global.save });
        } else {
          outputError(new Error('Specify a file format: --eredes-zip <path>'));
        }
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
