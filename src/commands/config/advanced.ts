import { Command } from 'commander';
import { AxiosInstance } from 'axios';
import { createServiceClient, handleApiError } from '../../client.js';
import { output, outputError } from '../../output.js';
import { getGlobalOpts, buildPayload, editJson, pickKeys, coerceValue } from './shared.js';

/** camelCase → kebab-case ("logoUrl" → "logo-url"). */
function kebab(key: string): string {
  return key.replace(/[A-Z0-9]+/g, (m, i) => (i === 0 ? m.toLowerCase() : '-' + m.toLowerCase()));
}

/** One category of the advanced panel. */
interface Section {
  name: string;
  title: string;
  summary: string;
  fields: readonly string[];
  fieldDocs: Record<string, string>;
}

const GENERAL: Section = {
  name: 'general',
  title: 'General configuration (branding, language, tracking, base aesthetics).',
  summary:
    'Applies to the entire widget: navbar, favicon, global theme, analytics/pixels\n' +
    'and page-wide injected scripts. Equivalent to the "General Configuration"\n' +
    'panel in the Suntropy admin.',
  fields: [
    'logoUrl', 'faviconUrl', 'tabTitle',
    'onAddressButtonClick', 'onSendButtonClick',
    'googleConversionId', 'googleConversionLabelOnAddress', 'googleConversionLabelOnSend',
    'metaConversionId', 'customTrackingHTML',
    'defaultLanguage', 'enableLanguageMenu',
    'customColorOfElements', 'steticVariant', 'themeColor', 'navbarColor',
    'addNumberToSteps', 'showFooter',
  ],
  fieldDocs: {
    logoUrl: 'Logo displayed in the navbar (and on the cover if includeLogoInCover=true). Empty = no logo.',
    faviconUrl: 'Browser tab favicon.',
    tabTitle: 'Browser tab title (HTML <title>).',
    onAddressButtonClick: 'JavaScript evaluated (eval) when the user hits "Continue" on the address step. ⚠ XSS risk; never accept untrusted input.',
    onSendButtonClick: 'JavaScript evaluated (eval) when the final form is submitted. Same XSS risk as above.',
    googleConversionId: 'Google Ads ID; injects gtag.js in <head>.',
    googleConversionLabelOnAddress: 'Google conversion label fired after the address step.',
    googleConversionLabelOnSend: 'Google conversion label fired on submit.',
    metaConversionId: 'Meta/Facebook pixel ID; fires a "Lead" event on submit.',
    customTrackingHTML: 'Arbitrary HTML/JS injected in <head> (Hotjar, Mixpanel, GTM…).',
    defaultLanguage: 'Initial language: en|es|fr|it|pt|cat. Falls back to browser pref, then "en".',
    enableLanguageMenu: 'Shows the language picker in the navbar. false pins the user to defaultLanguage.',
    customColorOfElements: 'Accent colour for buttons / active borders.',
    steticVariant: 'Visual variant: default (rounded) | sharped (hard corners) | simple (minimalist, no shadows).',
    themeColor: 'Primary colour (navbar, buttons, focus ring). Default #575757.',
    navbarColor: 'Overrides themeColor for the navbar only.',
    addNumberToSteps: 'Prefix step names with their number ("1. Address", …).',
    showFooter: 'Pins the footer to the bottom instead of inlining it in the flow.',
  },
};

const COVER: Section = {
  name: 'cover',
  title: 'Cover / hero screen shown before the address step.',
  summary: 'Configures the first screen the user sees: title, subtitle, carousel background, colours and logo placement.',
  fields: [
    'coverTitle', 'coverSubtitle',
    'coverBackgroundImageUrl1', 'coverBackgroundImageUrl2', 'coverBackgroundImageUrl3', 'coverBackgroundImageUrl4',
    'staticCoverImages',
    'coverTextColor', 'coverFilterColor',
    'includeLogoInCover',
  ],
  fieldDocs: {
    coverTitle: 'Hero title.',
    coverSubtitle: 'Hero subtitle below the title.',
    coverBackgroundImageUrl1: 'Background image #1 (also first frame of the carousel).',
    coverBackgroundImageUrl2: 'Background image #2.',
    coverBackgroundImageUrl3: 'Background image #3.',
    coverBackgroundImageUrl4: 'Background image #4.',
    staticCoverImages: 'true = no rotation (always shows the first image). false = carousel auto-rotates.',
    coverTextColor: 'Colour applied to coverTitle and coverSubtitle.',
    coverFilterColor: 'Overlay colour on top of the image. Default rgba(75,55,30,0.7); improves text contrast.',
    includeLogoInCover: 'true repeats the navbar logo on the cover. false keeps it only in the navbar.',
  },
};

