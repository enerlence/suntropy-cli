import { Command } from 'commander';
import { handleApiError } from '../../client.js';
import { invoke } from '../../api/core.js';
import { THEME } from '../../api/ops/settings.js';
import { output, outputError } from '../../output.js';
import { getGlobalOpts, buildPayload, editJson, pickKeys } from './shared.js';

/**
 * Keys accepted by POST /clients/config/updateTheme.
 * Mirrors ClientThemeConfig in backend/security.
 */
const THEME_KEYS = [
  'idClientThemeConfig',
  'primary',
  'btnPrimary',
  'btnSecondary',
  'background',
  'navbarBackgroundColor',
  'graph1', 'graph2', 'graph3', 'graph4', 'graph5', 'graph6',
  'logoUrl',
  'faviconUrl',
  'clientAppTitle',
  'carouselLinks',
  'enableCustomTheme',
] as const;

export function registerThemeCommands(configRoot: Command): void {
  const theme = configRoot
    .command('theme')
    .description(
      'Client branding & theme (security service).\n' +
      'Colours, logo, favicon and app title applied across Suntropy.\n' +
      'Endpoints: GET /clients/config/clientThemeByClientUID/:uid (public)\n' +
      '           POST /clients/config/updateTheme (requires admin role)\n\n' +
      'Fields:\n' +
      '  primary, btnPrimary, btnSecondary   Core palette (hex).\n' +
      '  background, navbarBackgroundColor   Surface colours.\n' +
      '  graph1..graph6                      Chart palette (6 slots).\n' +
      '  logoUrl, faviconUrl                 Asset URLs.\n' +
      '  clientAppTitle                      Visible app title.\n' +
      '  carouselLinks                       JSON-serialised carousel config.\n' +
      '  enableCustomTheme                   Toggles the custom theme on/off.'
    );

  theme
    .command('get')
    .description(
      'Fetch the theme of a client. Default: the account of the credential.\n' +
      'With an API v2 key, --client-uid can only be the key\'s own account (else CLIENT_UID_MISMATCH).',
    )
    .option('--client-uid <uid>', 'Client UID whose theme should be fetched (default: your account)')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(theme);
        output(await invoke(THEME.get, global, { clientUid: opts.clientUid }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  theme
    .command('set')
    .description(
      'Update the theme of the authenticated client (requires admin role).\n' +
      'Combine individual flags, repeatable --set key=value, and/or --from-file.\n' +
      'Example:\n' +
      '  suntropy config theme set --primary "#0066ff" --logo-url https://cdn/logo.svg\n' +
      '  suntropy config theme set --set graph1=#ff0000 --set graph2=#00ff00\n' +
      '  suntropy config theme set --from-file theme.json'
    )
    .option('--primary <hex>', 'Primary colour')
    .option('--btn-primary <hex>', 'Primary button colour')
    .option('--btn-secondary <hex>', 'Secondary button colour')
    .option('--background <hex>', 'Background colour')
    .option('--navbar-background-color <hex>', 'Navbar background colour')
    .option('--logo-url <url>', 'Logo URL')
    .option('--favicon-url <url>', 'Favicon URL')
    .option('--client-app-title <title>', 'Visible app title')
    .option('--enable-custom-theme [bool]', 'Toggle the custom theme (true/false)')
    .option('--set <entries...>', 'Additional field assignments as key=value (repeatable)')
    .option('--from-file <path>', 'Load a partial payload from a JSON file')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(theme);

        const flagValues: Record<string, unknown> = {
          primary: opts.primary,
          btnPrimary: opts.btnPrimary,
          btnSecondary: opts.btnSecondary,
          background: opts.background,
          navbarBackgroundColor: opts.navbarBackgroundColor,
          logoUrl: opts.logoUrl,
          faviconUrl: opts.faviconUrl,
          clientAppTitle: opts.clientAppTitle,
          enableCustomTheme: opts.enableCustomTheme === undefined ? undefined : opts.enableCustomTheme === true || opts.enableCustomTheme === 'true',
        };

        const payload = buildPayload(flagValues, opts.set, opts.fromFile, THEME_KEYS);
        if (Object.keys(payload).length === 0) {
          outputError(new Error('No fields provided. Use flags, --set, or --from-file.'));
          return;
        }

        output(await invoke(THEME.update, global, { payload }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  theme
    .command('edit')
    .description('Open $EDITOR with the theme JSON and PUT the edited result.')
    .option('--client-uid <uid>', 'Client UID to fetch the current theme from (default: your account)')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(theme);
        const current = await invoke(THEME.get, global, { clientUid: opts.clientUid });
        const subset = pickKeys(current as Record<string, unknown>, THEME_KEYS);
        const edited = editJson(subset, 'theme');
        output(await invoke(THEME.update, global, { payload: edited }), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
