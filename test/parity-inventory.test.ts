import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env, fixtures, page, parity, type Case } from './parity-helpers.js';
import { RESOURCES, KITS_RESOURCE } from '../src/commands/inventory/resources.js';
import type { ResourceConfig } from '../src/api/ops/inventory.js';

const INV = fixtures('inventory');
const S = '/solar';
const V2 = '/api/v2/inventory';

/** What v2 answers for an item: heat pumps carry `name` as an alias of `identifier`. */
const asV2 = (cfg: ResourceConfig, item: any) => (cfg.v2.identifierIsName ? { ...item, name: item.identifier } : item);

/** A create/update body in the v1 form, and the body v2 must receive. */
function writeBodies(cfg: ResourceConfig): { v1: any; v2: any } {
  switch (cfg.name) {
    case 'heatpumps':
      return { v1: { identifier: 'HP new', upperPower: 9 }, v2: { name: 'HP new', upperPower: 9 } };
    case 'custom-assets':
      return {
        v1: { label: 'New', customAssetType: { idCustomAssetType: 4 }, customAssetCustomField: [{ customField: { idCustomField: 5 }, value: '3' }] },
        v2: { label: 'New', customAssetTypeId: 4, customFields: [{ customFieldId: 5, value: '3' }] },
      };
    case 'charger-kits':
      return {
        v1: { identifier: 'CK', charger: { idCharger: 1 }, veChargerKitCustomAssets: [{ customAsset: { idCustomAsset: 9 }, units: 2 }] },
        v2: { identifier: 'CK', chargerId: 1, customAssets: [{ customAssetId: 9, units: 2 }] },
      };
    case 'heatpump-kits':
      return {
        v1: { identifier: 'HK', heatpump: { idHeatpump: 1 }, heatpumpKitCustomAssets: [{ customAsset: { idCustomAsset: 9 }, units: 1 }] },
        v2: { identifier: 'HK', heatpumpId: 1, customAssets: [{ customAssetId: 9, units: 1 }] },
      };
    case 'kits':
      return {
        v1: { price: 7000, kitSolarPanel: { idKitSolarPanel: 11 }, kitInverter: { idKitInverter: 21 }, battery: { batteryId: 3 }, kitCategories: [{ idKitCategory: 2 }], solarKitCustomAssets: [{ customAsset: { idCustomAsset: 9 }, units: 4 }] },
        v2: { price: 7000, kitSolarPanelId: 11, kitInverterId: 21, batteryId: 3, kitCategoryIds: [2], customAssets: [{ customAssetId: 9, units: 4 }] },
      };
    default:
      return { v1: { name: 'New', costPerUnit: 1, manufacturer: { idManufacturer: 7 } }, v2: { name: 'New', costPerUnit: 1, manufacturerId: 7 } };
  }
}