const SURFACES: Section = {
  name: 'surfaces',
  title: 'Surfaces step: the map where the user draws the roof polygon(s).',
  summary: 'Controls whether the step runs, how many surfaces are allowed, and the per-device help messages.',
  fields: ['surfaceStepEnabled', 'multipleSurfaces', 'enableMapMarker', 'messageOnDesktopDevices', 'messageOnMobileDevices'],
  fieldDocs: {
    surfaceStepEnabled: 'Enables/disables the whole step. false = the lead is sized without any polygon input.',
    multipleSurfaces: 'Allows drawing more than one roof surface per lead.',
    enableMapMarker: 'Drops a pin on the installation location over the satellite view.',
    messageOnDesktopDevices: 'Instruction text shown on desktop during the step.',
    messageOnMobileDevices: 'Instruction text shown on mobile (e.g. "Tap to draw").',
  },
};

const CONSUMER: Section = {
  name: 'consumer',
  title: 'Consumer step: residential / commercial / community picker.',
  summary: 'Each subtype has its own visibility flag, image and label. defaultConsumptionPattern feeds the calculation engine.',
  fields: [
    'consumerStepEnabled',
    'residentialConsumerTypeEnabled', 'residentialConsumerImageUrl', 'residentialConsumerTitle',
    'commercialConsumerTypeEnabled', 'commercialConsumerImageUrl', 'commercialConsumerTitle',
    'communityConsumerTypeEnabled', 'communityConsumerImageUrl', 'communityConsumerTitle',
    'defaultConsumptionPattern',
  ],
  fieldDocs: {
    consumerStepEnabled: 'Shows/hides the whole step.',
    residentialConsumerTypeEnabled: 'Makes the "Residential" option visible.',
    residentialConsumerImageUrl: 'Icon/photo for the Residential option.',
    residentialConsumerTitle: 'Residential label (e.g. "Home").',
    commercialConsumerTypeEnabled: 'Makes the "Commercial" option visible.',
    commercialConsumerImageUrl: 'Icon/photo for the Commercial option.',
    commercialConsumerTitle: 'Commercial label (e.g. "Business").',
    communityConsumerTypeEnabled: 'Makes the "Community" option visible.',
    communityConsumerImageUrl: 'Icon/photo for the Community option.',
    communityConsumerTitle: 'Community label.',
    defaultConsumptionPattern: 'Preselected pattern: Balance | Nightly | Morning | Afternoon | Domestic | Commercial | Community. Feeds the hourly curve used by the engine.',
  },
};

const INCLINATION: Section = {
  name: 'inclination',
  title: 'Roof inclination step (flat / inclined / very inclined).',
  summary: 'Each variant carries its own image and label. defaultInclination is also used when the step is disabled.',
  fields: [
    'inclinationStepEnabled',
    'flatRoofImageUrl', 'textFlatRoof',
    'inclinedRoofImageUrl', 'textInclinedRoof',
    'veryInclinedRoofImageUrl', 'textVeryInclinedRoof',
    'defaultInclination', 'inclinationStepTitle',
  ],
  fieldDocs: {
    inclinationStepEnabled: 'Shows/hides the step. When false, defaultInclination is fed directly into the calculation.',
    flatRoofImageUrl: 'Image for the flat-roof option (0-15°).',
    textFlatRoof: 'Label for flat roof. Default "0-15°".',
    inclinedRoofImageUrl: 'Image for the inclined-roof option (15-30°).',
    textInclinedRoof: 'Label for inclined roof. Default "15-30°".',
    veryInclinedRoofImageUrl: 'Image for the very-inclined option (>30°).',
    textVeryInclinedRoof: 'Label for very inclined roof. Default ">30°".',
    defaultInclination: 'Degrees (0-90). Preselected value and fallback when the step is disabled.',
    inclinationStepTitle: 'Title for the step.',
  },
};

