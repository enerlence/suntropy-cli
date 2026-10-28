/**
 * The parity matrix: every CLI command, run once with a JWT (v1) and once
 * with a `sun_` key (v2). Each path creates its own data, named
 * `parity-<run>-v1` / `parity-<run>-v2`, and the cases run in order:
 * create → read → update → delete. What is left is deleted at the end.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface PathCtx {
  api: 'v1' | 'v2';
  run: string;
  /** Name of what this path creates: `parity-<run>-<api>`. */
  name: string;
  /** Name both paths share (e.g. the client of their studies). */
  shared: string;
  /** Ids this path created or read, by name (`panel`, `kit`, `study`…). */
  ids: Record<string, string>;
  /** Scratch folder of this path (study files). */
  dir: string;
  env: {
    notifyUser?: string;
    customProfileId?: string;
    eredesZip?: string;
    region: string;
    subRegion: string;
  };
}

export type Compare =
  /** One entity: ids this run created, dates and authorship normalised. */
  | 'entity'
  /** A listing both paths see the same way (same tenant): only authorship is dropped. */
  | 'raw'
  /** Keys and types only (§1.8.6 production numbers). */
  | 'shape'
  /** Only the exit code (both fail, or the output depends on the run). */
  | 'exit'
  /** `{ url }` with an https URL in both (credits checkout). */
  | 'url';

export interface ParityCase {
  id: string;
  /** The command line for a path; `undefined` skips the case (missing data or env). */
  args: (c: PathCtx) => string[] | undefined;
  compare?: Compare;
  /** Expected exit code of both runs (default 0). */
  exit?: number;
  /** Reads ids from the output of each path. */
  capture?: (out: any, c: PathCtx) => void;
  /** Registers a delete to run at the end if no case removed it. */
  cleanup?: { key: string; args: (c: PathCtx) => string[] | undefined };
  /** Cleanup key this case takes care of when it succeeds. */
  removes?: string;
  /** Extra keys to ignore in the comparison. */
  ignore?: string[];
  /** A v1 bug the contract documents: v1 failing and v2 working is reported as V1_BUG, not FAIL. */
  knownV1Bug?: string;
  /** Runs before the command on each path (local files). */
  before?: (c: PathCtx) => void;
  /** Why the case is not run (destructive on tenant settings, etc.). */
  skip?: string;
}

const j = (v: unknown) => JSON.stringify(v);
const need = (c: PathCtx, ...keys: string[]) => keys.every((k) => c.ids[k] !== undefined);
const studyFile = (c: PathCtx) => join(c.dir, 'study.json');

/** Inventory resources driven by the factory (list/get/create/update/delete/delete-batch/filter). */
interface Res {
  name: string;
  key: string;
  idField: string;
  batch: boolean;
  body: (c: PathCtx, n: string) => Record<string, unknown> | undefined;
  filter: (c: PathCtx) => Record<string, unknown>;
  knownV1Bug?: Partial<Record<'list' | 'filter' | 'get', string>>;
}

const mfr = (c: PathCtx) => ({ idManufacturer: Number(c.ids.manufacturer) });

