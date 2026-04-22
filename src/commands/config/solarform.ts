import { Command } from 'commander';
import { createServiceClient, handleApiError } from '../../client.js';
import { output, outputError } from '../../output.js';
import { getGlobalOpts, buildPayload, editJson, pickKeys } from './shared.js';
import { registerAdvancedCommands } from './advanced.js';

/** Fields accepted on SolarFormConfig (solar backend). */
const SOLARFORM_KEYS = [
  'idSolarFormConfig',
  'clientUID',
  'solarFormUrl',
  'enabled',
  'notificationEmailAddress',
  'confirmationReplytoEmailAdress',
  'notificationEmailSubject',
  'enableNotificationEmail',
  'enableSendConfirmationEmailToClient',
  'confirmationEmailSubject',
  'confirmationEmailBody',
  'enableConfirmationEmailBody',
  'formTitle',
  'formSubtitle',
  'formBackgroundColor',
  'formBackgroundImageURL',
  'formFaviconUrl',
  'locationMode',
  'hideFinalProjectPrice',
  'enableRequiredPhoneNumberField',
  'enableRequiredNameField',
  'callToActionButtonText',
  'renderPDF',
  'defaultSolarStudyTemplateId',
  'redirectUrl',
  'privacyPolicy',
  'advertisingPolicy',
  'generateShareable',
  'incentiveTemplateGroup',
  'disabledSolarForm',
  'redirectOnClose',
] as const;

export function registerSolarformConfigCommands(configRoot: Command): void {
  const solarform = configRoot
    .command('solarform')
    .description(
      'SolarForm (basic) and SolarForm Advanced configuration (solar service).\n' +
      'The basic config controls the public lead-capture form (URL, notifications,\n' +
      'appearance, mandatory fields). The advanced subtree configures the modern\n' +
      'white-label widget rendered by the "advanced-solar-form" microsite.\n\n' +
      'Endpoints:\n' +
      '  GET  /solar-form/get-solar-form-config?getParameters=\n' +
      '  GET  /solar-form/solar-form-config             (public, resolved by Origin)\n' +
      '  POST /solar-form/solar-form-config?getParameters=\n' +
      '  PUT  /solar-form/solar-form-config/:id'
    );

  solarform
    .command('get')
    .description('Fetch the current SolarForm configuration for the authenticated client.')
    .option('--with-parameters', 'Include the associated SolarFormParameters in the response')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(solarform);
        const client = createServiceClient('solar', global);
        const params: Record<string, string> = {};
        if (opts.withParameters) params.getParameters = 'true';
        const res = await client.get('/solar-form/get-solar-form-config', { params });
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  solarform
    .command('create')
    .description(
      'Create a new SolarFormConfig for the authenticated client.\n' +
      '--url is the public slug/URL of the form. Other fields may come from flags,\n' +
      '--set key=value, or --from-file. Accepted keys:\n' +
      '  ' + SOLARFORM_KEYS.join(', ')
    )
    .requiredOption('--url <slug>', 'Public URL/slug of the form (solarFormUrl)')
    .option('--enabled [bool]', 'Whether the form is publicly enabled', 'true')
    .option('--form-title <text>', 'Form title displayed to the end user')
    .option('--form-subtitle <text>', 'Form subtitle')
    .option('--form-background-color <color>', 'Background colour of the form container')
    .option('--form-background-image-url <url>', 'Background image URL')
    .option('--form-favicon-url <url>', 'Favicon URL')
    .option('--call-to-action-button-text <text>', 'Primary CTA button label')
    .option('--notification-email-address <email>', 'Where new lead notifications go')
    .option('--location-mode <mode>', 'fullSurface | locationOnly')
    .option('--with-parameters', 'Include SolarFormParameters in the response')
    .option('--set <entries...>', 'Additional field assignments as key=value (repeatable)')
    .option('--from-file <path>', 'Load a payload from a JSON file')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(solarform);
        const client = createServiceClient('solar', global);

        const flagValues: Record<string, unknown> = {
          solarFormUrl: opts.url,
          enabled: opts.enabled === undefined ? undefined : opts.enabled === true || opts.enabled === 'true',
          formTitle: opts.formTitle,
          formSubtitle: opts.formSubtitle,
          formBackgroundColor: opts.formBackgroundColor,
          formBackgroundImageURL: opts.formBackgroundImageUrl,
          formFaviconUrl: opts.formFaviconUrl,
          callToActionButtonText: opts.callToActionButtonText,
          notificationEmailAddress: opts.notificationEmailAddress,
          locationMode: opts.locationMode,
        };
        const payload = buildPayload(flagValues, opts.set, opts.fromFile, SOLARFORM_KEYS);

        const params: Record<string, string> = {};
        if (opts.withParameters) params.getParameters = 'true';
        const res = await client.post('/solar-form/solar-form-config', payload, { params });
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  solarform
    .command('update <idSolarFormConfig>')
    .description('Update an existing SolarFormConfig by numeric ID.')
    .option('--set <entries...>', 'Additional field assignments as key=value (repeatable)')
    .option('--from-file <path>', 'Load a payload from a JSON file')
    .option('--form-title <text>', 'Form title')
    .option('--form-subtitle <text>', 'Form subtitle')
    .option('--enabled [bool]', 'Whether the form is publicly enabled')
    .option('--disabled-solar-form [bool]', 'Explicit disable flag')
    .action(async (idSolarFormConfig, opts) => {
      try {
        const global = getGlobalOpts(solarform);
        const client = createServiceClient('solar', global);

        const flagValues: Record<string, unknown> = {
          formTitle: opts.formTitle,
          formSubtitle: opts.formSubtitle,
          enabled: opts.enabled === undefined ? undefined : opts.enabled === true || opts.enabled === 'true',
          disabledSolarForm: opts.disabledSolarForm === undefined ? undefined : opts.disabledSolarForm === true || opts.disabledSolarForm === 'true',
        };
        const payload = buildPayload(flagValues, opts.set, opts.fromFile, SOLARFORM_KEYS);
        if (Object.keys(payload).length === 0) {
          outputError(new Error('No fields to update.'));
          return;
        }

        const res = await client.put(`/solar-form/solar-form-config/${idSolarFormConfig}`, payload);
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  solarform
    .command('edit')
    .description('Fetch the current SolarForm config, open $EDITOR, and PUT the edited result.')
    .action(async () => {
      try {
        const global = getGlobalOpts(solarform);
        const client = createServiceClient('solar', global);
        const current = await client.get('/solar-form/get-solar-form-config');
        const doc = current.data as Record<string, unknown>;
        const id = doc?.idSolarFormConfig;
        if (!id) {
          outputError(new Error('No existing SolarFormConfig found to edit. Use "create" first.'));
          return;
        }
        const subset = pickKeys(doc, SOLARFORM_KEYS);
        const edited = editJson(subset, 'solarform');
        const res = await client.put(`/solar-form/solar-form-config/${id}`, edited);
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  registerAdvancedCommands(solarform);
}
