import { Command } from 'commander';
import { output, outputError } from '../../output.js';
import {
  call,
  getGlobalOpts,
  parseId,
  readJsonArg,
  satvoltClient,
  satvoltError,
} from './api.js';

const STEP_LIST_FIELDS = 'index,uid,action,name,disable,creditCost,executedLeads,runnable,reason';

async function patchSteps(cmd: Command, campaignId: string, steps: unknown[]) {
  const global = getGlobalOpts(cmd);
  const data = await call(satvoltClient(global), 'patch', `/campaigns/${parseId(campaignId, 'campaignId')}/configuration`, {
    data: { steps },
  });
  output(data, global);
}

/**
 * `satvolt config`: the whole pipeline configuration as JSON (get / update / patch).
 * `satvolt steps`: step-level commands built on top of it (list, add, set, remove, run).
 */
export function registerSatvoltPipelineCommands(satvolt: Command): void {
  const config = satvolt
    .command('config')
    .summary('Pipeline configuration of a campaign as JSON (get, update, patch).')
    .description(
      'Pipeline configuration of a campaign as JSON.\n' +
        'Workflow: config get > edit the JSON > config update (full) or config patch (partial).',
    );

  config
    .command('get <campaignId>')
    .description(
      'Get the configuration: source, businessGroups, description and steps\n' +
        '(uid, action, target, disable, structural, config).\n' +
        'Example:\n' +
        '  suntropy satvolt config get 59 --save pipeline.json',
    )
    .action(async (campaignId) => {
      const global = getGlobalOpts(config);
      try {
        const data = await call(satvoltClient(global), 'get', `/campaigns/${parseId(campaignId, 'campaignId')}/configuration`);
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  config
    .command('update <campaignId>')
    .description(
      'Replace the pipeline (PUT). The body is { steps, businessGroups?, description? } where\n' +
        'steps is the FULL list of editable steps in order. Structural steps (SECTORIZE,\n' +
        'FIND_LEADS, IMPORT_LEADS, COMPLETE) are ignored in the input and kept by the backend,\n' +
        'so the output of `config get` can be sent back as is. Steps without uid get one;\n' +
        'config is validated against each action schema (satvolt catalog actions).\n' +
        'Example:\n' +
        '  suntropy satvolt config update 59 --data @pipeline.json',
    )
    .requiredOption('--data <json>', 'Configuration JSON, @file or -')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(config);
      try {
        const body = readJsonArg(opts.data, '--data');
        const data = await call(satvoltClient(global), 'put', `/campaigns/${parseId(campaignId, 'campaignId')}/configuration`, {
          data: body,
        });
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  config
    .command('patch <campaignId>')
    .description(
      'Partial change (PATCH). Body: { steps?, businessGroups?, description? }.\n' +
        'Each item in steps:\n' +
        '  { "uid": "<existing>", "config": {...} }   merge config (JSON Merge Patch: null resets a key to its default)\n' +
        '  { "uid": "<existing>", "replaceConfig": true, "config": {...} }   replace config\n' +
        '  { "uid": "<existing>", "disable": true }\n' +
        '  { "uid": "<existing>", "after": "<uid>" }  move (also "before")\n' +
        '  { "uid": "<existing>", "remove": true }\n' +
        '  { "action": "QUALIFY", "config": {...} }   add (before COMPLETE, or before/after a uid)\n' +
        'Example:\n' +
        '  suntropy satvolt config patch 59 --data \'{"steps":[{"uid":"d3f2849c52281f36","config":{"enableWebSearch":true}}]}\'',
    )
    .requiredOption('--data <json>', 'Patch JSON, @file or -')
    .action(async (campaignId, opts) => {
      const global = getGlobalOpts(config);
      try {
        const body = readJsonArg(opts.data, '--data');
        const data = await call(satvoltClient(global), 'patch', `/campaigns/${parseId(campaignId, 'campaignId')}/configuration`, {
          data: body,
        });
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  const steps = satvolt
    .command('steps')
    .description('Steps of a campaign pipeline: list with run status, add, set, remove and run.');

  steps
    .command('list <campaignId>')
    .description(
      'List the pipeline steps in order with catalog data (name, credits, async) and run\n' +
        'status: executedLeads, and runnable/reason for steps no lead has executed yet.',
    )
    .action(async (campaignId) => {
      const global = getGlobalOpts(steps);
      try {
        const data = await call(satvoltClient(global), 'get', `/campaigns/${parseId(campaignId, 'campaignId')}/steps`);
        if (global.format === 'json' && !global.fields) {
          output(data, global);
        } else {
          output(data.steps, { ...global, fields: global.fields ?? STEP_LIST_FIELDS });
        }
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  steps
    .command('add <campaignId>')
    .description(
      'Add a step. Goes before COMPLETE unless --before/--after is given. Config defaults\n' +
        'from the action schema are filled in and missing dependencies are added.\n' +
        'Example:\n' +
        '  suntropy satvolt steps add 59 --action QUALIFY --config \'{"qualificationDefinition":"..."}\'',
    )
    .requiredOption('--action <ACTION>', 'Action (see: satvolt catalog actions)')
    .option('--config <json>', 'Step config as JSON, @file or -')
    .option('--uid <uid>', 'Explicit uid for the new step')
    .option('--before <uid>', 'Insert before this step')
    .option('--after <uid>', 'Insert after this step')
    .option('--disabled', 'Add it disabled')
    .action(async (campaignId, opts) => {
      try {
        const step: Record<string, unknown> = { action: String(opts.action).toUpperCase() };
        if (opts.config) step.config = readJsonArg(opts.config, '--config');
        if (opts.uid) step.uid = opts.uid;
        if (opts.before) step.before = opts.before;
        if (opts.after) step.after = opts.after;
        if (opts.disabled) step.disable = true;
        await patchSteps(steps, campaignId, [step]);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  steps
    .command('set <campaignId> <stepUid>')
    .description(
      'Change one step: merge --config into its config (null resets a key to its default), or replace it\n' +
        'with --replace-config; enable/disable; move with --before/--after.\n' +
        '\n' +
        'Every step also takes two common config keys, whatever its action:\n' +
        '  skipIfEmpty  path that, when empty, skips the step for that lead\n' +
        '  successIf    paths the step must fill for its result to count as useful, relative\n' +
        '               to what the step writes (an agent: relative to its response), or\n' +
        '               absolute with fullData./lead.  Feeds `campaigns funnel --mode success`\n' +
        '  maxRetries   0-5. Repeats the step while successIf is not met. Credits are charged\n' +
        '               once per step, not per attempt; if the last attempt still has no data\n' +
        '               the lead carries on to the next step.\n' +
        'Examples:\n' +
        '  suntropy satvolt steps set 59 95161b8b080180e4 --config \'{"outputKey":"company"}\'\n' +
        '  suntropy satvolt steps set 62 7f3edaf055d60627 --config \'{"successIf":["response.linkedinUrl"],"maxRetries":2}\'',
    )
    .option('--config <json>', 'Config JSON, @file or -')
    .option('--replace-config', 'Replace the whole config instead of merging')
    .option('--enable', 'Enable the step')
    .option('--disable', 'Disable the step')
    .option('--before <uid>', 'Move before this step')
    .option('--after <uid>', 'Move after this step')
    .action(async (campaignId, stepUid, opts) => {
      try {
        if (opts.enable && opts.disable) throw new Error('Use either --enable or --disable');
        const step: Record<string, unknown> = { uid: stepUid };
        if (opts.config) step.config = readJsonArg(opts.config, '--config');
        if (opts.replaceConfig) step.replaceConfig = true;
        if (opts.enable) step.disable = false;
        if (opts.disable) step.disable = true;
        if (opts.before) step.before = opts.before;
        if (opts.after) step.after = opts.after;
        if (Object.keys(step).length === 1) throw new Error('Nothing to change: pass --config, --enable/--disable or --before/--after');
        await patchSteps(steps, campaignId, [step]);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  steps
    .command('remove <campaignId> <stepUid>')
    .description('Remove a step from the pipeline (results already stored on leads are kept).')
    .action(async (campaignId, stepUid) => {
      try {
        await patchSteps(steps, campaignId, [{ uid: stepUid, remove: true }]);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  steps
    .command('run <campaignId> <stepUid>')
    .description(
      'Run a step that no lead has executed yet over the existing leads, then continue the\n' +
        'pipeline to the end. Only the first never-executed step with nothing executed\n' +
        'after it is runnable (see runnable/reason in `steps list`). Spends credits.',
    )
    .action(async (campaignId, stepUid) => {
      const global = getGlobalOpts(steps);
      try {
        const data = await call(satvoltClient(global, 120000), 'post', `/campaigns/${parseId(campaignId, 'campaignId')}/steps/${encodeURIComponent(stepUid)}/run`);
        output(data, global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });
}
