import { Command } from 'commander';
import { registerAuthCommands } from './commands/auth.js';
import { registerConfigCommands } from './commands/config.js';
import { registerInventoryCommands } from './commands/inventory/index.js';
import { registerStudiesCommands } from './commands/studies/index.js';
import { registerCurvesCommands } from './commands/curves/index.js';
import { registerConsumptionCommands } from './commands/consumption/index.js';
import { registerSolarformCommands } from './commands/solarform/index.js';

export function createProgram(): Command {
  const program = new Command();

  program
    .name('suntropy')
    .description('Agent-first CLI for Suntropy solar platform. Optimized for programmatic data manipulation and progressive exploration.')
    .version('0.1.0')
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

  return program;
}
