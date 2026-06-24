import { Command } from 'commander';
import { output, outputError, type OutputOptions } from '../output.js';
import {
  COMMAND_TIERS,
  DEFAULT_TIER,
  ENV_VAR,
  getActiveCommandProfile,
  isValidTier,
  setStoredCommandProfile,
} from '../access.js';

function getGlobalOpts(cmd: Command): OutputOptions {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as OutputOptions;
}

/**
 * Hidden admin command to manage the CLI command access profile (permission
 * tier). Registered with `{ hidden: true }` so it never shows in `--help`, but
 * remains invocable in any tier (it is exempt from gating). Changes take effect
 * on the next invocation, since gating happens at startup.
 *
 *   suntropy command-profile            show the active tier + source
 *   suntropy command-profile read       lock the CLI to read-only
 *   suntropy command-profile write       allow read + write
 *   suntropy command-profile delete      allow everything (default)
 *   suntropy command-profile reset       clear the stored value (back to default)
 */
export function registerCommandProfileCommand(program: Command): void {
  program
    .command('command-profile [tier]', { hidden: true })
    .description('Admin: get/set the command access profile (read | write | delete | reset)')
    .action((tier?: string) => {
      try {
        const global = getGlobalOpts(program);

        // No argument → report current state.
        if (!tier) {
          const resolved = getActiveCommandProfile();
          output(
            {
              commandProfile: resolved.tier,
              source: resolved.source,
              ...(resolved.invalidEnv
                ? { warning: `Ignoring invalid ${ENV_VAR}="${resolved.invalidEnv}" (expected: ${COMMAND_TIERS.join(' | ')})` }
                : {}),
              available: COMMAND_TIERS,
              envVar: ENV_VAR,
            },
            global,
          );
          return;
        }

        const value = tier.trim().toLowerCase();

        if (value === 'reset') {
          setStoredCommandProfile(null);
          const resolved = getActiveCommandProfile();
          output(
            {
              success: true,
              message: `Stored command profile cleared. Effective tier: ${resolved.tier} (${resolved.source}).`,
              commandProfile: resolved.tier,
              source: resolved.source,
            },
            global,
          );
          return;
        }

        if (!isValidTier(value)) {
          outputError(new Error(`Invalid tier "${tier}". Expected one of: ${COMMAND_TIERS.join(', ')}, or "reset".`));
          return;
        }

        setStoredCommandProfile(value);
        const envOverride = getActiveCommandProfile();
        const message =
          envOverride.source === 'env'
            ? `Stored command profile set to "${value}", but ${ENV_VAR}="${process.env[ENV_VAR]}" overrides it (effective: ${envOverride.tier}). Unset the env var for the stored value to apply.`
            : `Command profile set to "${value}". Takes effect on the next command.`;
        output(
          {
            success: true,
            commandProfile: value,
            effectiveTier: envOverride.tier,
            effectiveSource: envOverride.source,
            default: DEFAULT_TIER,
            message,
          },
          global,
        );
      } catch (err) {
        outputError(err);
      }
    });
}