const RES: Res[] = [
  {
    name: 'panels', key: 'panel', idField: 'solarPanelId', batch: true,
    body: (c, n) => (need(c, 'manufacturer') ? { name: n, manufacturer: mfr(c), peakPower: 450, efficiency: 21.5, width: 1134, heigth: 1722, costPerUnit: 100, active: true } : undefined),
    filter: (c) => ({ name: c.name }),
  },
  {
    name: 'inverters', key: 'inverter', idField: 'idInverter', batch: true,
    body: (c, n) => (need(c, 'manufacturer') ? { name: n, manufacturer: mfr(c), nominalPower: 5000, efficiency: 97.5, phaseNumber: 'single_phase', costPerUnit: 900, active: true } : undefined),
    filter: (c) => ({ name: c.name }),
  },
  {
    name: 'batteries', key: 'battery', idField: 'batteryId', batch: true,
    body: (c, n) => (need(c, 'manufacturer') ? { name: n, manufacturer: mfr(c), capacity: 5, costPerUnit: 3000, active: true } : undefined),
    filter: (c) => ({ name: c.name }),
  },
  {
    name: 'chargers', key: 'charger', idField: 'idCharger', batch: true,
    body: (c, n) => (need(c, 'manufacturer') ? { name: n, manufacturer: mfr(c), maxPower: 7.4, phaseNumber: 'single_phase', costPerUnit: 700, active: true } : undefined),
    filter: (c) => ({ name: c.name }),
  },
  {
    name: 'heatpumps', key: 'heatpump', idField: 'idHeatpump', batch: true,
    body: (c, n) => (need(c, 'manufacturer') ? { identifier: n, manufacturer: mfr(c), lowerPower: 2, upperPower: 9, costPerUnit: 5000, active: true } : undefined),
    filter: (c) => ({ identifier: c.name }),
  },
  {
    name: 'custom-asset-types', key: 'assetType', idField: 'idCustomAssetType', batch: false,
    body: (_c, n) => ({ label: n }),
    filter: (c) => ({ label: c.name }),
    knownV1Bug: { filter: '§0.1: POST /custom-asset/type/filter does not exist in v1 (404)' },
  },
  {
    name: 'custom-assets', key: 'asset', idField: 'idCustomAsset', batch: false,
    body: (c, n) => (need(c, 'assetType') ? { label: n, identifier: n, costPerUnit: 10, isMaterial: true, active: true, customAssetType: { idCustomAssetType: Number(c.ids.assetType) } } : undefined),
    filter: (c) => ({ label: c.name }),
    knownV1Bug: { filter: '§0.1: POST /custom-asset/filter does not exist in v1 (404)' },
  },
  {
    name: 'charger-kits', key: 'chargerKit', idField: 'idVEChargerKit', batch: true,
    body: (c, n) => (need(c, 'charger') ? { identifier: n, charger: { idCharger: Number(c.ids.charger) }, price: 900, phaseNumber: 'single_phase', active: true } : undefined),
    filter: (c) => ({ identifier: c.name }),
  },
  {
    name: 'heatpump-kits', key: 'heatpumpKit', idField: 'idHeatpumpKit', batch: true,
    body: (c, n) => (need(c, 'heatpump') ? { identifier: n, heatpump: { idHeatpump: Number(c.ids.heatpump) }, price: 6000, phaseNumber: 'single_phase', active: true } : undefined),
    filter: (c) => ({ identifier: c.name }),
    knownV1Bug: { list: '§0.1: GET /heat-pump/heatpump-kits is shadowed by @Get(":id") and asks for missing relations' },
  },
];