const ORIENTATION: Section = {
  name: 'orientation',
  title: 'Roof orientation (azimuth) step.',
  summary: 'Directly impacts yield estimates.',
  fields: ['orientationStepEnabled', 'defaultOrientation'],
  fieldDocs: {
    orientationStepEnabled: 'Shows/hides the step. When false, defaultOrientation is fed to the engine.',
    defaultOrientation: 'Degrees 0-360 (0=N, 90=E, 180=S, 270=W).',
  },
};

const PANELS: Section = {
  name: 'panels',
  title: 'Solar panel & kit-category selection step.',
  summary: 'Drives which panel + kit category the lead is sized with.',
  fields: ['panelStepEnabled', 'defaultSolarPanel', 'kitCategories', 'defaultKitCategoryId', 'panelSectionTitle', 'panelTitle'],
  fieldDocs: {
    panelStepEnabled: 'Shows/hides the step. When false, the backend uses defaultSolarPanel + defaultKitCategoryId unattended.',
    defaultSolarPanel: 'ID of the preselected SolarPanel (reference to the client inventory).',
    kitCategories: 'Array of kit categories offered to the lead. Each item: { id, name, description, priority }. Use --from-file for multi-item payloads.',
    defaultKitCategoryId: 'ID of the preselected kit category.',
    panelSectionTitle: 'Navbar/breadcrumb label for the panel section.',
    panelTitle: 'Step title.',
  },
};

const CONSUMPTION: Section = {
  name: 'consumption',
  title: 'Electric-consumption input step.',
  summary: 'Controls the input mode and display density of the consumption step.',
  fields: ['showOnlyOneConsumptionFieldAtATime', 'defaultConsumptionIntroductionMode'],
  fieldDocs: {
    showOnlyOneConsumptionFieldAtATime: 'true = guided mode (one field per screen). false = all fields visible at once.',
    defaultConsumptionIntroductionMode: 'monthlyConsumption (kWh/month) | monthlySpending (EUR/month). User can toggle if both are enabled.',
  },
};

const RESULTS: Section = {
  name: 'results',
  title: 'Results screen, contact form and calculation-engine hooks.',
  summary: 'Largest section: visual layout, form fields for lead capture, confirmation modal, and engine toggles (batteries, PPA, alternative endpoint).',
  fields: [
    'resultsMode', 'resultsBackgroundImageUrl', 'hideBackgroundImageInResults', 'colorOfBackgroundInResults',
    'includeLogoInResults', 'includeMapInResults', 'hideResults', 'hideROI', 'formTitle', 'formSubtitle',
    'resultsWhenSent', 'colorOfResultsPanelBackground',
    'showDniFieldOnResults', 'showPhonePrefixFieldOnResults', 'showTypeOfDocumentFieldOnResults',
    'showDniValidationFieldOnResults', 'showPhoneNumberValidationFieldOnResults',
    'showIdentifierValidationFieldOnResults', 'showSurnameValidationFieldOnResults', 'showTypeOfClientSelectorOnResults',
    'titleModalOfConfirm', 'textModalOfConfirm',
    'businessName', 'enablePeakPowerLimitation', 'includeBatteries', 'enabledPPACalculation',
    'hideCommentField', 'alternativeCalculationEndpoint', 'alternativeCalculationLoadingMessage', 'redirectToShareable',
  ],
  fieldDocs: {
    resultsMode: 'Default (ROI, payback, savings) | SolarResource (irradiance map + technical data).',
    resultsBackgroundImageUrl: 'Background image behind the results panel.',
    hideBackgroundImageInResults: 'Hides the background image even when set.',
    colorOfBackgroundInResults: 'Overlay colour on top of the background image. Default rgba(75,55,30,0.7).',
    colorOfResultsPanelBackground: 'Background of the metrics card. Default rgba(0,0,0,0.5).',
    includeLogoInResults: 'Shows the logo on the results screen.',
    includeMapInResults: 'Shows the interactive map with the drawn panels.',
    hideResults: 'true = no metrics shown, only the contact form.',
    hideROI: 'Hides the payback/ROI widget.',
    formTitle: 'Contact form title.',
    formSubtitle: 'Contact form subtitle.',
    resultsWhenSent: 'true = results shown before submit. false = form must be filled first.',
    showDniFieldOnResults: 'Adds a DNI/CIF input to the form.',
    showPhonePrefixFieldOnResults: 'Adds a phone-prefix selector.',
    showTypeOfDocumentFieldOnResults: 'Adds a document-type selector.',
    showDniValidationFieldOnResults: 'Visual DNI validation (green check).',
    showPhoneNumberValidationFieldOnResults: 'Visual phone validation.',
    showIdentifierValidationFieldOnResults: 'Visual identifier validation.',
    showSurnameValidationFieldOnResults: 'Visual surname validation.',
    showTypeOfClientSelectorOnResults: 'Selector for Individual / Company / Community.',
    titleModalOfConfirm: 'Title of the confirmation modal shown before submit.',
    textModalOfConfirm: 'Body of the confirmation modal.',
    businessName: 'Adds a "Business name" field to the form.',
    enablePeakPowerLimitation: 'Adds a peak-power limiter to the consumption section. Affects engine sizing.',
    includeBatteries: 'Includes battery sizing in the results.',
    enabledPPACalculation: 'Enables PPA (Power Purchase Agreement) modelling.',
    hideCommentField: 'Hides the free-text comment field.',
    alternativeCalculationEndpoint: 'URL to which calculation data is POSTed instead of the default engine endpoint. For white-label integrations.',
    alternativeCalculationLoadingMessage: 'Loading text while awaiting the alternative endpoint response.',
    redirectToShareable: 'After calculation, redirect to the shareable-study URL instead of rendering results in-place.',
  },
};

