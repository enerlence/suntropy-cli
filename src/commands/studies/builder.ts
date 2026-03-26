import { Command } from 'commander';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { v4 } from 'uuid';
import { createServiceClient, handleApiError } from '../../client.js';
import { output, outputError, type OutputOptions } from '../../output.js';

// ─── Types ───

interface StepsProgress {
  clientDetails: boolean | undefined;
  consumption: boolean | undefined;
  surfacesSelector: boolean | undefined;
  production: boolean | undefined;
  results: boolean | undefined;
  economicBalance: boolean | undefined;
}

interface SolarStudyProgress {
  stepsProgress: StepsProgress;
  stepsUpdates: Record<string, boolean | undefined>;
  editingSolarStudy: boolean;
  lastStateUpdateMomentMS: number;
}

interface ByPeriodValues {
  p1?: number;
  p2?: number;
  p3?: number;
  p4?: number;
  p5?: number;
  p6?: number;
  [key: string]: number | undefined;
}

type Study = Record<string, unknown>;

// ─── Study defaults (replicates SolarStudy constructor) ───

function createDefaultStudy(name?: string): Study {
  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  return {
    id: v4(),
    surfaces: undefined,
    clientDetails: {
      identifier: undefined,
      sector: undefined,
      email: undefined,
      cups: undefined,
      phoneNumber: undefined,
      address: undefined,
      instalationLocation: undefined,
      region: undefined,
      subregion: undefined,
      addressCode: undefined,
      dniOrCif: undefined,
      includeTaxes: false,
      taxesPercentage: 0,
    },
    location: undefined,
    atrTariff: undefined,
    geographicalZone: undefined,
    energyPrices: { units: '€/kWh' },
    contractedPower: {},
    powerPrices: { units: '€/kW · dia' },
    results: undefined,
    consumptionIntroductionMode: 'periods',
    peakPowerIntroductionMode: 'solarKit',
    instalationPhaseNumber: 'single_phase',
    peakPowerOptimizationMethod: {
      maxNumberOfOverproductionMonths: 3,
    },
    useAlternativePrices: false,
    economicResults: {
      guaranteeProductionPercentage: 85,
      inflation: 3,
      instalationLifeTime: 25,
      commercialFeePercentage: 85,
      instalationFinancingPercentage: 0,
      taxesPercentage: 21,
      includeTaxes: false,
      margen: 0,
    },
    creationTimestamp: dateStr,
    solarStudyProgress: {
      stepsProgress: {
        clientDetails: undefined,
        consumption: undefined,
        economicBalance: undefined,
        production: undefined,
        results: undefined,
        surfacesSelector: undefined,
      },
      stepsUpdates: {
        clientDetails: false,
        consumption: false,
        economicBalance: false,
        production: false,
        results: false,
        surfacesSelector: false,
      },
      editingSolarStudy: false,
      lastStateUpdateMomentMS: now.getTime(),
    } as SolarStudyProgress,
    activeBatteries: false,
    batteriesConfiguration: {
      initialCapacityPercentage: 100,
      maxCapacityPercentage: 100,
      minCapacityPercentage: 0,
    },
    layout: 'v2',
    lastStateUpdateMomentMS: now.getTime(),
    name: name || `Estudio Solar ${dateStr}`,
    notes: undefined,
    market: 'es',
  };
}

// ─── Auto-validation engine (replicates frontend step conditions) ───

function checkByPeriodCompletion(periodNumber: number, element: ByPeriodValues | undefined): boolean {
  if (!element) return false;
  let assigned = 0;
  for (let i = 1; i <= 6; i++) {
    const val = element['p' + i];
    if (val !== undefined && val !== null && !isNaN(val)) {
      assigned++;
    }
  }
  return assigned >= periodNumber;
}

function evaluateSteps(study: Study): { stepsProgress: StepsProgress; missing: Record<string, string> } {
  const missing: Record<string, string> = {};

  // --- clientDetails ---
  const atrTariff = study.atrTariff as { periods?: number } | undefined;
  const energyPrices = study.energyPrices as ByPeriodValues | undefined;
  const geographicalZone = study.geographicalZone as Record<string, unknown> | undefined;
  const market = study.market as string | undefined;
  const extraCostPrice = study.extraCostPrice as ByPeriodValues | undefined;

  let clientDetailsComplete = true;
  if (!atrTariff) {
    clientDetailsComplete = false;
    missing.clientDetails = 'Needs atrTariff (use: studies set tariff)';
  } else if (!checkByPeriodCompletion(atrTariff.periods || 3, energyPrices)) {
    clientDetailsComplete = false;
    missing.clientDetails = `Needs energyPrices with ${atrTariff.periods || 3} periods filled (use: studies set prices)`;
  } else if (!geographicalZone) {
    clientDetailsComplete = false;
    missing.clientDetails = 'Needs geographicalZone (use: studies set tariff --zone-id N)';
  } else if (market === 'pt' && !checkByPeriodCompletion(1, extraCostPrice)) {
    clientDetailsComplete = false;
    missing.clientDetails = 'PT market needs extraCostPrice with 1 period (use: studies set prices --extra-cost-p1 N)';
  }

  // --- consumption ---
  const consumption = study.consumption as { days?: unknown[] } | undefined;
  const consumptionComplete = !!consumption?.days?.length;
  if (!consumptionComplete) {
    missing.consumption = 'Needs consumption curve (use: studies set consumption)';
  }

  // --- surfacesSelector ---
  const surfaces = study.surfaces as unknown[] | undefined;
  const surfacesComplete = !!surfaces?.length;
  if (!surfacesComplete) {
    missing.surfacesSelector = 'Needs at least one surface (use: studies add surface)';
  }

  // --- production ---
  // Requires: at least one surface with production curve AND equipment (panel or kit) selected
  const solarPanel = study.solarPanel as Record<string, unknown> | undefined;
  const solarKit = study.solarKit as Record<string, unknown> | undefined;
  const hasEquipment = !!solarPanel || !!solarKit;
  let hasProductionCurve = false;
  if (surfaces && surfaces.length > 0) {
    for (const s of surfaces) {
      const surf = s as { production?: { days?: unknown[] } };
      if (surf.production?.days?.length) {
        hasProductionCurve = true;
        break;
      }
    }
  }
  const productionComplete = hasProductionCurve && hasEquipment;
  if (!productionComplete) {
    const reasons: string[] = [];
    if (!hasEquipment) reasons.push('no panel or kit selected (use: studies set panel or studies set kit)');
    if (!hasProductionCurve) reasons.push('no surface has a production curve (use: studies calculate production)');
    missing.production = reasons.join('; ');
  }

  // --- results ---
  const results = study.results as Record<string, unknown> | undefined;
  const resultsComplete = results !== undefined;
  if (!resultsComplete) {
    missing.results = 'Results not calculated (use: studies calculate results)';
  }

  // --- economicBalance ---
  const economicResults = study.economicResults as Record<string, unknown> | undefined;
  const economicBalanceComplete =
    economicResults?.margen !== undefined &&
    economicResults?.totalCost !== undefined &&
    results !== undefined;
  if (!economicBalanceComplete) {
    const reasons: string[] = [];
    if (economicResults?.margen === undefined) reasons.push('margen');
    if (economicResults?.totalCost === undefined) reasons.push('totalCost');
    if (!results) reasons.push('results');
    missing.economicBalance = `Needs: ${reasons.join(', ')} (use: studies set economics)`;
  }

  return {
    stepsProgress: {
      clientDetails: clientDetailsComplete,
      consumption: consumptionComplete,
      surfacesSelector: surfacesComplete,
      production: productionComplete,
      results: resultsComplete,
      economicBalance: economicBalanceComplete,
    },
    missing,
  };
}