function createCases(): ParityCase[] {
  const out: ParityCase[] = [
    {
      id: 'inventory manufacturers create',
      args: (c) => ['inventory', 'manufacturers', 'create', '--data', j({ name: c.name })],
      compare: 'entity',
      capture: (o, c) => (c.ids.manufacturer = String(o.idManufacturer)),
    },
  ];
  for (const r of RES) {
    for (const [suffix, key] of r.batch ? [['', r.key], ['-2', `${r.key}2`]] : [['', r.key]]) {
      out.push({
        id: `inventory ${r.name} create${suffix}`,
        args: (c) => {
          const body = r.body(c, `${c.name}${suffix}`);
          return body && ['inventory', r.name, 'create', '--data', j(body)];
        },
        compare: 'entity',
        capture: (o, c) => (c.ids[key] = String(o[r.idField])),
        cleanup: { key: `${r.name}:${key}`, args: (c) => (c.ids[key] ? ['inventory', r.name, 'delete', c.ids[key]] : undefined) },
      });
    }
  }
  out.push(
    {
      id: 'inventory custom-fields create',
      args: (c) => need(c, 'assetType') && ['inventory', 'custom-fields', 'create', '--data', j({ label: c.name, type: 'number', customAssetTypeId: Number(c.ids.assetType) })] || undefined,
      compare: 'entity',
      capture: (o, c) => (c.ids.customField = String(o.idCustomField)),
      cleanup: { key: 'custom-fields', args: (c) => (c.ids.customField ? ['inventory', 'custom-fields', 'delete', c.ids.customField] : undefined) },
    },
    ...(['panels', 'inverters', 'batteries'] as const).map((name): ParityCase => {
      const key = { panels: 'kitPanel', inverters: 'kitInverter', batteries: 'kitBattery' }[name];
      const idField = { panels: 'idKitSolarPanel', inverters: 'idKitInverter', batteries: 'idKitBattery' }[name];
      const body = {
        panels: { peakPower: 450, efficiency: 21, width: 1134, heigth: 1722, costPerUnit: 100 },
        inverters: { nominalPower: 5000, efficiency: 97, phaseNumber: 'single_phase', costPerUnit: 800 },
        batteries: { capacity: 5, costPerUnit: 2500 },
      }[name];
      return {
        id: `inventory kits ${name} create`,
        args: (c) => need(c, 'manufacturer') && ['inventory', 'kits', name, 'create', '--data', j({ name: c.name, manufacturer: mfr(c), ...body })] || undefined,
        compare: 'entity',
        capture: (o, c) => (c.ids[key] = String(o[idField])),
        cleanup: { key: `kit-${name}`, args: (c) => (c.ids[key] ? ['inventory', 'kits', name, 'delete', c.ids[key]] : undefined) },
      };
    }),
    {
      id: 'inventory kits assemble',
      args: (c) =>
        need(c, 'kitPanel', 'kitInverter', 'battery', 'asset') && [
          'inventory', 'kits', 'assemble', '--name', c.name, '--panel', c.ids.kitPanel, '--inverter', c.ids.kitInverter,
          '--battery', c.ids.battery, '--batteries-count', '1', '--peak-power', '5.4', '--price', '6500', '--custom-asset', `${c.ids.asset}:2`,
        ] || undefined,
      compare: 'entity',
      capture: (o, c) => (c.ids.kit = String(o.idSolarKit)),
      cleanup: { key: 'kits:kit', args: (c) => (c.ids.kit ? ['inventory', 'kits', 'delete', c.ids.kit] : undefined) },
    },
    {
      id: 'inventory kits assemble (second kit, for delete-batch)',
      args: (c) =>
        need(c, 'kitPanel', 'kitInverter') && ['inventory', 'kits', 'assemble', '--name', `${c.name}-2`, '--panel', c.ids.kitPanel, '--inverter', c.ids.kitInverter, '--price', '6000'] || undefined,
      compare: 'entity',
      capture: (o, c) => (c.ids.kit2 = String(o.idSolarKit)),
      cleanup: { key: 'kits:kit2', args: (c) => (c.ids.kit2 ? ['inventory', 'kits', 'delete', c.ids.kit2] : undefined) },
    },
    {
      id: 'projects create',
      args: (c) => ['projects', 'create', '--name', c.name, '--description', 'parity', '--visibility', 'client'],
      compare: 'entity',
      capture: (o, c) => (c.ids.project = String(o.id)),
      cleanup: { key: 'project', args: (c) => (c.ids.project ? ['projects', 'delete', c.ids.project] : undefined) },
    },
    {
      id: 'projects files add',
      args: (c) => need(c, 'project') && ['projects', 'files', 'add', c.ids.project, '--name', 'parity.pdf', '--url', `https://documents.enerlence.com/parity/${c.name}.pdf`, '--size', '10', '--mime', 'application/pdf'] || undefined,
      compare: 'entity',
      capture: (o, c) => (c.ids.projectFile = String(o.id)),
    },
    // A study per path, built locally and saved (studies have no delete command: they stay, named parity-<run>).
    { id: 'studies init (local)', args: (c) => ['studies', 'init', '--file', studyFile(c), '--name', c.shared], compare: 'exit' },
    { id: 'studies set client (local)', args: (c) => ['studies', 'set', 'client', '--file', studyFile(c), '--name', c.shared], compare: 'exit' },
    { id: 'studies set market (local)', args: (c) => ['studies', 'set', 'market', '--file', studyFile(c), '--market', 'es'], compare: 'exit' },
    { id: 'studies set tariff', args: (c) => ['studies', 'set', 'tariff', '--file', studyFile(c), '--tariff-id', '13', '--zone-id', '1'], compare: 'raw', ignore: ['file'] },
    { id: 'studies set prices (local)', args: (c) => ['studies', 'set', 'prices', '--file', studyFile(c), '--energy', j({ p1: 0.15, p2: 0.1, p3: 0.07 })], compare: 'exit' },
    { id: 'studies set consumption --annual --pattern', args: (c) => ['studies', 'set', 'consumption', '--file', studyFile(c), '--annual', '4000', '--pattern', 'Balance', '--tariff', '2.0TD'], compare: 'raw', ignore: ['file'] },
    { id: 'studies set consumption --monthly (REE profiles)', args: (c) => ['studies', 'set', 'consumption', '--file', studyFile(c), '--monthly', j(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 330]))), '--tariff', '2.0TD'], compare: 'raw', ignore: ['file'] },
    { id: 'studies add surface (local)', args: (c) => ['studies', 'add', 'surface', '--file', studyFile(c), '--lat', '37.39', '--lon', '-5.99', '--power', '5000'], compare: 'exit' },
    { id: 'studies set panel', args: (c) => need(c, 'panel') && ['studies', 'set', 'panel', '--file', studyFile(c), '--panel-id', c.ids.panel, '--panels-count', '12'] || undefined, compare: 'raw', ignore: ['file'] },
    { id: 'studies set inverter', args: (c) => need(c, 'inverter') && ['studies', 'set', 'inverter', '--file', studyFile(c), '--inverter-id', c.ids.inverter] || undefined, compare: 'raw', ignore: ['file'] },
    { id: 'studies set custom-assets', args: (c) => need(c, 'asset') && ['studies', 'set', 'custom-assets', '--file', studyFile(c), '--asset', `${c.ids.asset}:2`] || undefined, compare: 'raw', ignore: ['file'] },
    { id: 'studies calculate production', args: (c) => ['studies', 'calculate', 'production', '--file', studyFile(c), '--all-surfaces'], compare: 'raw', ignore: ['file'] },
    { id: 'studies calculate-results', args: (c) => ['studies', 'calculate-results', '--file', studyFile(c)], compare: 'shape' },
    { id: 'studies optimize-peakpower --use-kits', args: (c) => ['studies', 'optimize-peakpower', '--file', studyFile(c), '--use-kits'], compare: 'shape' },
    { id: 'studies set kit', args: (c) => need(c, 'kit') && ['studies', 'set', 'kit', '--file', studyFile(c), '--kit-id', c.ids.kit] || undefined, compare: 'raw', ignore: ['file'] },
    {
      id: 'studies save (create)',
      args: (c) => ['studies', 'save', '--file', studyFile(c)],
      compare: 'entity',
      ignore: ['file', 'idSolarStudyMetadata', 'solarStudyId'],
      capture: (o, c) => {
        c.ids.study = String(o.metadata?.solarStudyId);
        c.ids.studyMetadata = String(o.metadata?.idSolarStudyMetadata);
      },
    },
  );
  return out;
}