function cases(cfg: ResourceConfig): Case[] {
  const all: any[] = INV[cfg.name];
  const first = all[0];
  const base = `${S}${cfg.basePath}`;
  const v2Base = `${V2}/${cfg.v2.resource}`;
  const mode = cfg.v1Active ?? 'unactive';
  const out: Case[] = [];

  // --- list (2 of 3) ---
  const v1List =
    mode === 'split'
      ? (_r: unknown, url: URL) => (url.searchParams.get('unactive') === 'true' ? [all.filter((x) => !x.active), 1] : [all.filter((x) => x.active), 2])
      : cfg.v1WholeList
        ? all
        : [all.slice(0, 2), 3];
  out.push({
    name: `inventory ${cfg.name} list`,
    args: ['inventory', cfg.name, 'list', '--limit', '2', '--offset', '0'],
    v1: { [`GET ${base}`]: v1List },
    v2: { [`GET ${v2Base}`]: page(all.slice(0, 2).map((x) => asV2(cfg, x)), 3, 2, 0) },
    expectV1: [
      {
        method: 'GET',
        path: base,
        query: cfg.v1WholeList
          ? { limit: null, unactive: mode === 'unactive' ? 'true' : null }
          : { [cfg.v1LimitParam ?? 'limit']: mode === 'split' ? '2' : '2', unactive: mode === 'split' ? null : 'true' },
      },
    ],
    expectV2: [{ method: 'GET', path: v2Base, query: { limit: '2', offset: '0', sort: cfg.v2.sort, active: null } }],
    check: (o) => {
      assert.equal(o.total, 3);
      assert.equal(o.data.length, 2);
      assert.equal(o.hasMore, true);
    },
  });

  // --- get ---
  out.push({
    name: `inventory ${cfg.name} get`,
    args: ['inventory', cfg.name, 'get', '1'],
    v1: cfg.getViaFilter ? { [`GET ${base}`]: all } : { [`GET ${S}${cfg.getPath ? cfg.getPath.replace(':id', '1') : `${cfg.basePath}/1`}`]: first },
    v2: { [`GET ${v2Base}/1`]: env(asV2(cfg, first)) },
    expectV1: [{ method: 'GET', path: cfg.getViaFilter ? base : `${S}${cfg.getPath ? cfg.getPath.replace(':id', '1') : `${cfg.basePath}/1`}` }],
    expectV2: [{ method: 'GET', path: `${v2Base}/1` }],
    check: (o) => assert.deepEqual(o, first),
  });

  // --- create (kits use `assemble`) ---
  const bodies = writeBodies(cfg);
  if (cfg.name !== 'kits') {
    out.push({
      name: `inventory ${cfg.name} create`,
      args: ['inventory', cfg.name, 'create', '--data', JSON.stringify(bodies.v1)],
      v1: { [`POST ${base}`]: first },
      v2: { [`POST ${v2Base}`]: { status: 201, body: env(asV2(cfg, first)) } },
      expectV1: [{ method: 'POST', path: base, body: bodies.v1 }],
      expectV2: [{ method: 'POST', path: v2Base, body: bodies.v2 }],
    });
  }

  // --- update ---
  out.push({
    name: `inventory ${cfg.name} update`,
    args: ['inventory', cfg.name, 'update', '1', '--data', JSON.stringify(bodies.v1)],
    v1: cfg.putBodyOnly ? { [`PUT ${base}`]: first } : { [`PUT ${base}/1`]: first },
    v2: { [`PATCH ${v2Base}/1`]: env(asV2(cfg, first)) },
    expectV1: [cfg.putBodyOnly ? { method: 'PUT', path: base, body: { ...bodies.v1, [cfg.idField]: 1 } } : { method: 'PUT', path: `${base}/1`, body: bodies.v1 }],
    expectV2: [{ method: 'PATCH', path: `${v2Base}/1`, body: bodies.v2 }],
  });

  // --- delete ---
  out.push({
    name: `inventory ${cfg.name} delete`,
    args: ['inventory', cfg.name, 'delete', '1'],
    v1: { [`DELETE ${base}/1`]: { raw: [], affected: 1 } },
    v2: { [`DELETE ${v2Base}/1`]: { status: 204 } },
    expectV1: [{ method: 'DELETE', path: `${base}/1` }],
    expectV2: [{ method: 'DELETE', path: `${v2Base}/1` }],
    check: (o) => assert.deepEqual(o, { success: true, deleted: '1' }),
  });

  // --- delete-batch ---
  if (cfg.batchDeletePath) {
    out.push({
      name: `inventory ${cfg.name} delete-batch`,
      args: ['inventory', cfg.name, 'delete-batch', '--ids', '1,2'],
      v1: { [`POST ${base}/${cfg.batchDeletePath}`]: { raw: [], affected: 2 } },
      v2: { [`POST ${v2Base}/batch-delete`]: env({ deleted: 2 }) },
      expectV1: [{ method: 'POST', path: `${base}/${cfg.batchDeletePath}`, body: ['1', '2'] }],
      expectV2: [{ method: 'POST', path: `${v2Base}/batch-delete`, body: { ids: [1, 2] } }],
      check: (o) => assert.deepEqual(o, { success: true, deleted: 2 }),
    });
  }

  // --- filter ---
  const filterPath = `${S}${cfg.filterPath || `${cfg.basePath}/filter`}`;
  const query = cfg.v2.identifierIsName ? { identifier: 'HP' } : { label: 'x' };
  out.push({
    name: `inventory ${cfg.name} filter`,
    args: ['inventory', cfg.name, 'filter', '--query', JSON.stringify(query), '--limit', '2'],
    v1: { [`POST ${filterPath}`]: [all.slice(0, 2), 3] },
    v2: { [`POST ${v2Base}/search`]: page(all.slice(0, 2).map((x) => asV2(cfg, x)), 3, 2, 0) },
    expectV1: [{ method: 'POST', path: filterPath, query: { limit: '2', offset: '0' }, body: query }],
    expectV2: [
      {
        method: 'POST',
        path: `${v2Base}/search`,
        query: { limit: '2', offset: '0', active: cfg.v2.filterActive === false ? null : 'true' },
        body: cfg.v2.identifierIsName ? { name: 'HP' } : query,
      },
    ],
    check: (o) => assert.equal(o.total, 3),
  });
  return out;
}

