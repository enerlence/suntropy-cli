/**
 * Every operation of the CLI with its API versions: the inventory used by the
 * parity harness (`scripts/parity`) and by the docs (`docs/v2-gaps.md`).
 */
import type { Operation } from '../core.js';
import { CUSTOM_FIELDS, inventoryOps, KITS, KIT_BATTERIES, KIT_INVERTERS, KIT_PANELS, MANUFACTURERS } from './inventory.js';
import { NOTIFICATIONS, REFERENCE } from './reference.js';
import { ADVANCED, GEOCODE, PROJECTS, SHAREABLES, SOLARFORM, SOLARFORM_CONFIG, TEMPLATES, THEME } from './settings.js';
import { PPA, STUDIES } from './studies.js';
import { KITS_RESOURCE, RESOURCES } from '../../commands/inventory/resources.js';

export function allOperations(): Operation[] {
  const groups: Record<string, Operation>[] = [
    STUDIES, PPA, REFERENCE, NOTIFICATIONS, THEME, SOLARFORM_CONFIG, ADVANCED, SOLARFORM, PROJECTS, SHAREABLES, TEMPLATES, GEOCODE,
    MANUFACTURERS, CUSTOM_FIELDS, KITS, KIT_PANELS, KIT_INVERTERS, KIT_BATTERIES,
  ];
  for (const cfg of [...RESOURCES, KITS_RESOURCE]) {
    const ops = inventoryOps(cfg) as unknown as Record<string, Operation>;
    if (!cfg.batchDeletePath) delete ops.deleteBatch;
    if (cfg.name === 'kits') delete ops.create; // `kits assemble` instead
    groups.push(ops);
  }
  const seen = new Map<string, Operation>();
  for (const g of groups) for (const op of Object.values(g)) seen.set(op.id, op);
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}
