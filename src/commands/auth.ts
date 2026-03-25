import { Command } from 'commander';
import { loadConfig, saveConfig, getActiveProfile, getServiceUrl } from '../config.js';
import { createUnauthClient, createServiceClient, handleApiError } from '../client.js';
import { output, outputError, type OutputOptions } from '../output.js';

function getGlobalOpts(cmd: Command): OutputOptions & Record<string, unknown> {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('Authentication management');

  // --- set-key (preferred for agents) ---
  auth
    .command('set-key')
    .description('Set an API key (JWT) for authentication. Preferred method for agents.')
    .requiredOption('--key <jwt>', 'JWT API key')
    .option('--server <url>', 'API server URL')
    .option('--profile <name>', 'Profile name')
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const profileName = opts.profile || config.activeProfile;
        if (!config.profiles[profileName]) {
          config.profiles[profileName] = { server: 'https://api.enerlence.com' };
        }
        const profile = config.profiles[profileName];
        profile.token = opts.key;
        profile.authMethod = 'api-key';
        if (opts.server) profile.server = opts.server;

        // Decode JWT to extract clientUID
        try {
          const payload = JSON.parse(Buffer.from(opts.key.split('.')[1], 'base64').toString());
          profile.clientUID = payload.clientUID;
          profile.userUID = payload.userUID;
        } catch {
          // If JWT decode fails, just save the key
        }

        saveConfig(config);
        output({ success: true, method: 'api-key', profile: profileName, clientUID: profile.clientUID, server: profile.server }, getGlobalOpts(auth));
      } catch (err) {
        outputError(err);
      }
    });

  // --- login ---
  auth
    .command('login')
    .description('Login with email and password')
    .requiredOption('--email <email>', 'User email')
    .requiredOption('--password <password>', 'User password')
    .option('--server <url>', 'API server URL')
    .option('--profile <name>', 'Profile name')
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const profileName = opts.profile || config.activeProfile;
        if (!config.profiles[profileName]) {
          config.profiles[profileName] = { server: 'https://api.enerlence.com' };
        }
        const profile = config.profiles[profileName];
        if (opts.server) profile.server = opts.server;

        const securityUrl = getServiceUrl(profile.server, 'security');
        const client = createUnauthClient(securityUrl);
        const res = await client.post('/auth/login', { email: opts.email, password: opts.password });

        if (res.data?.token?.access_token) {
          profile.token = res.data.token.access_token;
          profile.authMethod = 'login';
          profile.email = opts.email;
          profile.clientUID = res.data.user?.clientUID;
          profile.userUID = res.data.user?.userUID;
          saveConfig(config);
          output({
            success: true,
            method: 'login',
            profile: profileName,
            user: {
              email: res.data.user?.email,
              clientUID: res.data.user?.clientUID,
              userUID: res.data.user?.userUID,
            },
          }, getGlobalOpts(auth));
        } else {
          outputError(new Error(res.data?.errors?.[0]?.message || 'Login failed'));
        }
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- status ---
  auth
    .command('status')
    .description('Show current authentication status')
    .option('--profile <name>', 'Profile name')
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const profile = getActiveProfile(config, opts.profile);
        if (!profile.token) {
          output({ authenticated: false, message: 'No token configured' }, getGlobalOpts(auth));
          return;
        }

        // Decode JWT to check expiry
        let expiresAt: string | undefined;
        let expired = false;
        try {
          const payload = JSON.parse(Buffer.from(profile.token.split('.')[1], 'base64').toString());
          if (payload.exp) {
            const expDate = new Date(payload.exp * 1000);
            expiresAt = expDate.toISOString();
            expired = expDate < new Date();
          }
        } catch {
          // ignore decode errors
        }

        output({
          authenticated: !expired,
          method: profile.authMethod || 'unknown',
          server: profile.server,
          email: profile.email,
          clientUID: profile.clientUID,
          userUID: profile.userUID,
          expiresAt,
          expired,
        }, getGlobalOpts(auth));
      } catch (err) {
        outputError(err);
      }
    });

  // --- refresh ---
  auth
    .command('refresh')
    .description('Refresh the current JWT token')
    .option('--profile <name>', 'Profile name')
    .action(async (opts) => {
      try {
        const config = loadConfig();
        const profileName = opts.profile || config.activeProfile;
        const globalOpts = program.opts();
        const client = createServiceClient('security', { ...globalOpts, profile: profileName });
        const res = await client.get('/auth/jwt/refreshToken');

        if (res.data?.access_token || res.data?.token?.access_token) {
          const newToken = res.data.access_token || res.data.token.access_token;
          config.profiles[profileName].token = newToken;
          saveConfig(config);
          output({ success: true, message: 'Token refreshed' }, getGlobalOpts(auth));
        } else {
          outputError(new Error('Refresh failed'));
        }
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
