import type { ResourceConfig } from '../../api/ops/inventory.js';
import { KIT_REFS } from '../../api/ops/inventory.js';
import type { RefRule } from '../../api/translate.js';

const customAssetLinks = (from: string): RefRule => ({
  from,
  to: 'customAssets',
  many: { ref: 'customAsset', key: 'idCustomAsset', to: 'customAssetId', keep: ['units'] },
});

/**
 * Standard inventory resources: one entry per `inventory <name>` command group,
 * with its v1 route, its v2 resource (contract §3.3) and the v1 quirks the CLI
 * corrects (§3.0.6).
 */
export const RESOURCES: ResourceConfig[] = [
  {
    name: 'panels',
    singular: 'solar panel',
    basePath: '/solar-panels',
    idField: 'solarPanelId',
    listFields: ['name', 'manufacturer', 'peakPower', 'efficiency', 'costPerUnit', 'active'],
    batchDeletePath: 'delete-batch-solar-panels',
    v2: { resource: 'panels', sort: '-creationTimestamp' },
  },
  {
    name: 'inverters',
    singular: 'solar inverter',
    basePath: '/solar-inverter',
    idField: 'idInverter',
    listFields: ['name', 'manufacturer', 'nominalPower', 'efficiency', 'phaseNumber', 'isMicroinverter', 'isHybrid', 'costPerUnit', 'active'],
    batchDeletePath: 'delete-batch-solar-inverters',
    putBodyOnly: true,
    // `GET /solar-inverter` pages with `size` but returns no total: the CLI
    // reads the whole list and pages it, so `total` and `hasMore` are real.
    v1WholeList: true,
    v2: { resource: 'inverters', sort: 'id' },
  },
  {
    name: 'batteries',
    singular: 'battery',
    basePath: '/solar-battery',
    idField: 'batteryId',
    listFields: ['name', 'manufacturer', 'capacity', 'isModular', 'costPerUnit', 'active'],
    batchDeletePath: 'delete-batch-solar-batteries',
    v1IdInBody: true,
    v2: { resource: 'batteries', sort: 'id' },
  },
  {
    name: 'chargers',
    singular: 'VE charger',
    basePath: '/charger',
    idField: 'idCharger',
    listFields: ['name', 'manufacturer', 'maxPower', 'connectorType', 'phaseNumber', 'costPerUnit', 'active'],
    batchDeletePath: 'delete-batch-chargers',
    putBodyOnly: true,
    v1Active: 'split',
    v2: { resource: 'chargers', sort: 'id' },
  },
  {
    name: 'heatpumps',
    singular: 'heat pump',
    basePath: '/heat-pump',
    idField: 'idHeatpump',
    listFields: ['name', 'manufacturer', 'lowerPower', 'upperPower', 'scop', 'costPerUnit', 'active'],
    batchDeletePath: 'delete-batch-heatpumps',
    putBodyOnly: true,
    v2: { resource: 'heat-pumps', sort: 'id', identifierIsName: true },
  },
  {
    name: 'custom-assets',
    singular: 'custom asset',
    basePath: '/custom-asset',
    idField: 'idCustomAsset',
    listFields: ['label', 'customAssetType', 'identifier', 'isMaterial', 'costPerUnit', 'active'],
    getPath: '/custom-asset/id/:id',
    v1Active: 'none',
    v1WholeList: true,
    v2: {
      resource: 'custom-assets',
      sort: '-creationTimestamp',
      refs: [
        { from: 'customAssetType', to: 'customAssetTypeId', key: 'idCustomAssetType' },
        { from: 'customAssetCustomField', to: 'customFields', many: { ref: 'customField', key: 'idCustomField', to: 'customFieldId', keep: ['value'] } },
      ],
    },
  },
  {
    name: 'custom-asset-types',
    singular: 'custom asset type',
    basePath: '/custom-asset/type',
    idField: 'idCustomAssetType',
    listFields: ['label', 'isMaterialConcept', 'panelsQuantity'],
    getPath: '/custom-asset/type/id/:id',
    v1Active: 'none',
    v1WholeList: true,
    // No `active` column: `--active-only` changes nothing (v1 lists them all).
    v2: { resource: 'custom-asset-types', sort: 'id', hasActive: false },
  },
  {
    name: 'charger-kits',
    singular: 'VE charger kit',
    basePath: '/charger/ve-charger-kits',
    idField: 'idVEChargerKit',
    listFields: ['identifier', 'charger', 'price', 'phaseNumber', 'active'],
    filterPath: '/charger/ve-charger-kits/filter',
    batchDeletePath: 'delete-batch-ve-charger-kits',
    putBodyOnly: true,
    v2: {
      resource: 'charger-kits',
      sort: 'id',
      refs: [{ from: 'charger', to: 'chargerId', key: 'idCharger' }, customAssetLinks('veChargerKitCustomAssets')],
    },
  },
  {
    name: 'heatpump-kits',
    singular: 'heat pump kit',
    basePath: '/heat-pump/heatpump-kits',
    idField: 'idHeatpumpKit',
    listFields: ['identifier', 'heatpump', 'price', 'phaseNumber', 'active'],
    filterPath: '/heat-pump/heatpump-kits/filter',
    batchDeletePath: 'delete-batch-heatpump-kits',
    putBodyOnly: true,
    v2: {
      resource: 'heat-pump-kits',
      sort: 'id',
      refs: [{ from: 'heatpump', to: 'heatpumpId', key: 'idHeatpump' }, customAssetLinks('heatpumpKitCustomAssets')],
    },
  },
];

/** Solar kits: the factory commands plus `assemble`, `archive` and the kit components (kits.ts). */
export const KITS_RESOURCE: ResourceConfig = {
  name: 'kits',
  singular: 'solar kit',
  basePath: '/solar-kits',
  idField: 'idSolarKit',
  listFields: ['identifier', 'peakPower', 'panelNumber', 'inverterNumber', 'price', 'totalPrice', 'phaseNumber', 'active'],
  filterPath: '/solar-kits/filters',
  batchDeletePath: 'delete-batch-solar-kits',
  getViaFilter: true,
  v1WholeList: true,
  // The v1 kit filter does not order (primary key order).
  v2: { resource: 'kits', sort: 'id', filterSort: 'id', refs: KIT_REFS },
};

export const resourceByName = (name: string): ResourceConfig => {
  const found = [...RESOURCES, KITS_RESOURCE].find((r) => r.name === name);
  if (!found) throw new Error(`Unknown inventory resource: ${name}`);
  return found;
};