for (const cfg of [...RESOURCES, KITS_RESOURCE]) {
  for (const c of cases(cfg)) test(c.name, () => parity(c).then(() => undefined));
}

const panels = INV.panels;
test('inventory panels list --active-only: v1 without unactive, v2 active=true', () =>
  parity({
    name: 'active-only',
    args: ['inventory', 'panels', 'list', '--active-only'],
    v1: { 'GET /solar/solar-panels': [panels, 3] },
    v2: { 'GET /api/v2/inventory/panels': page(panels, 3, 20, 0) },
    expectV1: [{ method: 'GET', path: '/solar/solar-panels', query: { unactive: null, limit: '20' } }],
    expectV2: [{ method: 'GET', path: '/api/v2/inventory/panels', query: { active: 'true', sort: '-creationTimestamp' } }],
  }).then(() => undefined));

test('inventory panels list --limit 150: v2 asks for two pages (max 100)', () => {
  const many = Array.from({ length: 150 }, (_, i) => ({ solarPanelId: i + 1, name: `P${i + 1}` }));
  return parity({
    name: 'big limit',
    args: ['inventory', 'panels', 'list', '--limit', '150', '--fields', 'solarPanelId'],
    v1: { 'GET /solar/solar-panels': [many, 150] },
    v2: {
      'GET /api/v2/inventory/panels': (_r: unknown, url: URL) => {
        const limit = Number(url.searchParams.get('limit'));
        const offset = Number(url.searchParams.get('offset'));
        return page(many.slice(offset, offset + limit), 150, limit, offset);
      },
    },
    expectV1: [{ method: 'GET', path: '/solar/solar-panels', query: { limit: '150' } }],
    expectV2: [
      { method: 'GET', path: '/api/v2/inventory/panels', query: { limit: '100', offset: '0' } },
      { method: 'GET', path: '/api/v2/inventory/panels', query: { limit: '50', offset: '100' } },
    ],
    check: (o) => assert.equal(o.data.length, 150),
  }).then(() => undefined);
});

// ─── manufacturers, custom fields, kits ───────────────────────────────────

const walk = (items: unknown[]) => (_r: unknown, url: URL) => {
  const limit = Number(url.searchParams.get('limit'));
  const offset = Number(url.searchParams.get('offset'));
  return page(items.slice(offset, offset + limit), items.length, limit, offset);
};