function readCases(): ParityCase[] {
  const out: ParityCase[] = [];
  for (const r of RES) {
    out.push(
      { id: `inventory ${r.name} list`, args: () => ['inventory', r.name, 'list', '--limit', '5'], compare: 'raw', knownV1Bug: r.knownV1Bug?.list },
      { id: `inventory ${r.name} list --active-only --limit 120`, args: () => ['inventory', r.name, 'list', '--active-only', '--limit', '120'], compare: 'raw', knownV1Bug: r.knownV1Bug?.list },
      { id: `inventory ${r.name} get`, args: (c) => need(c, r.key) && ['inventory', r.name, 'get', c.ids[r.key]] || undefined, compare: 'entity' },
      { id: `inventory ${r.name} filter`, args: (c) => ['inventory', r.name, 'filter', '--query', j(r.filter(c))], compare: 'entity', knownV1Bug: r.knownV1Bug?.filter },
    );
  }
  out.push(
    { id: 'inventory manufacturers list', args: () => ['inventory', 'manufacturers', 'list'], compare: 'raw' },
    { id: 'inventory custom-fields list', args: () => ['inventory', 'custom-fields', 'list'], compare: 'raw' },
    { id: 'inventory custom-fields get', args: (c) => need(c, 'customField') && ['inventory', 'custom-fields', 'get', c.ids.customField] || undefined, compare: 'entity' },
    { id: 'inventory kits list', args: () => ['inventory', 'kits', 'list', '--limit', '5'], compare: 'raw' },
    { id: 'inventory kits get', args: (c) => need(c, 'kit') && ['inventory', 'kits', 'get', c.ids.kit] || undefined, compare: 'entity' },
    { id: 'inventory kits filter', args: (c) => ['inventory', 'kits', 'filter', '--query', j({ identifier: c.name })], compare: 'entity' },
    { id: 'inventory kits panels list', args: () => ['inventory', 'kits', 'panels', 'list'], compare: 'raw' },
    { id: 'inventory kits panels get', args: (c) => need(c, 'kitPanel') && ['inventory', 'kits', 'panels', 'get', c.ids.kitPanel] || undefined, compare: 'entity' },
    { id: 'inventory kits panels featured', args: (c) => need(c, 'kitPanel') && ['inventory', 'kits', 'panels', 'featured', c.ids.kitPanel] || undefined, compare: 'entity' },
    { id: 'inventory kits inverters list', args: () => ['inventory', 'kits', 'inverters', 'list'], compare: 'raw' },
    { id: 'inventory kits inverters featured', args: (c) => need(c, 'kitInverter') && ['inventory', 'kits', 'inverters', 'featured', c.ids.kitInverter] || undefined, compare: 'entity' },
    { id: 'inventory kits batteries list', args: () => ['inventory', 'kits', 'batteries', 'list'], compare: 'raw' },

    { id: 'studies list --client-name', args: (c) => ['studies', 'list', '--client-name', c.shared], compare: 'raw' },
    { id: 'studies list --limit 3 --offset 1', args: () => ['studies', 'list', '--limit', '3', '--offset', '1'], compare: 'raw' },
    { id: 'studies list --from --to', args: () => ['studies', 'list', '--from', `${new Date().getFullYear()}-01-01`, '--to', new Date().toISOString().slice(0, 10)], compare: 'raw' },
    {
      id: 'studies list --state (first state of the account)',
      args: () => ['studies', 'list', '--state', process.env.PARITY_STUDY_STATE ?? 'Pendiente'],
      compare: 'raw',
    },
    { id: 'studies metadata', args: (c) => need(c, 'studyMetadata') && ['studies', 'metadata', c.ids.studyMetadata] || undefined, compare: 'entity' },
    { id: 'studies metadata --by-study-id', args: (c) => need(c, 'study') && ['studies', 'metadata', c.ids.study, '--by-study-id'] || undefined, compare: 'entity' },
    { id: 'studies get', args: (c) => need(c, 'study') && ['studies', 'get', c.ids.study] || undefined, compare: 'entity' },
    { id: 'studies get --expand all', args: (c) => need(c, 'study') && ['studies', 'get', c.ids.study, '--expand', 'all'] || undefined, compare: 'entity' },
    { id: 'studies curves consumption --total', args: (c) => need(c, 'study') && ['studies', 'curves', c.ids.study, 'consumption', '--total'] || undefined, compare: 'entity' },
    { id: 'studies pull', args: (c) => need(c, 'study') && ['studies', 'pull', c.ids.study, '--file', join(c.dir, 'pulled.json')] || undefined, compare: 'entity', ignore: ['file'] },
    { id: 'studies comment', args: (c) => need(c, 'study') && ['studies', 'comment', c.ids.study, '--content', `parity ${c.shared}`] || undefined, compare: 'entity', ignore: ['studyId', 'message'] },
    { id: 'studies comment --as-alexandria', args: (c) => need(c, 'study') && ['studies', 'comment', c.ids.study, '--content', 'parity', '--as-alexandria'] || undefined, compare: 'entity', ignore: ['studyId', 'message'] },
    { id: 'studies calculate-production', args: () => ['studies', 'calculate-production', '--lat', '37.39', '--lon', '-5.99', '--power', '5000', '--year', '2025'], compare: 'shape' },
    { id: 'studies optimize-surfaces', args: () => ['studies', 'optimize-surfaces', '--lat', '37.39', '--lon', '-5.99'], compare: 'raw' },
    {
      id: 'studies save (update, with _id)',
      args: (c) => need(c, 'study') && ['studies', 'save', '--file', studyFile(c)] || undefined,
      compare: 'entity',
      ignore: ['file', 'idSolarStudyMetadata', 'solarStudyId'],
    },
    {
      id: 'shareables create',
      args: (c) => need(c, 'study') && ['shareables', 'create', '--element-id', c.ids.study, '--name', c.name, '--link-params', 'utm_source=parity'] || undefined,
      compare: 'entity',
      ignore: ['uid', 'url', 'idShareable', 'elementId', 'expirationDate', 'activationDate'],
    },

    {
      id: 'ppa templates list',
      args: () => ['ppa', 'templates', 'list'],
      compare: 'raw',
      capture: (o, c) => {
        if (Array.isArray(o) && o[0]?._id) c.ids.ppaTemplate = o[0]._id;
      },
    },
    { id: 'ppa templates get', args: (c) => need(c, 'ppaTemplate') && ['ppa', 'templates', 'get', c.ids.ppaTemplate] || undefined, compare: 'raw' },
    { id: 'ppa calculate --study', args: (c) => need(c, 'study') && ['ppa', 'calculate', '--study', c.ids.study] || undefined, compare: 'entity' },

    { id: 'consumption estimate', args: () => ['consumption', 'estimate', '--annual', '5000', '--pattern', 'Domestic', '--tariff', '2.0TD', '--start-date', '2025-01-01', '--end-date', '2025-12-31'], compare: 'raw' },
    { id: 'consumption estimate --monthly-data', args: () => ['consumption', 'estimate', '--annual', '3600', '--monthly-data', j(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 300]))), '--start-date', '2025-01-01', '--end-date', '2025-12-31'], compare: 'raw' },
    { id: 'consumption ree-profiles', args: () => ['consumption', 'ree-profiles', '--start', '2025-01-01', '--end', '2025-01-31', '--tariff', '2.0TD'], compare: 'raw' },
    { id: 'consumption periods', args: () => ['consumption', 'periods', '--tariff-id', '13', '--zone-id', '1', '--start', '2025-01-01', '--end', '2025-01-31'], compare: 'raw' },
    { id: 'consumption periods --market pt', args: () => ['consumption', 'periods', '--tariff-id', '13', '--zone-id', '1', '--start', '2025-01-01', '--end', '2025-01-31', '--market', 'pt'], compare: 'raw' },
    { id: 'consumption custom-tags', args: () => ['consumption', 'custom-tags'], compare: 'raw' },
    { id: 'consumption custom-profile-info', args: (c) => c.env.customProfileId && ['consumption', 'custom-profile-info', '--id', c.env.customProfileId] || undefined, compare: 'raw' },
    { id: 'consumption from-file --eredes-zip', args: (c) => c.env.eredesZip && ['consumption', 'from-file', '--eredes-zip', c.env.eredesZip] || undefined, compare: 'raw' },

    { id: 'notifications send', args: (c) => c.env.notifyUser && ['notifications', 'send', '--to-user', c.env.notifyUser, '--title', 'Parity', '--message', `parity ${c.shared}`, '--as-alexandria'] || undefined, compare: 'entity', ignore: ['notificationId'] },

    {
      id: 'config theme get',
      args: () => ['config', 'theme', 'get'],
      compare: 'raw',
      capture: (o, c) => {
        if (o && typeof o.primary === 'string') c.ids.themePrimary = o.primary;
      },
    },
    { id: 'config solarform get', args: () => ['config', 'solarform', 'get'], compare: 'raw', capture: (o, c) => {
      if (o?.idSolarFormConfig) {
        c.ids.solarFormConfig = String(o.idSolarFormConfig);
        c.ids.solarFormTitle = o.formTitle ?? '';
      }
    } },
    { id: 'config solarform get --with-parameters', args: () => ['config', 'solarform', 'get', '--with-parameters'], compare: 'raw' },
    { id: 'config solarform advanced get', args: () => ['config', 'solarform', 'advanced', 'get'], compare: 'raw', capture: (o, c) => {
      if (o && typeof o === 'object') c.ids.advancedCoverTitle = o.coverTitle ?? '';
    } },
    ...['general', 'cover', 'surfaces', 'consumer', 'inclination', 'orientation', 'panels', 'consumption', 'results', 'custom-fields'].map(
      (s): ParityCase => ({ id: `config solarform advanced ${s} get`, args: () => ['config', 'solarform', 'advanced', s, 'get'], compare: 'raw' }),
    ),
    { id: 'solarform config (public view)', args: () => ['solarform', 'config'], compare: 'raw', knownV1Bug: 'C10: the v1 route resolves the form by Origin, which the CLI does not send' },
    { id: 'solarform simple', args: (c) => ['solarform', 'simple', '--region', c.env.region, '--sub-region', c.env.subRegion, '--consumption', '400'], compare: 'entity', ignore: ['id', '_id'] },
    {
      id: 'solarform calculate',
      args: () => ['solarform', 'calculate', '--data', j({ center: { lat: 37.39, lng: -5.99 }, consumptionMode: 'consumptionPatterns', locationMode: 'locationOnly', selectedConsumptionPattern: 'Balance', consumptionQuantity: 400, consumptionQuantityIntroductionMode: 'monthlyConsumption' })],
      compare: 'entity',
      ignore: ['id', '_id'],
    },

    { id: 'projects list', args: () => ['projects', 'list'], compare: 'raw', knownV1Bug: undefined },
    { id: 'projects get', args: (c) => need(c, 'project') && ['projects', 'get', c.ids.project] || undefined, compare: 'entity' },
    { id: 'projects files list', args: (c) => need(c, 'project') && ['projects', 'files', 'list', c.ids.project] || undefined, compare: 'entity' },

    { id: 'templates list', args: () => ['templates', 'list'], compare: 'raw' },
    { id: 'templates list --type generic', args: () => ['templates', 'list', '--type', 'generic'], compare: 'raw' },
    { id: 'geocode resolve', args: () => ['geocode', 'resolve', '--address', 'Avenida de la Constitución 1, Sevilla', '--country', 'es'], compare: 'raw' },
    { id: 'geocode reverse', args: () => ['geocode', 'reverse', '--lat', '37.3861', '--lng', '-5.9926'], compare: 'raw' },

    // LeadGen and credits (already v1/v2 since #47): read-only, no real purchase.
    { id: 'satvolt credits balance', args: () => ['satvolt', 'credits', 'balance'], compare: 'raw' },
    {
      id: 'satvolt credits packs',
      args: () => ['satvolt', 'credits', 'packs'],
      compare: 'raw',
      capture: (o, c) => {
        const packs = Array.isArray(o) ? o : o?.packs ?? o?.data;
        if (Array.isArray(packs) && packs[0]?.id) c.ids.creditPack = packs[0].id;
      },
    },
    { id: 'satvolt credits checkout (URL only, nothing is paid)', args: (c) => need(c, 'creditPack') && ['satvolt', 'credits', 'checkout', c.ids.creditPack] || undefined, compare: 'url' },
    { id: 'satvolt usage', args: () => ['satvolt', 'usage'], compare: 'raw' },
    { id: 'satvolt campaigns list', args: () => ['satvolt', 'campaigns', 'list'], compare: 'raw' },
    { id: 'satvolt templates list', args: () => ['satvolt', 'templates', 'list'], compare: 'raw' },
  );
  return out;
}

