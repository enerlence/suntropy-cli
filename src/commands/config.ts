import { Command } from 'commander';
import { loadConfig, saveConfig, setConfigValue, getConfigValue } from '../config.js';
import { output, outputError } from '../output.js';

export function registerConfigCommands(program: Command): void {
  const cfg = program.command('config').description('CLI configuration management');

  cfg
    .command('set <key> <value>')
    .description('Set a configuration value. Keys: server, token, activeProfile')
    .option('--profile <name>', 'Profile to modify')
    .action((key, value, opts) => {
      try {
        if (key === 'activeProfile') {
          const config = loadConfig();
          config.activeProfile = value;
          saveConfig(config);
        } else {
          setConfigValue(key, value, opts.profile);
        }
        output({ success: true, key, value });
      } catch (err) {
        outputError(err);
      }
    });

  cfg
    .command('get <key>')
    .description('Get a configuration value')
    .option('--profile <name>', 'Profile to read from')
    .action((key, opts) => {
      try {
        if (key === 'activeProfile') {
          const config = loadConfig();
          output({ activeProfile: config.activeProfile });
        } else {
          output({ [key]: getConfigValue(key, opts.profile) });
        }
      } catch (err) {
        outputError(err);
      }
    });

  cfg
    .command('list')
    .description('Show all configuration')
    .action(() => {
      try {
        const config = loadConfig();
        // Redact tokens for display
        const safe = JSON.parse(JSON.stringify(config));
        for (const [name, profile] of Object.entries(safe.profiles)) {
          const p = profile as Record<string, unknown>;
          if (p.token) p.token = (p.token as string).slice(0, 20) + '...';
        }
        output(safe);
      } catch (err) {
        outputError(err);
      }
    });

  cfg
    .command('create-profile <name>')
    .description('Create a new profile')
    .option('--server <url>', 'API server URL', 'https://api.enerlence.com')
    .action((name, opts) => {
      try {
        const config = loadConfig();
        if (config.profiles[name]) {
          outputError(new Error(`Profile "${name}" already exists`));
          return;
        }
        config.profiles[name] = { server: opts.server };
        saveConfig(config);
        output({ success: true, profile: name, server: opts.server });
      } catch (err) {
        outputError(err);
      }
    });

  cfg
    .command('use <name>')
    .description('Switch to a profile')
    .action((name) => {
      try {
        const config = loadConfig();
        if (!config.profiles[name]) {
          outputError(new Error(`Profile "${name}" not found. Available: ${Object.keys(config.profiles).join(', ')}`));
          return;
        }
        config.activeProfile = name;
        saveConfig(config);
        output({ success: true, activeProfile: name });
      } catch (err) {
        outputError(err);
      }
    });
}