function calculateCompletionPercentage(stepsProgress: StepsProgress): number {
  const completed = Object.values(stepsProgress).filter(Boolean).length;
  return Math.round((completed / 6) * 100);
}

// ─── Cascade resets ───

type StepName = keyof StepsProgress;

const CASCADE_RESETS: Record<string, StepName[]> = {
  consumption: ['production', 'results', 'economicBalance'],
  surfaces: ['production', 'results', 'economicBalance'],
};

function applyCascadeResets(study: Study, changedField: string): string[] {
  const resetSteps = CASCADE_RESETS[changedField];
  if (!resetSteps) return [];

  const progress = (study.solarStudyProgress as SolarStudyProgress);
  const resets: string[] = [];
  for (const step of resetSteps) {
    if (progress.stepsProgress[step] !== undefined) {
      progress.stepsProgress[step] = undefined;
      resets.push(step);
    }
  }

  // Also clear dependent data for full resets
  if (changedField === 'consumption') {
    // Don't clear surfaces production, only results
    study.results = undefined;
  }
  if (changedField === 'surfaces') {
    study.results = undefined;
  }

  return resets;
}

// ─── File I/O helpers ───

function readStudy(filePath: string): Study {
  if (!existsSync(filePath)) {
    throw new Error(`Study file not found: ${filePath}. Use 'studies init --file ${filePath}' to create one.`);
  }
  return JSON.parse(readFileSync(filePath, 'utf-8'));
}

function writeStudy(filePath: string, study: Study): void {
  writeFileSync(filePath, JSON.stringify(study, null, 2), 'utf-8');
}

/** Read study, apply changes, re-validate, write back, return status */
function updateStudy(
  filePath: string,
  updater: (study: Study) => string | undefined, // returns cascade field name or undefined
): { stepsProgress: StepsProgress; completionPercentage: number; missing: Record<string, string>; cascadeResets: string[] } {
  const study = readStudy(filePath);
  const cascadeField = updater(study);

  // Apply cascade resets
  let cascadeResets: string[] = [];
  if (cascadeField) {
    cascadeResets = applyCascadeResets(study, cascadeField);
  }

  // Re-evaluate all steps
  const { stepsProgress, missing } = evaluateSteps(study);

  // Update solarStudyProgress
  const progress = study.solarStudyProgress as SolarStudyProgress;
  progress.stepsProgress = stepsProgress;
  progress.lastStateUpdateMomentMS = Date.now();
  study.lastStateUpdateMomentMS = Date.now();

  writeStudy(filePath, study);

  return {
    stepsProgress,
    completionPercentage: calculateCompletionPercentage(stepsProgress),
    missing,
    cascadeResets,
  };
}

/** Deep merge: target ← source (non-destructive, arrays replaced not merged) */
function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const key of Object.keys(source)) {
    const sv = source[key];
    const tv = target[key];
    if (sv && typeof sv === 'object' && !Array.isArray(sv) && tv && typeof tv === 'object' && !Array.isArray(tv)) {
      deepMerge(tv as Record<string, unknown>, sv as Record<string, unknown>);
    } else {
      target[key] = sv;
    }
  }
}

// ─── CLI helpers ───

