import { Command } from 'commander';
import { createServiceClient, handleApiError } from '../../client.js';
import { output, outputError, type OutputOptions } from '../../output.js';

function getGlobalOpts(cmd: Command): OutputOptions & Record<string, unknown> {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

/** Read all stdin as a promise */
function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

/** Read JSON data from --data flag or stdin */
async function parseData(data: string | undefined): Promise<Record<string, unknown> | undefined> {
  if (!data) return undefined;
  if (data === '-') {
    const input = await readStdin();
    return JSON.parse(input);
  }
  return JSON.parse(data);
}

export function registerShareableCommands(program: Command): void {
  const shareables = program.command('shareables').description(
    'Create shareable links for studies (sharing service, exposed under /templates).'
  );

  // --- create ---
  shareables
    .command('create')
    .description(
      'Create a shareable link for a study (POST /shareable).\n' +
      'The backend fills uid, url, clientUID and idShareable from the token.\n\n' +
      'elementType: solarStudy (default), colectiveSolarStudy, veChargerStudy, heatpumpStudy, billing\n' +
      'shareableType: TEMPLATE (default), CONTRACT\n' +
      'privacy: PUBLIC (default), PRIVATE (use --password)\n\n' +
      'Examples:\n' +
      '  suntropy shareables create --element-id 665f0a1b2c3d4e5f60718293\n' +
      '  suntropy shareables create --element-id 665f... --template-id 6700aa... --name "Estudio Juan"\n' +
      '  suntropy shareables create --element-id 665f... --privacy PRIVATE --password secret --email-list "a@x.com;b@y.com"\n' +
      '  suntropy shareables create --element-id 665f... --expiration-date 2026-12-31 --link-params "utm_source=cli"'
    )
    .requiredOption('--element-id <id>', 'Id of the element (study) to share')
    .option('--element-type <type>', 'solarStudy | colectiveSolarStudy | veChargerStudy | heatpumpStudy | billing', 'solarStudy')
    .option('--shareable-type <type>', 'TEMPLATE | CONTRACT', 'TEMPLATE')
    .option('--privacy <privacy>', 'PUBLIC | PRIVATE', 'PUBLIC')
    .option('--template-id <id>', 'Template id to apply to the shareable')
    .option('--name <name>', 'Descriptive name for the shareable')
    .option('--password <pwd>', 'Protect the link with a password (implies PRIVATE)')
    .option('--expiration-date <date>', 'Expiration date (e.g. 2026-12-31)')
    .option('--activation-date <date>', 'Activation date (e.g. 2026-01-01)')
    .option('--email-list <emails>', 'Semicolon-separated list of recipient emails')
    .option('--reply-to <email>', 'Reply-to email for notifications')
    .option('--custom-layout', 'Enable custom layout')
    .option('--read-only', 'Mark the shareable as read-only')
    .option('--link-params <qs>', 'Extra query params appended to the shareable link (k=v&k2=v2)')
    .option('--data <json>', 'Extra ShareableDto fields as JSON (or - for stdin), merged last')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(shareables);
        const client = createServiceClient('templates', global);

        const extra = (await parseData(opts.data)) || {};
        const body: Record<string, unknown> = {
          elementId: opts.elementId,
          elementType: opts.elementType,
          shareableType: opts.shareableType,
          privacy: opts.password ? 'PRIVATE' : opts.privacy,
          ...(opts.templateId ? { templateId: opts.templateId } : {}),
          ...(opts.name ? { name: opts.name } : {}),
          ...(opts.password ? { password: opts.password, passwordConfirm: opts.password } : {}),
          ...(opts.expirationDate ? { expirationDate: opts.expirationDate } : {}),
          ...(opts.activationDate ? { activationDate: opts.activationDate } : {}),
          ...(opts.emailList ? { emailList: opts.emailList } : {}),
          ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
          ...(opts.customLayout ? { customLayout: true } : {}),
          ...(opts.readOnly ? { readOnly: true } : {}),
          ...extra,
        };

        const url = opts.linkParams ? `/shareable?${opts.linkParams}` : '/shareable';
        const res = await client.post(url, body);
        output(res.data, { ...global, save: global.save });
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
