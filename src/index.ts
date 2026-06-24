import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth.js';
import { registerConfigCommands } from './commands/config.js';
import { registerInventoryCommands } from './commands/inventory/index.js';
import { registerStudiesCommands } from './commands/studies/index.js';
import { registerCurvesCommands } from './commands/curves/index.js';
import { registerConsumptionCommands } from './commands/consumption/index.js';
import { registerSolarformCommands } from './commands/solarform/index.js';
import { registerPPACommands } from './commands/ppa/index.js';
import { registerShareableCommands } from './commands/shareables/index.js';
import { registerTemplatesCommands } from './commands/templates/index.js';
import { registerGeocodeCommands } from './commands/geocode/index.js';
import { registerCommandProfileCommand } from './commands/command-profile.js';
import { applyCommandProfile } from './access.js';

// Injected at build time by tsup (define) from package.json. In dev (tsx, no
// define) the identifier is undefined, so we fall back without throwing.
declare const __CLI_VERSION__: string;
const CLI_VERSION = typeof __CLI_VERSION__ !== 'undefined' ? __CLI_VERSION__ : '0.0.0-dev';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('suntropy')
    .description('Agent-first CLI for Suntropy solar platform. Optimized for programmatic data manipulation and progressive exploration.')
    .version(CLI_VERSION)
    .option('--format <format>', 'Output format: json (default), human, csv', 'json')
    .option('--fields <fields>', 'Comma-separated fields to include in output')
    .option('--server <url>', 'Override API server URL')
    .option('--token <jwt>', 'Override authentication token')
    .option('--profile <name>', 'Use a specific config profile')
    .option('--verbose', 'Show HTTP request/response details on stderr')
    .option('--quiet', 'Suppress non-data output')
    .option('--save <file>', 'Save output to file (also writes to stdout)');

  registerAuthCommands(program);
  registerConfigCommands(program);
  registerInventoryCommands(program);
  registerStudiesCommands(program);
  registerCurvesCommands(program);
  registerConsumptionCommands(program);
  registerSolarformCommands(program);
  registerPPACommands(program);
  registerShareableCommands(program);
  registerTemplatesCommands(program);
  registerGeocodeCommands(program);

  // Hidden admin command to manage the command access profile. Registered last
  // and always exempt from gating, so it can raise/lower the tier from any tier.
  registerCommandProfileCommand(program);

  // Gate the command tree by the active permission tier (env > config > default
  // 'delete'). Commands above the tier are pruned: absent from --help and
  // reported as "unknown command" when invoked.
  applyCommandProfile(program);

  return program;
}