function updateCases(): ParityCase[] {
  const out: ParityCase[] = RES.map((r) => ({
    id: `inventory ${r.name} update`,
    args: (c: PathCtx) => need(c, r.key) && ['inventory', r.name, 'update', c.ids[r.key], '--data', j({ costPerUnit: 42 })] || undefined,
    compare: 'entity' as const,
  }));
  out.push(
    { id: 'inventory custom-fields update', args: (c) => need(c, 'customField') && ['inventory', 'custom-fields', 'update', c.ids.customField, '--data', j({ label: `${c.name}-x` })] || undefined, compare: 'entity' },
    { id: 'inventory kits update', args: (c) => need(c, 'kit') && ['inventory', 'kits', 'update', c.ids.kit, '--data', j({ price: 6600 })] || undefined, compare: 'entity' },
    { id: 'inventory kits panels update', args: (c) => need(c, 'kitPanel') && ['inventory', 'kits', 'panels', 'update', c.ids.kitPanel, '--data', j({ costPerUnit: 99 })] || undefined, compare: 'entity' },
    { id: 'inventory kits inverters update', args: (c) => need(c, 'kitInverter') && ['inventory', 'kits', 'inverters', 'update', c.ids.kitInverter, '--data', j({ costPerUnit: 799 })] || undefined, compare: 'entity' },
    { id: 'inventory kits archive', args: (c) => need(c, 'kit2') && ['inventory', 'kits', 'archive', c.ids.kit2] || undefined, compare: 'entity' },
    { id: 'projects update', args: (c) => need(c, 'project') && ['projects', 'update', c.ids.project, '--description', 'parity updated'] || undefined, compare: 'entity' },
    // Tenant singletons: written with the value they already have, so nothing changes.
    { id: 'config theme set (same value)', args: (c) => need(c, 'themePrimary') && ['config', 'theme', 'set', '--primary', c.ids.themePrimary] || undefined, compare: 'raw' },
    { id: 'config solarform update (same title)', args: (c) => need(c, 'solarFormConfig') && ['config', 'solarform', 'update', c.ids.solarFormConfig, '--form-title', c.ids.solarFormTitle] || undefined, compare: 'raw', ignore: ['lastEditTimestamp'] },
    { id: 'config solarform advanced update (same cover title)', args: (c) => need(c, 'advancedCoverTitle') && ['config', 'solarform', 'advanced', 'update', '--set', `coverTitle=${c.ids.advancedCoverTitle}`] || undefined, compare: 'raw', ignore: ['lastEditTimestamp'] },
    { id: 'config solarform advanced cover set (same cover title)', args: (c) => need(c, 'advancedCoverTitle') && ['config', 'solarform', 'advanced', 'cover', 'set', '--set', `coverTitle=${c.ids.advancedCoverTitle}`] || undefined, compare: 'raw' },
    { id: 'config solarform create', args: () => undefined, skip: 'singleton of the tenant: the second path would get 409 CONFLICT' },
    { id: 'config solarform advanced delete', args: () => undefined, skip: 'deletes the tenant advanced configuration' },
    { id: 'config theme edit / config solarform edit / advanced <section> edit', args: () => undefined, skip: 'opens $EDITOR' },
    { id: 'config solarform advanced init-default', args: () => undefined, skip: '§4: v1 only (V2_KEY_NOT_SUPPORTED)' },
    { id: 'solarform statistics --create/--update', args: () => undefined, skip: '§4: v1 only (V2_KEY_NOT_SUPPORTED)' },
  );
  return out;
}

