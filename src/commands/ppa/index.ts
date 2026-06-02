import { Command } from 'commander';
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

export function registerPPACommands(program: Command): void {
  const ppa = program.command('ppa').description(
    'PPA (Power Purchase Agreement) analysis.\n' +
    'Read PPA templates and run PPA simulations on a solar study.'
  );

  // --- ppa templates (read-only sub-group) ---
  const templates = ppa
    .command('templates')
    .description('Read-only access to the client PPA templates.');

  templates
    .command('list')
    .description(
      'List all PPA templates for the authenticated client.\n' +
      'Example:\n' +
      '  suntropy ppa templates list --fields _id,name,mode,ppaPrice,useInSolarForm'
    )
    .action(async () => {
      try {
        const global = getGlobalOpts(ppa);
        const client = createServiceClient('solar', global);
        const res = await client.get('/solar-study/ppa-templates');
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  templates
    .command('get <id>')
    .description(
      'Get a single PPA template by its Mongo _id.\n' +
      'Example:\n' +
      '  suntropy ppa templates get 665f0a1b2c3d4e5f60718293'
    )
    .action(async (id: string) => {
      try {
        const global = getGlobalOpts(ppa);
        const client = createServiceClient('solar', global);
        const res = await client.get(`/solar-study/ppa-templates/${id}`);
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- ppa calculate ---
  ppa
    .command('calculate')
    .description(
      'Run PPA simulations on a solar study (read-only, does not persist).\n\n' +
      'Provide the study via --study <id> (downloaded from the API) or --data <json>|- (full SolarStudy).\n' +
      'With --template <ppaTemplateId> the simulation uses that single PPA template;\n' +
      'without it, the backend uses the client templates flagged useInSolarForm.\n\n' +
      'Note: the study must include consumption and economicResults (a study fetched\n' +
      'by --study already does). The response is the study with economicResults.ppaAnalysis populated.\n\n' +
      'Examples:\n' +
      '  suntropy ppa calculate --study 665f0a1b2c3d4e5f60718293\n' +
      '  suntropy ppa calculate --study 665f... --template 6700aa11bb22cc33dd44ee55\n' +
      '  cat study.json | suntropy ppa calculate --data -'
    )
    .option('--study <id>', 'Solar study Mongo id to download and analyze')
    .option('--data <json>', 'Full SolarStudy JSON body (or - for stdin)')
    .option('--template <ppaTemplateId>', 'PPA template id to apply (defaults to client useInSolarForm templates)')
    .option('--raw', 'Return full study with PowerCurve data (no compaction)')
    .option('--save-file <file>', 'Save result to local file')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(ppa);
        const client = createServiceClient('solar', global);

        let study: unknown;
        if (opts.study) {
          const res = await client.get(`/solar-study/findById/${opts.study}`);
          study = res.data;
        } else if (opts.data) {
          study = await parseData(opts.data);
        } else {
          outputError(new Error('Provide --study <id> or --data <json>|- (full SolarStudy).'));
          return;
        }

        const body: Record<string, unknown> = { data: study };
        if (opts.template) body.ppaTemplateId = opts.template;

        const res = await client.post('/solar-study/calculate-ppa-on-study', body);
        const result = opts.raw ? res.data : compactStudyOutput(res.data);
        output(result, { ...global, save: opts.saveFile || global.save });
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