const simple: Case[] = [
  {
    name: 'inventory manufacturers list (whole collection; v2 walks pages)',
    args: ['inventory', 'manufacturers', 'list'],
    v1: { 'GET /solar/manufacturers': INV.manufacturers },
    v2: { 'GET /api/v2/inventory/manufacturers': walk(INV.manufacturers) },
    expectV1: [{ method: 'GET', path: '/solar/manufacturers' }],
    expectV2: [{ method: 'GET', path: '/api/v2/inventory/manufacturers', query: { limit: '100', offset: '0' } }],
  },
  {
    name: 'inventory manufacturers create',
    args: ['inventory', 'manufacturers', 'create', '--data', '{"name":"Acme"}'],
    v1: { 'POST /solar/manufacturers': INV.manufacturers[0] },
    v2: { 'POST /api/v2/inventory/manufacturers': { status: 201, body: env(INV.manufacturers[0]) } },
    expectV1: [{ method: 'POST', path: '/solar/manufacturers', body: { name: 'Acme' } }],
    expectV2: [{ method: 'POST', path: '/api/v2/inventory/manufacturers', body: { name: 'Acme' } }],
  },
  {
    name: 'inventory custom-fields list',
    args: ['inventory', 'custom-fields', 'list'],
    v1: { 'GET /solar/custom-asset/custom-field/all': INV['custom-fields'] },
    v2: { 'GET /api/v2/inventory/custom-fields': walk(INV['custom-fields']) },
    expectV1: [{ method: 'GET', path: '/solar/custom-asset/custom-field/all' }],
    expectV2: [{ method: 'GET', path: '/api/v2/inventory/custom-fields' }],
  },
  {
    name: 'inventory custom-fields get',
    args: ['inventory', 'custom-fields', 'get', '1'],
    v1: { 'GET /solar/custom-asset/custom-field/id/1': INV['custom-fields'][0] },
    v2: { 'GET /api/v2/inventory/custom-fields/1': env(INV['custom-fields'][0]) },
    expectV1: [{ method: 'GET', path: '/solar/custom-asset/custom-field/id/1' }],
    expectV2: [{ method: 'GET', path: '/api/v2/inventory/custom-fields/1' }],
  },
  {
    name: 'inventory custom-fields create',
    args: ['inventory', 'custom-fields', 'create', '--data', '{"label":"Power","type":"number","customAssetTypeId":1}'],
    v1: { 'POST /solar/custom-asset/custom-field': INV['custom-fields'][0] },
    v2: { 'POST /api/v2/inventory/custom-fields': { status: 201, body: env(INV['custom-fields'][0]) } },
    expectV1: [{ method: 'POST', path: '/solar/custom-asset/custom-field', body: { label: 'Power', type: 'number', customAssetTypeId: 1 } }],
    expectV2: [{ method: 'POST', path: '/api/v2/inventory/custom-fields', body: { label: 'Power', type: 'number', customAssetTypeId: 1 } }],
  },
  {
    name: 'inventory custom-fields update (PUT → PATCH)',
    args: ['inventory', 'custom-fields', 'update', '1', '--data', '{"label":"Power 2"}'],
    v1: { 'PUT /solar/custom-asset/custom-field/1': INV['custom-fields'][0] },
    v2: { 'PATCH /api/v2/inventory/custom-fields/1': env(INV['custom-fields'][0]) },
    expectV1: [{ method: 'PUT', path: '/solar/custom-asset/custom-field/1', body: { label: 'Power 2' } }],
    expectV2: [{ method: 'PATCH', path: '/api/v2/inventory/custom-fields/1', body: { label: 'Power 2' } }],
  },
  {
    name: 'inventory custom-fields delete',
    args: ['inventory', 'custom-fields', 'delete', '1'],
    v1: { 'DELETE /solar/custom-asset/custom-field/1': INV['custom-fields'][0] },
    v2: { 'DELETE /api/v2/inventory/custom-fields/1': { status: 204 } },
    expectV1: [{ method: 'DELETE', path: '/solar/custom-asset/custom-field/1' }],
    expectV2: [{ method: 'DELETE', path: '/api/v2/inventory/custom-fields/1' }],
    check: (o) => assert.deepEqual(o, { success: true, deleted: '1' }),
  },
  {
    name: 'inventory kits archive',
    args: ['inventory', 'kits', 'archive', '2'],
    v1: { 'PUT /solar/solar-kits/archive/2': { generatedMaps: [], raw: [], affected: 1 } },
    v2: { 'POST /api/v2/inventory/kits/2/archive': env({ ...INV.kits[1], active: false }) },
    expectV1: [{ method: 'PUT', path: '/solar/solar-kits/archive/2' }],
    expectV2: [{ method: 'POST', path: '/api/v2/inventory/kits/2/archive' }],
    check: (o) => assert.deepEqual(o, { idSolarKit: 2, active: false }),
  },
  {
    name: 'inventory kits assemble: checks then creates',
    args: ['inventory', 'kits', 'assemble', '--name', 'Kit A', '--panel', '1', '--inverter', '2', '--battery', '3', '--price', '6500', '--custom-asset', '9:4'],
    v1: {
      'POST /solar/solar-kits/solar-panels/filter': [[INV['kit-panels'][0]], 1],
      'GET /solar/solar-kits/inverters': INV['kit-inverters'],
      'GET /solar/solar-battery/3': INV.batteries[2],
      'POST /solar/solar-kits': INV.kits[0],
    },
    v2: {
      'GET /api/v2/inventory/kit-panels/1': env(INV['kit-panels'][0]),
      'GET /api/v2/inventory/kit-inverters/2': env(INV['kit-inverters'][1]),
      'GET /api/v2/inventory/batteries/3': env(INV.batteries[2]),
      'POST /api/v2/inventory/kits': { status: 201, body: env(INV.kits[0]) },
    },
    expectV1: [
      { method: 'POST', path: '/solar/solar-kits/solar-panels/filter', body: { idKitSolarPanel: 1 } },
      { method: 'GET', path: '/solar/solar-kits/inverters' },
      { method: 'GET', path: '/solar/solar-battery/3' },
      {
        method: 'POST',
        path: '/solar/solar-kits',
        body: {
          identifier: 'Kit A', panelNumber: 12, inverterNumber: 1, batteriesNumber: 0, phaseNumber: 'single_phase', defaultTaxesPercentage: 21, active: true,
          kitSolarPanel: { idKitSolarPanel: 1 }, kitInverter: { idKitInverter: 2 }, battery: { batteryId: 3 }, price: 6500,
          solarKitCustomAssets: [{ customAsset: { idCustomAsset: 9 }, units: 4 }],
        },
      },
    ],
    expectV2: [
      { method: 'GET', path: '/api/v2/inventory/kit-panels/1' },
      { method: 'GET', path: '/api/v2/inventory/kit-inverters/2' },
      { method: 'GET', path: '/api/v2/inventory/batteries/3' },
      {
        method: 'POST',
        path: '/api/v2/inventory/kits',
        body: {
          identifier: 'Kit A', panelNumber: 12, inverterNumber: 1, batteriesNumber: 0, phaseNumber: 'single_phase', defaultTaxesPercentage: 21, active: true,
          kitSolarPanelId: 1, kitInverterId: 2, batteryId: 3, price: 6500, customAssets: [{ customAssetId: 9, units: 4 }],
        },
      },
    ],
  },
  {
    name: 'inventory kits assemble: a missing kit panel stops before creating (v1 empty filter, v2 404)',
    args: ['inventory', 'kits', 'assemble', '--name', 'Kit A', '--panel', '99', '--price', '1'],
    v1: { 'POST /solar/solar-kits/solar-panels/filter': [[], 0] },
    v2: { 'GET /api/v2/inventory/kit-panels/99': { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } } },
    expectV1: [{ method: 'POST', path: '/solar/solar-kits/solar-panels/filter' }],
    expectV2: [{ method: 'GET', path: '/api/v2/inventory/kit-panels/99' }],
    code: 1,
  },
];