function getGlobalOpts(cmd: Command): OutputOptions & Record<string, unknown> {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

function resolveFile(opts: { file?: string }): string {
  return opts.file || process.env.SUNTROPY_STUDY || './study.json';
}

// ─── Register commands ───

export function registerStudyBuilderCommands(studies: Command): void {

  // ═══════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════
  studies
    .command('init')
    .description(
      'Create a new study workspace (local JSON file with defaults).\n' +
      'Example: suntropy studies init --file /tmp/study.json --name "Residencial 5kW"'
    )
    .option('--file <path>', 'Output file path (default: ./study.json)')
    .option('--name <studyName>', 'Study name')
    .option('--market <code>', 'Market country: es, pt, it, fr, de, etc.', 'es')
    .action(async (opts) => {
      try {
        const filePath = resolveFile(opts);
        const study = createDefaultStudy(opts.name);
        if (opts.market) study.market = opts.market;
        writeStudy(filePath, study);
        const { stepsProgress, missing } = evaluateSteps(study);
        output({
          file: filePath,
          id: study.id,
          name: study.name,
          stepsProgress,
          completionPercentage: 0,
          missing,
        }, getGlobalOpts(studies));
      } catch (err) {
        outputError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // ═══════════════════════════════════════════
  //  VALIDATE
  // ═══════════════════════════════════════════
  studies
    .command('validate')
    .description(
      'Check completion status of all study steps.\n' +
      'Returns stepsProgress, completionPercentage, and what is missing for each incomplete step.'
    )
    .option('--file <path>', 'Study file path')
    .action(async (opts) => {
      try {
        const study = readStudy(resolveFile(opts));
        const { stepsProgress, missing } = evaluateSteps(study);
        output({
          name: study.name,
          stepsProgress,
          completionPercentage: calculateCompletionPercentage(stepsProgress),
          missing,
        }, getGlobalOpts(studies));
      } catch (err) {
        outputError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // ═══════════════════════════════════════════
  //  SAVE
  // ═══════════════════════════════════════════
  studies
    .command('save')
    .description(
      'Save study to the backend (POST /solar-study).\n' +
      'If the study has _id, it updates the existing study. Otherwise creates new.\n' +
      'Example: suntropy studies save --file /tmp/study.json --state-id 1'
    )
    .option('--file <path>', 'Study file path')
    .option('--state-id <n>', 'Solar study metadata state ID')
    .option('--credit-amount <n>', 'Credit amount to consume')
    .option('--save-as-new', 'Force save as new study (even if _id exists)')
    .action(async (opts) => {
      try {
        const filePath = resolveFile(opts);
        const global = getGlobalOpts(studies);
        const study = readStudy(filePath);

        // Re-validate before saving
        const { stepsProgress } = evaluateSteps(study);
        const progress = study.solarStudyProgress as SolarStudyProgress;
        progress.stepsProgress = stepsProgress;
        progress.lastStateUpdateMomentMS = Date.now();

        if (opts.saveAsNew) {
          delete study._id;
        }

        const client = createServiceClient('solar', global);
        const params: Record<string, string> = {};
        if (opts.stateId) params.idSolarStudyState = opts.stateId;
        if (opts.creditAmount) params.creditAmount = opts.creditAmount;
        if (opts.saveAsNew) params.saveAsNew = 'true';

        const queryString = Object.entries(params)
          .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
          .join('&');
        const url = `/solar-study${queryString ? '?' + queryString : ''}`;

        const res = await client.post(url, study);

        // If response contains _id or solarStudyId, update local file
        const responseData = res.data as Record<string, unknown>;
        if (responseData?.solarStudyId) {
          study._id = responseData.solarStudyId as string;
          progress.editingSolarStudy = true;
          writeStudy(filePath, study);
        }

        output({
          saved: true,
          metadata: responseData,
          file: filePath,
          completionPercentage: calculateCompletionPercentage(stepsProgress),
        }, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // ═══════════════════════════════════════════
  //  PULL
  // ═══════════════════════════════════════════
  studies
    .command('pull <studyId>')
    .description(
      'Download an existing study from the backend into a local file.\n' +
      'Example: suntropy studies pull abc123 --file /tmp/study.json'
    )
    .option('--file <path>', 'Output file path')
    .action(async (studyId, opts) => {
      try {
        const filePath = resolveFile(opts);
        const global = getGlobalOpts(studies);
        const client = createServiceClient('solar', global);
        const res = await client.get(`/solar-study/findById/${studyId}`);
        const study = res.data as Study;

        // Re-validate
        const { stepsProgress, missing } = evaluateSteps(study);
        const progress = (study.solarStudyProgress || {}) as SolarStudyProgress;
        progress.stepsProgress = stepsProgress;
        progress.editingSolarStudy = true;
        study.solarStudyProgress = progress;

        writeStudy(filePath, study);
        output({
          file: filePath,
          _id: study._id,
          name: study.name,
          stepsProgress,
          completionPercentage: calculateCompletionPercentage(stepsProgress),
          missing,
        }, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // ═══════════════════════════════════════════
  //  SET — parent command for all sub-commands
  // ═══════════════════════════════════════════
  const set = studies.command('set').description('Set study properties. Each sub-command auto-validates after changes.');

  // --- set name ---
  set
    .command('name')
    .description('Set the study name')
    .option('--file <path>', 'Study file path')
    .requiredOption('--name <studyName>', 'Study name')
    .action(async (opts) => {
      try {
        const result = updateStudy(resolveFile(opts), (study) => {
          study.name = opts.name;
          return undefined;
        });
        output(result, getGlobalOpts(studies));
      } catch (err) {
        outputError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // --- set market ---
  set
    .command('market')
    .description('Set the market country code (es, pt, it, fr, de, etc.)')
    .option('--file <path>', 'Study file path')
    .requiredOption('--market <code>', 'Market country code')
    .action(async (opts) => {
      try {
        const result = updateStudy(resolveFile(opts), (study) => {
          study.market = opts.market;
          return undefined;
        });
        output(result, getGlobalOpts(studies));
      } catch (err) {
        outputError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // --- set client ---
  set
    .command('client')
    .description(
      'Set client details (name, email, phone, cups, address, etc.)\n' +
      'Example: suntropy studies set client --file study.json --name "Juan García" --email j@co.com --cups ES001234'
    )
    .option('--file <path>', 'Study file path')
    .option('--name <clientName>', 'Client name (identifier/razón social)')
    .option('--email <email>', 'Client email')
    .option('--phone <phone>', 'Phone number')
    .option('--cups <cups>', 'CUPS code')
    .option('--address <addr>', 'Address')
    .option('--city <city>', 'City')
    .option('--region <region>', 'Region (comunidad autónoma)')
    .option('--subregion <subregion>', 'Subregion (provincia)')
    .option('--dni <dni>', 'DNI or CIF')
    .option('--sector <sector>', 'Client sector')
    .option('--installation-location <loc>', 'Installation location description')
    .action(async (opts) => {
      try {
        const result = updateStudy(resolveFile(opts), (study) => {
          const cd = (study.clientDetails || {}) as Record<string, unknown>;
          if (opts.name) cd.identifier = opts.name;
          if (opts.email) cd.email = opts.email;
          if (opts.phone) cd.phoneNumber = opts.phone;
          if (opts.cups) cd.cups = opts.cups;
          if (opts.address) cd.address = opts.address;
          if (opts.city) cd.city = opts.city;
          if (opts.region) cd.region = opts.region;
          if (opts.subregion) cd.subregion = opts.subregion;
          if (opts.dni) cd.dniOrCif = opts.dni;
          if (opts.sector) cd.sector = opts.sector;
          if (opts.installationLocation) cd.instalationLocation = opts.installationLocation;
          study.clientDetails = cd;
          return undefined;
        });
        output(result, getGlobalOpts(studies));
      } catch (err) {
        outputError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // --- set tariff ---
  set
    .command('tariff')
    .description(
      'Set ATR tariff and geographical zone. Auto-sets phase (>3 periods → three_phase).\n' +
      'Common tariff IDs (Spain): 13=2.0TD (3 periods), 14=3.0TD (6 periods)\n' +
      'Zone IDs (Spain): 1=Peninsula, 2=Canarias, 3=Baleares\n' +
      'Example: suntropy studies set tariff --file study.json --tariff-id 13 --zone-id 1'
    )
    .option('--file <path>', 'Study file path')
    .requiredOption('--tariff-id <n>', 'ATR tariff ID')
    .option('--zone-id <n>', 'Geographical zone ID', '1')
    .option('--market <code>', 'Market code for tariff lookup', 'es')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(studies);
        const client = createServiceClient('periods', global);

        // Fetch tariff info
        const tariffRes = await client.get('/tarifas-atr', {
          params: { market: opts.market },
        });
        const tariffs = (Array.isArray(tariffRes.data) ? tariffRes.data : tariffRes.data?.data || []) as Record<string, unknown>[];
        const tariffId = parseInt(opts.tariffId);
        const tariff = tariffs.find((t) => t.idTarifaATR === tariffId);
        if (!tariff) {
          outputError(new Error(`Tariff ID ${tariffId} not found. Available: ${tariffs.map((t) => `${t.idTarifaATR}=${t.nombre}`).join(', ')}`));
          return;
        }

        // Fetch zone info
        const zoneRes = await client.get('/zonas', {
          params: { market: opts.market },
        });
        const zones = (Array.isArray(zoneRes.data) ? zoneRes.data : zoneRes.data?.data || []) as Record<string, unknown>[];
        const zoneId = parseInt(opts.zoneId);
        const zone = zones.find((z) => z.idZona === zoneId);

        const result = updateStudy(resolveFile(opts), (study) => {
          study.atrTariff = tariff;
          if (zone) study.geographicalZone = zone;

          // Auto-set phase based on tariff periods (replicates frontend logic)
          const periods = (tariff.periods as number) || 3;
          study.instalationPhaseNumber = periods > 3 ? 'three_phase' : 'single_phase';

          return undefined; // no cascade reset for tariff change
        });

        output(result, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- set prices ---
  set
    .command('prices')
    .description(
      'Set energy prices by period.\n' +
      'Examples:\n' +
      '  suntropy studies set prices --file study.json --energy \'{"p1":0.15,"p2":0.08,"p3":0.06}\'\n' +
      '  suntropy studies set prices --file study.json --energy-p1 0.15 --energy-p2 0.08 --energy-p3 0.06\n' +
      '  suntropy studies set prices --file study.json --energy \'{"p1":0.15,...}\' --power \'{"p1":40,...}\' --contracted \'{"p1":5.5,...}\''
    )
    .option('--file <path>', 'Study file path')
    .option('--energy <json>', 'Energy prices JSON: {"p1":N,"p2":N,...}')
    .option('--energy-p1 <n>', 'Energy price period 1 (€/kWh)')
    .option('--energy-p2 <n>', 'Energy price period 2 (€/kWh)')
    .option('--energy-p3 <n>', 'Energy price period 3 (€/kWh)')
    .option('--energy-p4 <n>', 'Energy price period 4 (€/kWh)')
    .option('--energy-p5 <n>', 'Energy price period 5 (€/kWh)')
    .option('--energy-p6 <n>', 'Energy price period 6 (€/kWh)')
    .option('--power <json>', 'Power prices JSON: {"p1":N,"p2":N,...} (€/kW·day)')
    .option('--contracted <json>', 'Contracted power JSON: {"p1":N,"p2":N,...} (kW)')
    .option('--extra-cost-p1 <n>', 'Extra cost price P1 (Portugal market)')
    .action(async (opts) => {
      try {
        const result = updateStudy(resolveFile(opts), (study) => {
          // Energy prices: from JSON or individual flags
          const ep = (study.energyPrices || { units: '€/kWh' }) as Record<string, unknown>;
          if (opts.energy) {
            const parsed = JSON.parse(opts.energy);
            Object.assign(ep, parsed);
          }
          for (let i = 1; i <= 6; i++) {
            const val = opts[`energyP${i}`];
            if (val !== undefined) ep[`p${i}`] = parseFloat(val);
          }
          study.energyPrices = ep;

          // Power prices
          if (opts.power) {
            const pp = (study.powerPrices || { units: '€/kW · dia' }) as Record<string, unknown>;
            Object.assign(pp, JSON.parse(opts.power));
            study.powerPrices = pp;
          }

          // Contracted power
          if (opts.contracted) {
            const cp = (study.contractedPower || {}) as Record<string, unknown>;
            Object.assign(cp, JSON.parse(opts.contracted));
            study.contractedPower = cp;
          }

          // Extra cost (Portugal)
          if (opts.extraCostP1 !== undefined) {
            study.extraCostPrice = { p1: parseFloat(opts.extraCostP1), units: '€/kWh' };
          }

          return undefined; // no cascade
        });
        output(result, getGlobalOpts(studies));
      } catch (err) {
        outputError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // --- set consumption ---
  set
    .command('consumption')
    .description(
      'Set the consumption curve.\n' +
      'Modes:\n' +
      '  --from-file <path>     Load PowerCurve from JSON file\n' +
      '  --annual + --pattern   Generate via consumption-estimation API\n' +
      '  --by-period <json>     Period consumption: {"p1":N,"p2":N,"p3":N} + REE profile\n' +
      '  --monthly <json>       Monthly consumption: {"1":N,"2":N,...,"12":N} + REE profile\n' +
      '  --monthly-by-period    Monthly by period: {"1":{"p1":N,"p2":N},...} + REE profile\n\n' +
      'Examples:\n' +
      '  suntropy studies set consumption --file study.json --from-file /tmp/cons.json\n' +
      '  suntropy studies set consumption --file study.json --annual 4000 --pattern Balance\n' +
      '  suntropy studies set consumption --file study.json --by-period \'{"p1":2500,"p2":1000,"p3":500}\'\n' +
      '  suntropy studies set consumption --file study.json --monthly \'{"1":350,"2":320,...}\''
    )
    .option('--file <path>', 'Study file path')
    .option('--from-file <curvePath>', 'Load PowerCurve from JSON file')
    .option('--annual <kWh>', 'Annual consumption in kWh')
    .option('--pattern <name>', 'Pattern: Balance, Nightly, Morning, Afternoon, Domestic, Commercial')
    .option('--by-period <json>', 'Period consumption JSON: {"p1":N,"p2":N,...}')
    .option('--monthly <json>', 'Monthly consumption JSON: {"1":N,...,"12":N}')
    .option('--monthly-by-period <json>', 'Monthly by period: {"1":{"p1":N,...},...}')
    .option('--tariff <code>', 'Tariff code for profile lookup (default: from study)')
    .option('--market <code>', 'Market code (default: from study)')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(studies);
        const filePath = resolveFile(opts);
        const study = readStudy(filePath);
        const studyTariff = (study.atrTariff as Record<string, unknown>)?.nombre as string || '3.0TD';
        const studyMarket = (study.market as string) || 'es';
        const tariff = opts.tariff || studyTariff;
        const market = opts.market || studyMarket;
        const year = new Date().getFullYear();

        let curveData: unknown;
        let introductionMode: string;

        if (opts.fromFile) {
          // Load from file
          curveData = JSON.parse(readFileSync(opts.fromFile, 'utf-8'));
          introductionMode = 'upload';

        } else if (opts.annual && opts.pattern) {
          // Generate via backend /consumption-estimation
          const profilesClient = createServiceClient('profiles', global);
          const params: Record<string, string> = {
            startDate: `${year}-01-01`,
            endDate: `${year}-12-31`,
            tariff,
            type: 'Final',
            anualConsumption: opts.annual,
            market,
            consumptionType: opts.pattern,
          };
          const queryString = Object.entries(params)
            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
            .join('&');
          const res = await profilesClient.post(`/consumption-estimation?${queryString}`, {});
          curveData = res.data;
          introductionMode = 'consumption_patterns';

        } else if (opts.byPeriod) {
          // Fetch REE profile + period distribution, apply locally
          const periodValues = JSON.parse(opts.byPeriod);
          curveData = await generateFromProfile(global, tariff, market, year, 'CONSUMPTION_BY_PERIOD', periodValues);
          introductionMode = 'periods';

        } else if (opts.monthly) {
          // Fetch REE profile, apply monthly consumption
          const monthValues = JSON.parse(opts.monthly);
          curveData = await generateFromProfile(global, tariff, market, year, 'MONTH_CONSUMPTION', monthValues);
          introductionMode = 'monthly_consumption';

        } else if (opts.monthlyByPeriod) {
          // Complex: monthly by period
          const monthPeriodValues = JSON.parse(opts.monthlyByPeriod);
          curveData = await generateFromProfile(global, tariff, market, year, 'MONTHLY_BY_PERIOD', monthPeriodValues);
          introductionMode = 'monthly_periods';

        } else {
          outputError(new Error('Specify one of: --from-file, --annual + --pattern, --by-period, --monthly, --monthly-by-period'));
          return;
        }

        // Update study with consumption
        const result = updateStudy(filePath, (s) => {
          s.consumption = curveData;
          s.consumptionIntroductionMode = introductionMode;
          if (opts.annual) s.monthlyConsumption = parseFloat(opts.annual) / 12;
          if (opts.pattern) s.selectedConsumptionPattern = opts.pattern;
          if (opts.byPeriod) s.periodConsumptionDictionary = JSON.parse(opts.byPeriod);
          if (opts.monthly) s.monthConsumptionDictionary = JSON.parse(opts.monthly);
          if (opts.monthlyByPeriod) s.monthPeriodConsumptionDictionary = JSON.parse(opts.monthlyByPeriod);
          return 'consumption'; // trigger cascade
        });

        output(result, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- add surface ---
  studies
    .command('add')
    .description('Add elements to the study')
    .command('surface')
    .description(
      'Add a solar surface to the study.\n' +
      'Example: suntropy studies add surface --file study.json --lat 37.39 --lon -5.99 --angle 30 --azimuth 180 --power 5000'
    )
    .option('--file <path>', 'Study file path')
    .requiredOption('--lat <n>', 'Latitude')
    .requiredOption('--lon <n>', 'Longitude')
    .option('--angle <n>', 'Panel inclination degrees', '30')
    .option('--azimuth <n>', 'Panel azimuth degrees (0=N, 180=S)', '180')
    .option('--power <w>', 'Installed power in Watts')
    .option('--panels-count <n>', 'Number of panels')
    .option('--production <file>', 'Production PowerCurve JSON file to attach')
    .option('--identifier <name>', 'Surface name/identifier')
    .action(async (opts) => {
      try {
        const result = updateStudy(resolveFile(opts), (study) => {
          const lat = parseFloat(opts.lat);
          const lng = parseFloat(opts.lon);
          const surface: Record<string, unknown> = {
            surfaceId: v4(),
            name: opts.identifier || `Surface ${((study.surfaces as unknown[])?.length || 0) + 1}`,
            inclination: parseFloat(opts.angle),
            orientation: parseFloat(opts.azimuth),
            panelInclination: parseFloat(opts.angle),
            panelOrientation: parseFloat(opts.azimuth),
            lossesPercentage: 14,
            // polygonPath required by backend metadata constructor
            polygonPath: [{ lat, lng }],
          };
          if (opts.power) surface.installedPower = parseFloat(opts.power);
          if (opts.panelsCount) surface.panelNumber = parseInt(opts.panelsCount);
          if (opts.production) {
            surface.production = JSON.parse(readFileSync(opts.production, 'utf-8'));
          }

          // Also set study-level location
          study.location = { lat: parseFloat(opts.lat), lng: parseFloat(opts.lon) };
          study.mapCenter = { lat: parseFloat(opts.lat), lng: parseFloat(opts.lon) };

          const surfaces = (study.surfaces as unknown[]) || [];
          surfaces.push(surface);
          study.surfaces = surfaces;

          return 'surfaces'; // cascade
        });
        output(result, getGlobalOpts(studies));
      } catch (err) {
        outputError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // --- remove surface ---
  studies
    .command('remove')
    .description('Remove elements from the study')
    .command('surface')
    .description('Remove a surface by index')
    .option('--file <path>', 'Study file path')
    .requiredOption('--index <n>', 'Surface index (0-based)')
    .action(async (opts) => {
      try {
        const result = updateStudy(resolveFile(opts), (study) => {
          const surfaces = (study.surfaces as unknown[]) || [];
          const idx = parseInt(opts.index);
          if (idx < 0 || idx >= surfaces.length) {
            throw new Error(`Surface index ${idx} out of range (0-${surfaces.length - 1})`);
          }
          surfaces.splice(idx, 1);
          study.surfaces = surfaces.length > 0 ? surfaces : undefined;
          return 'surfaces'; // cascade
        });
        output(result, getGlobalOpts(studies));
      } catch (err) {
        outputError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // --- set panel ---
  set
    .command('panel')
    .description(
      'Set solar panel for the study. Auto-sets peakPowerIntroductionMode to "solarPanel".\n' +
      'Fetches full panel data from inventory.\n' +
      'Example: suntropy studies set panel --file study.json --panel-id 456 --panels-count 12'
    )
    .option('--file <path>', 'Study file path')
    .requiredOption('--panel-id <n>', 'Solar panel ID from inventory')
    .option('--panels-count <n>', 'Number of panels')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(studies);
        const solarClient = createServiceClient('solar', global);

        // Fetch full panel data
        const panelRes = await solarClient.get(`/solar-panels/${opts.panelId}`);
        const panel = panelRes.data;

        const result = updateStudy(resolveFile(opts), (study) => {
          study.solarPanel = panel;
          study.peakPowerIntroductionMode = 'solarPanel';
          // Clear kit when switching to panel mode
          study.solarKit = undefined;
          if (opts.panelsCount) {
            // Set panels count on first surface if exists
            const surfaces = study.surfaces as Record<string, unknown>[] | undefined;
            if (surfaces?.length) {
              surfaces[0].panelNumber = parseInt(opts.panelsCount);
            }
          }
          return undefined;
        });
        output(result, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- set kit ---
  set
    .command('kit')
    .description(
      'Set solar kit for the study. Auto-sets peakPowerIntroductionMode to "solarKit".\n' +
      'Fetches full kit data from inventory.\n' +
      'Example: suntropy studies set kit --file study.json --kit-id 123'
    )
    .option('--file <path>', 'Study file path')
    .requiredOption('--kit-id <n>', 'Solar kit ID from inventory')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(studies);
        const solarClient = createServiceClient('solar', global);

        // Kits use getViaFilter (no GET /:id)
        const kitsRes = await solarClient.get('/solar-kits', { params: { unactive: true } });
        const allKits = Array.isArray(kitsRes.data) && Array.isArray(kitsRes.data[0])
          ? kitsRes.data[0]
          : (Array.isArray(kitsRes.data) ? kitsRes.data : kitsRes.data?.data || []);
        const kitId = parseInt(opts.kitId);
        const kit = allKits.find((k: Record<string, unknown>) => k.idSolarKit === kitId);
        if (!kit) {
          outputError(new Error(`Kit ${kitId} not found`));
          return;
        }

        const result = updateStudy(resolveFile(opts), (study) => {
          study.solarKit = kit;
          study.peakPowerIntroductionMode = 'solarKit';
          // Clear panel + inverters when switching to kit mode
          study.solarPanel = undefined;
          study.solarInverters = undefined;
          return undefined;
        });
        output(result, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- set inverter ---
  set
    .command('inverter')
    .description(
      'Set inverter(s) for the study (when using solarPanel mode).\n' +
      'Example: suntropy studies set inverter --file study.json --inverter-id 789'
    )
    .option('--file <path>', 'Study file path')
    .requiredOption('--inverter-id <ids>', 'Inverter ID(s), comma-separated for multiple')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(studies);
        const solarClient = createServiceClient('solar', global);
        const ids = opts.inverterId.split(',').map((s: string) => parseInt(s.trim()));

        const inverters: unknown[] = [];
        for (const id of ids) {
          const res = await solarClient.get(`/solar-inverter/${id}`);
          inverters.push(res.data);
        }

        const result = updateStudy(resolveFile(opts), (study) => {
          study.solarInverters = inverters;
          return undefined;
        });
        output(result, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- set phase ---
  set
    .command('phase')
    .description('Manually set installation phase (overrides auto-set from tariff)')
    .option('--file <path>', 'Study file path')
    .requiredOption('--phase <type>', 'Phase: single_phase or three_phase')
    .action(async (opts) => {
      try {
        if (!['single_phase', 'three_phase'].includes(opts.phase)) {
          outputError(new Error('Phase must be single_phase or three_phase'));
          return;
        }
        const result = updateStudy(resolveFile(opts), (study) => {
          study.instalationPhaseNumber = opts.phase;
          return undefined;
        });
        output(result, getGlobalOpts(studies));
      } catch (err) {
        outputError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // --- set economics ---
  set
    .command('economics')
    .description(
      'Set economic parameters for the study.\n' +
      'Example: suntropy studies set economics --file study.json --margin 15 --total-cost 6500 --lifetime 25'
    )
    .option('--file <path>', 'Study file path')
    .option('--margin <n>', 'Margin percentage')
    .option('--total-cost <n>', 'Total installation cost (€)')
    .option('--lifetime <n>', 'Installation lifetime in years')
    .option('--inflation <n>', 'Inflation rate percentage')
    .option('--taxes-pct <n>', 'Tax percentage')
    .option('--include-taxes', 'Include taxes in pricing')
    .option('--commercial-fee <n>', 'Commercial fee percentage')
    .option('--excesses-mode <mode>', 'Excesses compensation: gridSelling, PPA, noInjection, virtualBattery')
    .option('--excesses-buy-price <n>', 'Excesses buy price (€/MWh)')
    .option('--excesses-selling-price <n>', 'Excesses selling price (€/MWh)')
    .option('--peak-power-cost <n>', 'Cost per kWp (€/kWp)')
    .option('--guarantee-production <n>', 'Guarantee production percentage')
    .action(async (opts) => {
      try {
        const result = updateStudy(resolveFile(opts), (study) => {
          const er = (study.economicResults || {}) as Record<string, unknown>;
          if (opts.margin !== undefined) er.margen = parseFloat(opts.margin);
          if (opts.totalCost !== undefined) er.totalCost = parseFloat(opts.totalCost);
          if (opts.lifetime !== undefined) er.instalationLifeTime = parseInt(opts.lifetime);
          if (opts.inflation !== undefined) er.inflation = parseFloat(opts.inflation);
          if (opts.taxesPct !== undefined) er.taxesPercentage = parseFloat(opts.taxesPct);
          if (opts.includeTaxes) er.includeTaxes = true;
          if (opts.commercialFee !== undefined) er.commercialFeePercentage = parseFloat(opts.commercialFee);
          if (opts.excessesMode) er.excessesCompensationMode = opts.excessesMode;
          if (opts.excessesBuyPrice !== undefined) er.excessesBuyPrice = parseFloat(opts.excessesBuyPrice);
          if (opts.excessesSellingPrice !== undefined) er.excessesSellingPrice = parseFloat(opts.excessesSellingPrice);
          if (opts.peakPowerCost !== undefined) er.peakPowerCost = parseFloat(opts.peakPowerCost);
          if (opts.guaranteeProduction !== undefined) er.guaranteeProductionPercentage = parseFloat(opts.guaranteeProduction);
          study.economicResults = er;
          return undefined;
        });
        output(result, getGlobalOpts(studies));
      } catch (err) {
        outputError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // --- set custom-assets ---
  set
    .command('custom-assets')
    .description(
      'Set selected custom assets for the study.\n' +
      'Example: suntropy studies set custom-assets --file study.json --asset 100:12 --asset 200:1'
    )
    .option('--file <path>', 'Study file path')
    .requiredOption('--asset <id:qty>', 'Custom asset as id:quantity (repeatable)', collectAssets, [])
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(studies);
        const solarClient = createServiceClient('solar', global);

        // Fetch full custom asset data for each
        const assets: unknown[] = [];
        for (const { id, quantity } of opts.asset) {
          const res = await solarClient.get(`/custom-asset/id/${id}`);
          assets.push({ customAsset: res.data, quantity });
        }

        const result = updateStudy(resolveFile(opts), (study) => {
          study.selectedCustomAssets = assets;
          return undefined;
        });
        output(result, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- set batteries ---
  set
    .command('batteries')
    .description(
      'Enable/disable batteries and set configuration.\n' +
      'Example: suntropy studies set batteries --file study.json --enable --battery-id 789 --count 1'
    )
    .option('--file <path>', 'Study file path')
    .option('--enable', 'Enable batteries')
    .option('--disable', 'Disable batteries')
    .option('--battery-id <n>', 'Battery ID from inventory')
    .option('--count <n>', 'Number of batteries')
    .action(async (opts) => {
      try {
        const result = updateStudy(resolveFile(opts), (study) => {
          if (opts.enable) study.activeBatteries = true;
          if (opts.disable) study.activeBatteries = false;
          if (opts.batteryId) {
            // Store battery reference — the full battery object would be fetched when calculating
            const config = (study.batteriesConfiguration || {}) as Record<string, unknown>;
            config.batteryId = parseInt(opts.batteryId);
            if (opts.count) config.batteriesNumber = parseInt(opts.count);
            study.batteriesConfiguration = config;
          }
          return undefined;
        });
        output(result, getGlobalOpts(studies));
      } catch (err) {
        outputError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // --- set data (generic fallback) ---
  set
    .command('data')
    .description(
      'Generic JSON merge into the study (fallback for any field).\n' +
      'Example: suntropy studies set data --file study.json --data \'{"referenceId":"REF-001"}\''
    )
    .option('--file <path>', 'Study file path')
    .requiredOption('--data <json>', 'JSON to merge into the study')
    .action(async (opts) => {
      try {
        const parsed = JSON.parse(opts.data);
        // Detect cascade fields
        const cascadeFields = Object.keys(parsed);
        let cascadeField: string | undefined;
        if (cascadeFields.includes('consumption')) cascadeField = 'consumption';
        if (cascadeFields.includes('surfaces')) cascadeField = 'surfaces';

        const result = updateStudy(resolveFile(opts), (study) => {
          deepMerge(study, parsed);
          return cascadeField;
        });
        output(result, getGlobalOpts(studies));
      } catch (err) {
        outputError(err instanceof Error ? err : new Error(String(err)));
      }
    });

  // ═══════════════════════════════════════════
  //  CALCULATE — commands that call backend APIs
  // ═══════════════════════════════════════════

  // --- calculate production ---
  studies
    .command('calculate')
    .description('Calculate derived data for the study')
    .command('production')
    .description(
      'Calculate production for study surfaces using backend API.\n' +
      'Example: suntropy studies calculate production --file study.json [--surface-index 0 | --all-surfaces]'
    )
    .option('--file <path>', 'Study file path')
    .option('--surface-index <n>', 'Calculate for specific surface index')
    .option('--all-surfaces', 'Calculate for all surfaces')
    .option('--losses <n>', 'Losses percentage', '14')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(studies);
        const filePath = resolveFile(opts);
        const study = readStudy(filePath);
        const surfaces = study.surfaces as Record<string, unknown>[] | undefined;

        if (!surfaces?.length) {
          outputError(new Error('No surfaces in study. Use: studies add surface'));
          return;
        }

        const solarClient = createServiceClient('solar', global);
        const indicesToCalc = opts.surfaceIndex !== undefined
          ? [parseInt(opts.surfaceIndex)]
          : Array.from({ length: surfaces.length }, (_, i) => i);

        for (const idx of indicesToCalc) {
          const surface = surfaces[idx];
          if (!surface) continue;
          // Get coordinates from surface center or study location
          const center = surface.center as { lat: number; lng: number } | undefined;
          const studyLocation = study.location as { lat: number; lng: number } | undefined;
          const lat = center?.lat || studyLocation?.lat;
          const lng = center?.lng || studyLocation?.lng;
          if (!lat || !lng) {
            outputError(new Error(`Surface ${idx} has no coordinates. Use: studies add surface --lat N --lon N`));
            continue;
          }
          const body = {
            lat,
            long: lng,
            instaledPower: (surface.installedPower as number) || 5000,
            angle: (surface.inclination as number) || (surface.angle as number) || 30,
            azimuth: (surface.orientation as number) || (surface.azimuth as number) || 180,
            lossesPercentage: parseFloat(opts.losses),
            year: new Date().getFullYear(),
            isOptimized: false,
          };
          const res = await solarClient.post('/solar-study/calculateProduction', body);
          surface.production = res.data;
        }

        // Write back and validate
        const result = updateStudy(filePath, (s) => {
          s.surfaces = surfaces;
          return undefined; // don't cascade — we're setting production, not changing surfaces
        });
        output(result, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- calculate results ---
  studies
    .command('calculate-results')
    .description(
      'Calculate energy results (net consumption, excesses, savings) from consumption + production.\n' +
      'Uses energy-types PowerCurve operations locally.\n' +
      'Example: suntropy studies calculate-results --file study.json'
    )
    .option('--file <path>', 'Study file path')
    .action(async (opts) => {
      try {
        const filePath = resolveFile(opts);
        const study = readStudy(filePath);

        const consumption = study.consumption as { days?: unknown[]; identifier?: string } | undefined;
        if (!consumption?.days?.length) {
          outputError(new Error('No consumption curve. Use: studies set consumption'));
          return;
        }

        // Get total production from all surfaces
        const surfaces = study.surfaces as Record<string, unknown>[] | undefined;
        if (!surfaces?.length) {
          outputError(new Error('No surfaces. Use: studies add surface'));
          return;
        }

        const { PowerCurve } = await import('energy-types/lib/energy/classes/powerCurve.class');

        // Build consumption PowerCurve
        const consCurve = new PowerCurve(consumption.days, false, consumption.identifier || 'consumption', false);

        // Aggregate production from all surfaces
        let totalProdCurve: InstanceType<typeof PowerCurve> | null = null;
        for (const surf of surfaces) {
          const prod = surf.production as { days?: unknown[]; identifier?: string } | undefined;
          if (prod?.days?.length) {
            const surfProd = new PowerCurve(prod.days, false, prod.identifier || 'production', false);
            if (!totalProdCurve) {
              totalProdCurve = surfProd;
            } else {
              totalProdCurve = totalProdCurve.aggregatePowerCurve(surfProd);
            }
          }
        }

        if (!totalProdCurve) {
          outputError(new Error('No production curves found. Use: studies calculate production'));
          return;
        }

        // Net consumption = consumption - production (negative values = excesses)
        const prodNeg = totalProdCurve.applyMultiplier(-1);
        const netRaw = consCurve.aggregatePowerCurve(prodNeg);

        // Excesses = positive part of (production - consumption)
        const consNeg = consCurve.applyMultiplier(-1);
        const excessesRaw = totalProdCurve.aggregatePowerCurve(consNeg);
        const excessesCurve = excessesRaw.filterPositiveValues();

        // Net consumption = positive part of (consumption - production)
        const netConsumption = netRaw.filterPositiveValues();

        const totalProduction = totalProdCurve.getTotalAcumulate();
        const totalConsumption = consCurve.getTotalAcumulate();
        const totalExcesses = excessesCurve.getTotalAcumulate();
        const totalConsumptionCoverage = totalConsumption > 0 ? totalProduction / totalConsumption : 0;

        // Calculate savings by period if possible
        const energyPrices = study.energyPrices as ByPeriodValues | undefined;
        let totalSavings: number | undefined;
        if (energyPrices?.p1) {
          // Simple savings estimate: self-consumed energy * average price
          const selfConsumed = totalProduction - totalExcesses;
          const avgPrice = Object.values(energyPrices)
            .filter((v): v is number => typeof v === 'number')
            .reduce((a, b) => a + b, 0) / Object.values(energyPrices).filter((v) => typeof v === 'number').length;
          totalSavings = selfConsumed * avgPrice;
        }

        const results: Record<string, unknown> = {
          totalProduction,
          totalConsumptionCoverage,
          totalExcesses,
          netConsumption: { days: netConsumption.days, identifier: 'netConsumption' },
          excessesCurve: { days: excessesCurve.days, identifier: 'excesses' },
        };
        if (totalSavings !== undefined) results.totalSavings = totalSavings;

        const result = updateStudy(filePath, (s) => {
          s.results = results;
          return undefined;
        });
        output(result, getGlobalOpts(studies));
      } catch (err) {
        outputError(err instanceof Error ? err : new Error(String(err)));
      }
    });
}

// ─── Helpers ───

/** Generate consumption curve from REE profile + period/monthly data using energy-types */
async function generateFromProfile(
  global: OutputOptions & Record<string, unknown>,
  tariff: string,
  market: string,
  year: number,
  mode: 'CONSUMPTION_BY_PERIOD' | 'MONTH_CONSUMPTION' | 'MONTHLY_BY_PERIOD',
  data: unknown,
): Promise<unknown> {
  const profilesClient = createServiceClient('profiles', global);
  const periodsClient = createServiceClient('periods', global);

  // 1. Fetch REE profile
  const profileRes = await profilesClient.get('/ree-profiles', {
    params: {
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      tariff,
      type: 'Final',
      market,
    },
  });
  const profile = profileRes.data?.profile || profileRes.data;
  if (!profile || !Array.isArray(profile) || profile.length === 0) {
    throw new Error('Failed to fetch REE profiles');
  }

  // 2. Import energy-types
  const { applyProfileToConsumption, ConsumptionIntroductionModes } =
    await import('energy-types/lib/energy/calculations/applyProfileToConsumption');

  if (mode === 'CONSUMPTION_BY_PERIOD') {
    // Need period distribution
    const tariffIdMap: Record<string, number> = { '2.0TD': 13, '3.0TD': 14, '6.1TD': 15 };
    const tariffId = tariffIdMap[tariff] || 14;
    const periodsRes = await periodsClient.get('/periodos', {
      params: {
        idTarifa: tariffId,
        idZona: 1,
        fechaInicio: `${year}-01-01`,
        fechaFin: `${year}-12-31`,
        market,
      },
    });
    const periodDistribution = periodsRes.data;

    const result = applyProfileToConsumption(
      ConsumptionIntroductionModes.CONSUMPTION_BY_PERIOD,
      profile,
      data,
      periodDistribution,
    );
    return result;

  } else if (mode === 'MONTH_CONSUMPTION') {
    // Transform flat {month: value} into {year: {month: value}} expected by energy-types
    const flatData = data as Record<string, number>;
    const yearMonthData: Record<number, Record<number, number>> = { [year]: {} };
    for (const [month, value] of Object.entries(flatData)) {
      yearMonthData[year][parseInt(month)] = value;
    }
    const result = applyProfileToConsumption(
      ConsumptionIntroductionModes.MONTH_CONSUMPTION,
      profile,
      yearMonthData,
    );
    return result;

  } else if (mode === 'MONTHLY_BY_PERIOD') {
    // For monthly by period, we need to process month by month
    // This is more complex — for now, use the MONTH_CONSUMPTION as fallback
    // with aggregated monthly totals
    const monthlyData = data as Record<string, Record<string, number>>;
    const monthTotals: Record<string, number> = {};
    for (const [month, periods] of Object.entries(monthlyData)) {
      monthTotals[month] = Object.values(periods).reduce((a, b) => a + b, 0);
    }
    const result = applyProfileToConsumption(
      ConsumptionIntroductionModes.MONTH_CONSUMPTION,
      profile,
      monthTotals,
    );
    return result;
  }

  throw new Error(`Unknown consumption mode: ${mode}`);
}

/** Collector for repeatable --asset <id:qty> */
function collectAssets(value: string, previous: { id: number; quantity: number }[]): { id: number; quantity: number }[] {
  const [idStr, qtyStr] = value.split(':');
  const id = parseInt(idStr);
  const quantity = qtyStr ? parseInt(qtyStr) : 1;
  if (isNaN(id)) throw new Error(`Invalid asset format: "${value}". Use <id>:<quantity>`);
  return [...previous, { id, quantity }];
}
