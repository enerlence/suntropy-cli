import { Command } from 'commander';
import { createResourceCommands, type ResourceConfig } from './factory.js';
import { registerKitsCommands } from './kits.js';
import { registerManufacturersCommands } from './manufacturers.js';

const RESOURCES: ResourceConfig[] = [
  {
    name: 'panels',
    singular: 'solar panel',
    basePath: '/solar-panels',
    idField: 'solarPanelId',
    listFields: ['name', 'manufacturer', 'peakPower', 'efficiency', 'costPerUnit', 'active'],
    batchDeletePath: 'delete-batch-solar-panels',
  },
  {
    name: 'inverters',
    singular: 'solar inverter',
    basePath: '/solar-inverter',
    idField: 'idInverter',
    listFields: ['name', 'manufacturer', 'nominalPower', 'efficiency', 'phaseNumber', 'isMicroinverter', 'isHybrid', 'costPerUnit', 'active'],
    batchDeletePath: 'delete-batch-solar-inverters',
    putBodyOnly: true,
  },
  {
    name: 'batteries',
    singular: 'battery',
    basePath: '/solar-battery',
    idField: 'batteryId',
    listFields: ['name', 'manufacturer', 'capacity', 'isModular', 'costPerUnit', 'active'],
    batchDeletePath: 'delete-batch-solar-batteries',
  },
  {
    name: 'chargers',
    singular: 'VE charger',
    basePath: '/charger',
    idField: 'idCharger',
    listFields: ['name', 'manufacturer', 'maxPower', 'connectorType', 'phaseNumber', 'costPerUnit', 'active'],
    batchDeletePath: 'delete-batch-chargers',
    putBodyOnly: true,
  },
  {
    name: 'heatpumps',
    singular: 'heat pump',
    basePath: '/heat-pump',
    idField: 'idHeatpump',
    listFields: ['name', 'manufacturer', 'lowerPower', 'upperPower', 'scop', 'costPerUnit', 'active'],
    batchDeletePath: 'delete-batch-heatpumps',
    putBodyOnly: true,
  },
  {
    name: 'custom-assets',
    singular: 'custom asset',
    basePath: '/custom-asset',
    idField: 'idCustomAsset',
    listFields: ['label', 'customAssetType', 'identifier', 'isMaterial', 'costPerUnit', 'active'],
  },
  {
    name: 'custom-asset-types',
    singular: 'custom asset type',
    basePath: '/custom-asset/type',
    idField: 'idCustomAssetType',
    listFields: ['label', 'isMaterialConcept', 'panelsQuantity'],
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
  },
];

export function registerInventoryCommands(program: Command): void {
  const inventory = program.command('inventory').description('Manage inventory: panels, inverters, batteries, chargers, heatpumps, custom-assets, kits');

  // Register manufacturer commands (special - simpler CRUD)
  registerManufacturersCommands(inventory);

  // Register all standard CRUD resources
  for (const resource of RESOURCES) {
    inventory.addCommand(createResourceCommands(resource));
  }

  // Register kits (complex - has sub-resources)
  registerKitsCommands(inventory);
}