function deleteCases(): ParityCase[] {
  const out: ParityCase[] = [
    { id: 'projects files remove', args: (c) => need(c, 'project', 'projectFile') && ['projects', 'files', 'remove', c.ids.project, c.ids.projectFile] || undefined, compare: 'entity' },
    { id: 'projects delete', args: (c) => need(c, 'project') && ['projects', 'delete', c.ids.project] || undefined, compare: 'entity', removes: 'project' },
    { id: 'projects get after delete', args: (c) => need(c, 'project') && ['projects', 'get', c.ids.project] || undefined, compare: 'exit', exit: 1 },
    { id: 'inventory kits delete-batch', args: (c) => need(c, 'kit2') && ['inventory', 'kits', 'delete-batch', '--ids', c.ids.kit2] || undefined, compare: 'raw', removes: 'kits:kit2' },
    { id: 'inventory kits delete', args: (c) => need(c, 'kit') && ['inventory', 'kits', 'delete', c.ids.kit] || undefined, compare: 'entity', removes: 'kits:kit' },
    { id: 'inventory kits get after delete', args: (c) => need(c, 'kit') && ['inventory', 'kits', 'get', c.ids.kit] || undefined, compare: 'exit', exit: 1 },
  ];
  for (const name of ['panels', 'inverters', 'batteries']) {
    const key = { panels: 'kitPanel', inverters: 'kitInverter', batteries: 'kitBattery' }[name]!;
    out.push({ id: `inventory kits ${name} delete`, args: (c) => need(c, key) && ['inventory', 'kits', name, 'delete', c.ids[key]] || undefined, compare: 'entity', removes: `kit-${name}` });
  }
  out.push({ id: 'inventory custom-fields delete', args: (c) => need(c, 'customField') && ['inventory', 'custom-fields', 'delete', c.ids.customField] || undefined, compare: 'entity', removes: 'custom-fields' });
  // Kits of devices first, then the devices they reference; assets before their types.
  const order = ['charger-kits', 'heatpump-kits', 'custom-assets', 'custom-asset-types', 'panels', 'inverters', 'batteries', 'chargers', 'heatpumps'];
  for (const name of order) {
    const r = RES.find((x) => x.name === name)!;
    if (r.batch) {
      out.push({
        id: `inventory ${r.name} delete-batch`,
        args: (c) => need(c, `${r.key}2`) && ['inventory', r.name, 'delete-batch', '--ids', c.ids[`${r.key}2`]] || undefined,
        compare: 'raw',
        removes: `${r.name}:${r.key}2`,
      });
    }
    out.push(
      { id: `inventory ${r.name} delete`, args: (c) => need(c, r.key) && ['inventory', r.name, 'delete', c.ids[r.key]] || undefined, compare: 'entity', removes: `${r.name}:${r.key}` },
      { id: `inventory ${r.name} get after delete`, args: (c) => need(c, r.key) && ['inventory', r.name, 'get', c.ids[r.key]] || undefined, compare: 'exit', exit: 1 },
    );
  }
  return out;
}

export function matrix(): ParityCase[] {
  return [...createCases(), ...readCases(), ...updateCases(), ...deleteCases()];
}

/** Writes a study file for a path (used by `before` hooks if a case needs a clean one). */
export function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}
