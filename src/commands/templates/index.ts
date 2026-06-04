import { Command } from 'commander';
import { createServiceClient, handleApiError } from '../../client.js';
import { output, outputError, type OutputOptions } from '../../output.js';

function getGlobalOpts(cmd: Command): OutputOptions & Record<string, unknown> {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

export function registerTemplatesCommands(program: Command): void {
  const templates = program.command('templates').description(
    'Read client document templates (id + name), proxied via solar from the sharing service.'
  );

  // --- list ---
  templates
    .command('list')
    .description(
      'List templates returning only _id and templateName (GET /api/templates).\n' +
      'Defaults to the solar study templates (--type solarStudy).\n\n' +
      'Types: solarStudy (default) | colectiveSolarStudy | veChargerStudy.\n' +
      'Use --type generic for the generic (untyped) templates.\n\n' +
      'Examples:\n' +
      '  suntropy templates list\n' +
      '  suntropy templates list --type colectiveSolarStudy\n' +
      '  suntropy templates list --type generic --fields _id,templateName --format csv'
    )
    .option(
      '--type <identifier>',
      'solarStudy (default) | colectiveSolarStudy | veChargerStudy | generic',
      'solarStudy',
    )
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(templates);
        const client = createServiceClient('solar', global);

        const params: Record<string, string> = {};
        // 'generic' means the untyped templates -> omit the identifier so the
        // backend forwards no filter (sharing returns templateIdentifier: null).
        if (opts.type && opts.type !== 'generic') {
          params.templateIdentifier = opts.type;
        }

        const res = await client.get('/api/templates', { params });
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
