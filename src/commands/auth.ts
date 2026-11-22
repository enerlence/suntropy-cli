import { Command } from 'commander';
import axios from 'axios';
import {
  loadConfig,
  saveConfig,
  getActiveProfile,
  getServiceUrl,
  isV2Key,
  resolveGatewayUrl,
  type SuntropyConfig,
  type SuntropyProfile,
} from '../config.js';
import { createUnauthClient, createServiceClient, handleApiError } from '../client.js';
import { output, outputError, outputLine, type OutputOptions } from '../output.js';
import {
  canOpenBrowser,
  defaultDeviceName,
  DeviceFlowError,
  openBrowser,
  parseScopes,
  DEFAULT_WEB_SCOPES,
  pollDeviceToken,
  requestDeviceCode,
} from '../device-flow.js';

function getGlobalOpts(cmd: Command): OutputOptions & Record<string, unknown> {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

/** Profile to write to (global --profile or the active one), created if missing. */
function targetProfile(config: SuntropyConfig, global: Record<string, unknown>): { name: string; profile: SuntropyProfile } {
  const name = (global.profile as string) || config.activeProfile;
  if (!config.profiles[name]) config.profiles[name] = { server: 'https://api.enerlence.com' };
  return { name, profile: config.profiles[name] };
}

/** Forget everything about the previous credential of a profile (keeps server and gatewayUrl). */
function clearCredential(profile: SuntropyProfile): void {
  delete profile.token;
  delete profile.authMethod;
  delete profile.email;
  delete profile.clientUID;
  delete profile.userUID;
  delete profile.keyId;
  delete profile.keyLabel;
}

/** `GET <gateway>/api/v2/me` with an API v2 key. */
async function fetchV2Me(gatewayUrl: string, token: string): Promise<{ status: number; body: any }> {
  const res = await axios.get(`${gatewayUrl}/api/v2/me`, {
    timeout: 15000,
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  });
  return { status: res.status, body: res.data };
}

const WEB_LOGIN_HELP =
  'Log in. Two ways:\n' +
  '  --web                  browser login (recommended, also for agents): prints a URL and a\n' +
  '                         code, the user approves it in the Suntropy app with their own\n' +
  '                         session, and the CLI stores an API v2 key (sun_…) for the account.\n' +
  '                         Only an admin of the account can approve. Nobody types a password.\n' +
  '  --email --password     user session (JWT, 12 h), for people.\n' +
  'With --web and --format json (default) it prints one JSON line as soon as the code exists:\n' +
  '  {"verification_uri","verification_uri_complete","user_code","expires_in"}\n' +
  'and another when it ends: {"status":"approved","label","clientUID","scopes"}\n' +
  'or {"status":"denied"|"expired"|"error","message"} (exit code 1).\n' +
  'Agents: give the URL and the code to the user and wait; never ask for passwords or codes.\n' +
  'API v2 keys work with `suntropy satvolt …` (LeadGen and credits) and `auth status` for now.\n' +
  'Examples:\n' +
  '  suntropy auth login --web\n' +
  '  suntropy auth login --web --device-name "Alexandria sandbox" --format json\n' +
  '  suntropy auth login --email me@example.com --password ****';

export function registerAuthCommands(program: Command): void {
  const auth = program.command('auth').description('Authentication management');

  // --- set-key (preferred for agents) ---
  auth
    .command('set-key')
    .description(
      'Store an API key for authentication: an API v2 key (sun_…, from the API v2 panel in\n' +
        'Configuration or `auth login --web`) or a legacy API key (JWT). For agents, prefer\n' +
        '`suntropy auth login --web`: the user approves in the browser and nobody copies keys.',
    )
    .requiredOption('--key <key>', 'API v2 key (sun_…) or legacy JWT API key')
    .action(async (opts) => {
      try {
        // --server / --profile are global root options (see createProgram);
        // read them from there instead of redefining them locally, otherwise
        // Commander assigns them to the root and they never reach this action.
        const global = getGlobalOpts(auth);
        const config = loadConfig();
        const { name: profileName, profile } = targetProfile(config, global);
        if (global.server) profile.server = global.server as string;

        if (isV2Key(opts.key)) {
          // API v2 key: opaque, nothing to decode. `auth status` asks the gateway who it is.
          clearCredential(profile);
          profile.token = opts.key;
          profile.authMethod = 'api-key-v2';
          saveConfig(config);
          output({ success: true, method: 'api-key-v2', credential: 'sun_', profile: profileName, server: profile.server }, global);
          return;
        }

        clearCredential(profile);
        profile.token = opts.key;
        profile.authMethod = 'api-key';

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
    .summary('Log in: in the browser (--web, stores an API v2 key) or with email and password')
    .description(WEB_LOGIN_HELP)
    .option('--web', 'Browser login (device code); stores an API v2 key (sun_…)')
    .option('--device-name <name>', 'With --web: name shown on the approval page and in the key label (default: hostname)')
    .option('--scopes <scopes>', 'With --web: comma-separated API v2 scopes (default: the 17 scopes the CLI uses, see README)')
    .option('--no-browser', 'With --web: do not try to open the browser, just print the URL')
    .option('--email <email>', 'User email')
    .option('--password <password>', 'User password')
    .action(async (opts) => {
      if (opts.web) {
        if (opts.email || opts.password) {
          outputError(new Error('--web cannot be combined with --email/--password.'));
          return;
        }
        await webLogin(auth, opts);
        return;
      }
      if (!opts.email || !opts.password) {
        outputError(new Error('Use `suntropy auth login --web` (browser), or give both --email and --password.'));
        return;
      }
      try {
        // --server / --profile come from the global root options.
        const global = getGlobalOpts(auth);
        const config = loadConfig();
        const profileName = (global.profile as string) || config.activeProfile;
        if (!config.profiles[profileName]) {
          config.profiles[profileName] = { server: 'https://api.enerlence.com' };
        }
        const profile = config.profiles[profileName];
        if (global.server) profile.server = global.server as string;

        const securityUrl = getServiceUrl(profile.server, 'security');
        const client = createUnauthClient(securityUrl);
        const res = await client.post('/auth/login', { email: opts.email, password: opts.password });

        if (res.data?.token?.access_token) {
          clearCredential(profile);
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
    .description(
      'Show the authentication status of the active profile. `credential` tells\n' +
        'the kind: `jwt` (user session or legacy API key) or `sun_` (API v2 key).\n' +
        'For a sun_ key it asks the gateway (GET /api/v2/me) and shows its label,\n' +
        'scopes, clientUID and expiry.',
    )
    .action(async () => {
      try {
        // --profile is a global root option.
        const global = getGlobalOpts(auth);
        const config = loadConfig();
        const profile = getActiveProfile(config, global.profile as string);
        if (!profile.token) {
          output({ authenticated: false, message: 'No token configured' }, getGlobalOpts(auth));
          return;
        }

        if (isV2Key(profile.token)) {
          const gateway = resolveGatewayUrl(profile.server, profile.gatewayUrl);
          const base = { method: 'api-key-v2', credential: 'sun_', server: profile.server, gateway: gateway.url };
          let me;
          try {
            me = await fetchV2Me(gateway.url, profile.token);
          } catch (err) {
            outputError({ error: true, status: 0, code: 'GATEWAY_UNREACHABLE', message: `Could not reach the API gateway at ${gateway.url}: ${(err as Error).message}` });
            return;
          }
          if (me.status === 200 && me.body?.data) {
            const d = me.body.data;
            const expired = d.expiresAt ? new Date(d.expiresAt) < new Date() : false;
            output({
              authenticated: !expired,
              ...base,
              label: d.label,
              keyId: d.keyId,
              scopes: d.scopes,
              clientUID: d.clientUID,
              expiresAt: d.expiresAt ?? null,
              expired,
            }, global);
            return;
          }
          const code = me.body?.error?.code as string | undefined;
          if (me.status === 401 || code === 'INVALID_KEY') {
            output({
              authenticated: false,
              ...base,
              label: profile.keyLabel,
              code: code ?? 'INVALID_KEY',
              message: 'The API key is revoked or expired: run `suntropy auth login --web` again.',
            }, global);
            return;
          }
          outputError({
            error: true,
            status: me.status,
            code,
            message: me.body?.error?.message || `The API gateway answered HTTP ${me.status} to /api/v2/me`,
          });
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
          credential: 'jwt',
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
    .action(async () => {
      try {
        // --profile is a global root option.
        const globalOpts = getGlobalOpts(auth);
        const config = loadConfig();
        const profileName = (globalOpts.profile as string) || config.activeProfile;
        if (isV2Key(config.profiles[profileName]?.token)) {
          outputError(new Error(
            'API v2 keys (sun_…) are not refreshed: they stay valid until revoked or expired. ' +
              'See the expiry with `suntropy auth status`; for a new key, run `suntropy auth login --web`.',
          ));
          return;
        }
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

  // --- logout ---
  auth
    .command('logout')
    .description(
      'Clear stored credentials for the active profile (or --profile). Removes the\n' +
      'token and account identity but keeps the profile and its server URL.\n' +
      'Use --all to log out of every profile.'
    )
    .option('--all', 'Clear credentials for ALL profiles')
    .action(async (opts) => {
      try {
        // --profile is a global root option.
        const global = getGlobalOpts(auth);
        const config = loadConfig();

        // Strip credentials/identity from a profile, keep server. Returns
        // whether the profile actually had a token before clearing.
        const clearProfile = (name: string): boolean => {
          const profile = config.profiles[name];
          if (!profile) return false;
          const hadToken = !!profile.token;
          clearCredential(profile);
          return hadToken;
        };

        if (opts.all) {
          const names = Object.keys(config.profiles);
          const clearedWithToken = names.filter(clearProfile);
          saveConfig(config);
          output({
            success: true,
            message: `Logged out of ${names.length} profile(s).`,
            profiles: names,
            hadCredentials: clearedWithToken,
          }, global);
          return;
        }

        const profileName = (global.profile as string) || config.activeProfile;
        if (!config.profiles[profileName]) {
          outputError(new Error(`Profile "${profileName}" not found. Available: ${Object.keys(config.profiles).join(', ')}`));
          return;
        }
        const hadToken = clearProfile(profileName);
        saveConfig(config);
        output({
          success: true,
          profile: profileName,
          message: hadToken
            ? `Logged out of profile "${profileName}". Credentials cleared (server kept).`
            : `Profile "${profileName}" had no stored credentials.`,
        }, global);
      } catch (err) {
        outputError(err);
      }
    });
}

/**
 * `auth login --web`: device authorization grant against the API gateway. The
 * resulting API v2 key is stored in the target profile.
 */
async function webLogin(
  auth: Command,
  opts: { deviceName?: string; scopes?: string; browser?: boolean },
): Promise<void> {
  const global = getGlobalOpts(auth);
  const json = !global.format || global.format === 'json';
  const fail = (status: 'denied' | 'expired' | 'error', message: string, code?: string) => {
    if (json) outputLine({ status, message, ...(code ? { code } : {}) });
    else process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  };

  try {
    const config = loadConfig();
    const { name: profileName, profile } = targetProfile(config, global);
    if (global.server) profile.server = global.server as string;
    const gateway = resolveGatewayUrl(profile.server, profile.gatewayUrl);

    const code = await requestDeviceCode(gateway.url, {
      deviceName: (opts.deviceName ?? defaultDeviceName()).trim() || undefined,
      scopes: parseScopes(opts.scopes) ?? [...DEFAULT_WEB_SCOPES],
    });
    const url = code.verification_uri_complete || code.verification_uri;

    const instructions =
      `To log in, open ${url}\n` +
      `and check that it shows the code ${code.user_code}. Approve only if you ran this command.\n` +
      `The code expires in ${Math.round(code.expires_in / 60)} min. Waiting for approval…\n`;
    if (json) {
      outputLine({
        verification_uri: code.verification_uri,
        verification_uri_complete: code.verification_uri_complete ?? null,
        user_code: code.user_code,
        expires_in: code.expires_in,
      });
      if (process.stderr.isTTY) process.stderr.write(instructions);
    } else {
      process.stderr.write(instructions);
    }
    if (opts.browser !== false && canOpenBrowser()) openBrowser(url);

    const token = await pollDeviceToken(gateway.url, code);

    // Re-read: the config may have changed while waiting.
    const fresh = loadConfig();
    const target = targetProfile(fresh, global).profile;
    if (global.server) target.server = global.server as string;
    clearCredential(target);
    target.token = token.api_key;
    target.authMethod = 'api-key-v2';
    target.clientUID = token.client_uid;
    target.keyId = token.key_id;
    target.keyLabel = token.label;
    // A gateway forced by env applies to this key from now on.
    if (gateway.source === 'env') target.gatewayUrl = gateway.url;
    saveConfig(fresh);

    const result = { status: 'approved', label: token.label, clientUID: token.client_uid, scopes: token.scopes };
    if (json) outputLine(result);
    else output({ ...result, profile: profileName, gateway: gateway.url }, global);
  } catch (err) {
    if (err instanceof DeviceFlowError) fail(err.status, err.message, err.code);
    else fail('error', err instanceof Error ? err.message : String(err));
  }
}
