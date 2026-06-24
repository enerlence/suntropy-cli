import type { Command } from 'commander';
import { loadConfig, saveConfig } from './config.js';

/**
 * Command access profiles ("permission tiers").
 *
 * The CLI can be locked to a permission tier so that only a subset of commands
 * is registered. Tiers are CUMULATIVE:
 *
 *   read  ⊂  write (read + write)  ⊂  delete (read + write + delete = full)
 *
 * Commands above the active tier are pruned from the command tree before
 * parsing, so they (a) never appear in `--help` and (b) when invoked, Commander
 * reports them natively as `error: unknown command 'X'` — i.e. "the command
 * does not exist". This is an admin/automation control (e.g. to constrain the
 * Alexandria agent's sandbox to read-only). It is intentionally not advertised
 * in the user-facing help; it is driven by the hidden `command-profile` command
 * or the SUNTROPY_COMMAND_PROFILE environment variable.
 */
export type CommandTier = 'read' | 'write' | 'delete';

export const COMMAND_TIERS: CommandTier[] = ['read', 'write', 'delete'];

const TIER_VALUE: Record<CommandTier, number> = { read: 0, write: 1, delete: 2 };

/** Default when nothing is configured: full access (legacy behavior). */
export const DEFAULT_TIER: CommandTier = 'delete';

export const ENV_VAR = 'SUNTROPY_COMMAND_PROFILE';

export function tierValue(t: CommandTier): number {
  return TIER_VALUE[t];
}

export function isValidTier(value: unknown): value is CommandTier {
  return typeof value === 'string' && (COMMAND_TIERS as string[]).includes(value);
}

export interface ResolvedCommandProfile {
  tier: CommandTier;
  source: 'env' | 'config' | 'default';
  /** Raw env value when present but invalid (for diagnostics). */
  invalidEnv?: string;
}

/**
 * Resolve the active tier. Precedence: env var > config file > default.
 * Pure (no side effects) so it can be called from both the gating step and the
 * `command-profile` status command.
 */
export function getActiveCommandProfile(): ResolvedCommandProfile {
  const envRaw = process.env[ENV_VAR]?.trim();
  if (envRaw) {
    const envNorm = envRaw.toLowerCase();
    if (isValidTier(envNorm)) return { tier: envNorm, source: 'env' };
    // Invalid env value: fall through to config/default but report it.
    const fallback = resolveFromConfig();
    return { ...fallback, invalidEnv: envRaw };
  }
  return resolveFromConfig();
}

function resolveFromConfig(): ResolvedCommandProfile {
  try {
    const cfg = loadConfig();
    if (isValidTier(cfg.commandProfile)) return { tier: cfg.commandProfile, source: 'config' };
  } catch {
    // ignore: fall back to default
  }
  return { tier: DEFAULT_TIER, source: 'default' };
}

/** Persist (or clear, when null) the stored command profile. */
export function setStoredCommandProfile(tier: CommandTier | null): void {
  const cfg = loadConfig();
  if (tier === null) delete cfg.commandProfile;
  else cfg.commandProfile = tier;
  saveConfig(cfg);
}

// ─── Classification ───────────────────────────────────────────────────────
//
// A command's tier is the MAX tier over the verbs in its path. Verbs are the
// command/group names, so e.g. `studies set name` inherits `write` from `set`,
// and `inventory kits panels delete` inherits `delete` from `delete`.

const DELETE_VERBS = new Set(['delete', 'delete-batch', 'archive']);

const WRITE_VERBS = new Set([
  'create', 'update', 'edit', 'set', 'add', 'remove', 'assemble', 'featured',
  'save', 'init', 'init-default', 'add-comment', 'comment',
  'calculate-results', 'optimize-peakpower',
]);

/**
 * Explicit overrides for paths whose verbs are ambiguous. `studies calculate
 * production` writes to the local draft (write), but the bare verb `calculate`
 * is also used by pure-compute commands (`ppa calculate`, `solarform calculate`,
 * `studies calculate-production`) that are read-only — so `calculate` is NOT a
 * global write verb; this path is pinned instead.
 */
const PATH_OVERRIDES: Record<string, CommandTier> = {
  'studies calculate production': 'write',
};

export function classifyPath(segs: string[]): CommandTier {
  const key = segs.join(' ');
  if (PATH_OVERRIDES[key]) return PATH_OVERRIDES[key];
  let tier: CommandTier = 'read';
  for (const seg of segs) {
    if (DELETE_VERBS.has(seg)) return 'delete';
    if (WRITE_VERBS.has(seg)) tier = 'write';
  }
  return tier;
}

// ─── Exemptions ───────────────────────────────────────────────────────────
//
// CLI plumbing that must always work regardless of the active tier: you always
// need to authenticate, configure the CLI, and manage the command profile
// itself. NOTE: only the *local* `config` leaves are exempt — the tenant
// configuration subtrees (`config theme`, `config solarform …`) hit the backend
// and are gated like any other business command.

const EXEMPT_CONFIG_LEAVES = new Set(['set', 'get', 'list', 'create-profile', 'use']);

export function isExemptPath(segs: string[]): boolean {
  if (segs[0] === 'auth') return true;
  if (segs[0] === 'command-profile') return true;
  if (segs[0] === 'config' && segs.length === 2 && EXEMPT_CONFIG_LEAVES.has(segs[1])) return true;
  return false;
}

// ─── Pruning ──────────────────────────────────────────────────────────────

/**
 * Prune the command tree in place according to the active command profile.
 * Returns the resolved tier so the caller can surface it if needed.
 */
export function applyCommandProfile(program: Command): ResolvedCommandProfile {
  const resolved = getActiveCommandProfile();
  pruneChildren(program, [], tierValue(resolved.tier));
  return resolved;
}

function pruneChildren(parent: Command, parentSegs: string[], max: number): void {
  const kept = parent.commands.filter((child) => {
    const segs = [...parentSegs, child.name()];
    return keepCommand(child, segs, max);
  });
  // Commander types `commands` as readonly, but pruning must replace its
  // contents. Mutate the array in place (rather than reassigning the property)
  // so Commander keeps using the same reference for help and dispatch.
  const mutable = parent.commands as Command[];
  mutable.length = 0;
  mutable.push(...kept);
}

function keepCommand(cmd: Command, segs: string[], max: number): boolean {
  if (cmd.commands.length > 0) {
    // Group: prune its descendants first, then keep it only if something
    // survived (or it's an exempt subtree).
    pruneChildren(cmd, segs, max);
    if (cmd.commands.length > 0) return true;
    return isExemptPath(segs);
  }
  // Leaf:
  if (isExemptPath(segs)) return true;
  return tierValue(classifyPath(segs)) <= max;
}
