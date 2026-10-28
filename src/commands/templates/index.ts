import { Command } from 'commander';
import { handleApiError } from '../../client.js';
import { invoke } from '../../api/core.js';
import { TEMPLATES } from '../../api/ops/settings.js';
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
        // 'generic' means the untyped templates -> omit the identifier so the
        // backend forwards no filter (sharing returns templateIdentifier: null).
        const templateIdentifier = opts.type && opts.type !== 'generic' ? opts.type : undefined;
        output(await invoke(TEMPLATES.list, global, { templateIdentifier }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
