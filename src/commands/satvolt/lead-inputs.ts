import { readJsonArg } from './api.js';

/** Same cap as the backend (`MAX_LEAD_INPUTS`): for more, Excel or Maps. */
export const MAX_LEAD_INPUTS = 25;

export interface LeadInput {
  name: string;
  address?: string;
  coordinates?: string;
  url?: string;
  phone?: string;
  email?: string;
  country?: string;
  googlePlacesType?: string;
  notes?: string;
}

/**
 * Leads given by hand, from `--leads <json|@file|->` and/or repeatable
 * `--company "Name | address"` (the address part is optional).
 */
export function leadsFromOpts(opts: { leads?: string; company?: string[] }): LeadInput[] {
  const leads: LeadInput[] = [];
  if (opts.leads) {
    const parsed = readJsonArg(opts.leads, '--leads');
    const list = Array.isArray(parsed) ? parsed : parsed?.leads;
    if (!Array.isArray(list)) throw new Error('--leads must be a JSON array of leads (or { "leads": [...] })');
    leads.push(...list);
  }
  for (const entry of opts.company ?? []) {
    const [name, ...rest] = entry.split('|');
    const address = rest.join('|').trim();
    if (!name.trim()) throw new Error(`--company "${entry}" has no name`);
    leads.push(address ? { name: name.trim(), address } : { name: name.trim() });
  }
  if (leads.length === 0) throw new Error('Give the companies with --company "Name | address" or --leads <json>');
  if (leads.length > MAX_LEAD_INPUTS) {
    throw new Error(`At most ${MAX_LEAD_INPUTS} leads at a time; for more, use create-from-excel or a Maps campaign`);
  }
  return leads;
}