for (const [name, v1Base, v2Res, idField] of [
  ['panels', '/solar-kits/solar-panels', 'kit-panels', 'idKitSolarPanel'],
  ['inverters', '/solar-kits/inverters', 'kit-inverters', 'idKitInverter'],
  ['batteries', '/solar-kits/batteries', 'kit-batteries', 'idKitBattery'],
] as const) {
  const items = INV[v2Res];
  simple.push(
    {
      name: `inventory kits ${name} list (whole; v2 walks pages)`,
      args: ['inventory', 'kits', name, 'list'],
      v1: { [`GET /solar${v1Base}`]: items },
      v2: { [`GET /api/v2/inventory/${v2Res}`]: walk(items) },
      expectV1: [{ method: 'GET', path: `/solar${v1Base}` }],
      expectV2: [{ method: 'GET', path: `/api/v2/inventory/${v2Res}`, query: { sort: 'id', limit: '100' } }],
    },
    {
      name: `inventory kits ${name} create`,
      args: ['inventory', 'kits', name, 'create', '--data', '{"name":"X","manufacturer":{"idManufacturer":7}}'],
      v1: { [`POST /solar${v1Base}`]: items[0] },
      v2: { [`POST /api/v2/inventory/${v2Res}`]: { status: 201, body: env(items[0]) } },
      expectV1: [{ method: 'POST', path: `/solar${v1Base}`, body: { name: 'X', manufacturer: { idManufacturer: 7 } } }],
      expectV2: [{ method: 'POST', path: `/api/v2/inventory/${v2Res}`, body: { name: 'X', manufacturerId: 7 } }],
    },
    {
      name: `inventory kits ${name} delete`,
      args: ['inventory', 'kits', name, 'delete', '1'],
      v1: { [`DELETE /solar${v1Base}/1`]: { affected: 1 } },
      v2: { [`DELETE /api/v2/inventory/${v2Res}/1`]: { status: 204 } },
      expectV1: [{ method: 'DELETE', path: `/solar${v1Base}/1` }],
      expectV2: [{ method: 'DELETE', path: `/api/v2/inventory/${v2Res}/1` }],
    },
  );
  if (name !== 'batteries') {
    simple.push(
      {
        name: `inventory kits ${name} update (PUT → PATCH)`,
        args: ['inventory', 'kits', name, 'update', '1', '--data', '{"costPerUnit":5}'],
        v1: { [`PUT /solar${v1Base}/1`]: items[0] },
        v2: { [`PATCH /api/v2/inventory/${v2Res}/1`]: env(items[0]) },
        expectV1: [{ method: 'PUT', path: `/solar${v1Base}/1`, body: { costPerUnit: 5 } }],
        expectV2: [{ method: 'PATCH', path: `/api/v2/inventory/${v2Res}/1`, body: { costPerUnit: 5 } }],
      },
      {
        name: `inventory kits ${name} featured (v2 walks pages)`,
        args: ['inventory', 'kits', name, 'featured', '1'],
        v1: { [`GET /solar${v1Base}/findFeaturedSolarKits/1`]: INV.kits },
        v2: { [`GET /api/v2/inventory/${v2Res}/1/kits`]: walk(INV.kits) },
        expectV1: [{ method: 'GET', path: `/solar${v1Base}/findFeaturedSolarKits/1` }],
        expectV2: [{ method: 'GET', path: `/api/v2/inventory/${v2Res}/1/kits` }],
      },
    );
  }
  void idField;
}
simple.push({
  name: 'inventory kits panels get (v1 filter by id, v2 GET :id)',
  args: ['inventory', 'kits', 'panels', 'get', '1'],
  v1: { 'POST /solar/solar-kits/solar-panels/filter': [[INV['kit-panels'][0]], 1] },
  v2: { 'GET /api/v2/inventory/kit-panels/1': env(INV['kit-panels'][0]) },
  expectV1: [{ method: 'POST', path: '/solar/solar-kits/solar-panels/filter', body: { idKitSolarPanel: 1 } }],
  expectV2: [{ method: 'GET', path: '/api/v2/inventory/kit-panels/1' }],
  check: (o) => assert.deepEqual(o, INV['kit-panels'][0]),
});

for (const c of simple) test(c.name, () => parity(c).then(() => undefined));
