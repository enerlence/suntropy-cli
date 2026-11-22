import { Command } from 'commander';
import { createResourceCommands } from './factory.js';
import { RESOURCES } from './resources.js';
import { registerKitsCommands } from './kits.js';
import { registerManufacturersCommands } from './manufacturers.js';
import { registerCustomFieldsCommands } from './custom-fields.js';

export function registerInventoryCommands(program: Command): void {
  const inventory = program.command('inventory').description('Manage inventory: panels, inverters, batteries, chargers, heatpumps, custom-assets, kits');

  // Register manufacturer commands (special - simpler CRUD)
  registerManufacturersCommands(inventory);

  // Register all standard CRUD resources
  for (const resource of RESOURCES) {
    inventory.addCommand(createResourceCommands(resource));
  }

  // Register custom fields (separate CRUD)
  registerCustomFieldsCommands(inventory);

  // Register kits (complex - has sub-resources)
  registerKitsCommands(inventory);
}