const CUSTOM_FIELDS: Section = {
  name: 'custom-fields',
  title: 'Extra lead fields persisted on the SolarStudy (plugin-gated).',
  summary: 'Only available when the client has the "studyCustomFields" plugin active.',
  fields: ['solarStudyCustomFields'],
  fieldDocs: {
    solarStudyCustomFields: 'Array of custom-field definitions, serialised. Each item: { id, label, type, required, options? }. Types: text|number|select|boolean. Use --from-file to avoid quoting headaches.',
  },
};

const SECTIONS: readonly Section[] = [
  GENERAL, COVER, SURFACES, CONSUMER, INCLINATION, ORIENTATION, PANELS, CONSUMPTION, RESULTS, CUSTOM_FIELDS,
];

function getAdvanced(client: AxiosInstance): Promise<Record<string, unknown>> {
  return client.get('/solar-form/config/advanced').then((r) => r.data as Record<string, unknown>);
}

function putAdvanced(client: AxiosInstance, payload: Record<string, unknown>): Promise<unknown> {
  return client.put('/solar-form/config/advanced', payload).then((r) => r.data);
}

/** Build a "Fields:" help block for a section. */
function formatFieldsHelp(section: Section): string {
  const longest = Math.max(...section.fields.map((f) => f.length));
  return [
    section.title,
    '',
    section.summary,
    '',
    'Fields:',
    ...section.fields.map((f) => `  ${f.padEnd(longest)}  ${section.fieldDocs[f] ?? ''}`),
    '',
    'Operations: get | set [--set key=value] [--from-file] [--<field> <value>] | edit',
  ].join('\n');
}

function attachSectionCommand(advanced: Command, section: Section): void {
  const sec = advanced
    .command(section.name)
    .description(formatFieldsHelp(section));

  sec
    .command('get')
    .description(`Fetch only the ${section.name} fields of the advanced config.`)
    .action(async () => {
      try {
        const global = getGlobalOpts(sec);
        const client = createServiceClient('solar', global);
        const doc = await getAdvanced(client);
        output(pickKeys(doc, section.fields), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  const setCmd = sec
    .command('set')
    .description(
      `Update the ${section.name} fields of the advanced config.\n` +
      'Combine per-field flags, repeatable --set key=value, and/or --from-file.\n' +
      'Internally GETs the current config, merges this section, and PUTs the whole thing.'
    )
    .option('--set <entries...>', 'Field assignments as key=value (repeatable)')
    .option('--from-file <path>', 'Load a partial payload from a JSON file');

  for (const field of section.fields) {
    setCmd.option(`--${kebab(field)} <value>`, section.fieldDocs[field] ?? field);
  }

  setCmd.action(async (opts) => {
    try {
      const global = getGlobalOpts(sec);
      const client = createServiceClient('solar', global);

      const flagValues: Record<string, unknown> = {};
      for (const field of section.fields) {
        const val = opts[field];
        if (val !== undefined) flagValues[field] = coerceValue(String(val));
      }
      const partial = buildPayload(flagValues, opts.set, opts.fromFile, section.fields);
      if (Object.keys(partial).length === 0) {
        outputError(new Error('No fields provided. Use flags, --set, or --from-file.'));
        return;
      }

      const current = await getAdvanced(client);
      const merged = { ...current, ...partial };
      const res = await putAdvanced(client, merged);
      output(pickKeys(res as Record<string, unknown>, section.fields), global);
    } catch (err) {
      outputError(handleApiError(err));
    }
  });

  sec
    .command('edit')
    .description(`Open $EDITOR on the ${section.name} subset of the advanced config, then PUT the whole config.`)
    .action(async () => {
      try {
        const global = getGlobalOpts(sec);
        const client = createServiceClient('solar', global);
        const current = await getAdvanced(client);
        const subset = pickKeys(current, section.fields);
        const edited = editJson(subset, `advanced-${section.name}`);
        const merged = { ...current, ...edited };
        const res = await putAdvanced(client, merged);
        output(pickKeys(res as Record<string, unknown>, section.fields), global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}

export function registerAdvancedCommands(solarform: Command): void {
  const advanced = solarform
    .command('advanced')
    .description(
      'SolarForm Advanced configuration (white-label microsite).\n' +
      'Each subcommand maps 1:1 with a section of the admin accordion and with a\n' +
      'subset of fields in the AdvancedSolarFormConfig DTO.\n\n' +
      'Whole-payload operations:\n' +
      '  get                    Fetch the full advanced config.\n' +
      '  update                 Merge a partial payload (--set / --from-file).\n' +
      '  delete                 Delete the authenticated client\'s advanced config.\n' +
      '  init-default           Create the default config for a clientUID (superadmin / localhost).\n\n' +
      'Sections (each: get / set / edit):\n' +
      SECTIONS.map((s) => `  ${s.name.padEnd(14)} ${s.title}`).join('\n') + '\n\n' +
      'Conventions:\n' +
      '  --set <field>=<value>  Assign a single field (repeatable).\n' +
      '  --from-file <path>     Load a partial payload from JSON.\n' +
      '  edit                   Open $EDITOR on the section\'s current state.'
    );

  advanced
    .command('get')
    .description('Fetch the full AdvancedSolarFormConfig for the authenticated client.')
    .action(async () => {
      try {
        const global = getGlobalOpts(advanced);
        const client = createServiceClient('solar', global);
        const data = await getAdvanced(client);
        output(data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  advanced
    .command('update')
    .description('Merge a partial AdvancedSolarFormConfig from --set / --from-file and PUT.')
    .option('--set <entries...>', 'Field assignments as key=value (repeatable)')
    .option('--from-file <path>', 'Load a partial payload from a JSON file')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(advanced);
        const client = createServiceClient('solar', global);
        const partial = buildPayload({}, opts.set, opts.fromFile);
        if (Object.keys(partial).length === 0) {
          outputError(new Error('No fields provided. Use --set or --from-file.'));
          return;
        }
        const current = await getAdvanced(client);
        const res = await putAdvanced(client, { ...current, ...partial });
        output(res, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  advanced
    .command('delete')
    .description('Delete the authenticated client\'s advanced config.')
    .action(async () => {
      try {
        const global = getGlobalOpts(advanced);
        const client = createServiceClient('solar', global);
        const res = await client.delete('/solar-form/config/advanced');
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  advanced
    .command('init-default')
    .description(
      'Create the default advanced config for a clientUID.\n' +
      'Restricted: requires the "suntropy-auth: <clientUID>" header or localhost execution.'
    )
    .requiredOption('--client-uid <uid>', 'Client UID to initialise')
    .option('--email <email>', 'Operator email (optional)')
    .option('--url <url>', 'Site URL (optional)')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(advanced);
        const client = createServiceClient('solar', global);
        const params: Record<string, string> = {};
        if (opts.email) params.email = opts.email;
        if (opts.url) params.url = opts.url;
        const res = await client.post(
          `/solar-form/config/default/advanced/${opts.clientUid}`,
          {},
          { params, headers: { 'suntropy-auth': opts.clientUid } },
        );
        output(res.data, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  for (const section of SECTIONS) attachSectionCommand(advanced, section);
}
