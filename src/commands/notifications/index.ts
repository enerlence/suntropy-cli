import { Command, Option } from 'commander';
import { createServiceClient, handleApiError, assertStudyObjectId } from '../../client.js';
import { output, outputError, type OutputOptions } from '../../output.js';
import { loadConfig, getActiveProfile } from '../../config.js';

function getGlobalOpts(cmd: Command): OutputOptions & Record<string, unknown> {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

/**
 * Well-known Suntropy user identity for the Alexandria agent. The front resolves
 * this uid to Alexandria's name/avatar (see `isAlexandriaComment`), so a
 * notification whose `fromUserUid` is this value is rendered as coming FROM
 * Alexandria — not as a self-notification from the acting user whose token the
 * CLI runs with.
 */
const ALEXANDRIA_USER_UID = 'alexandria';

const SEVERITIES = ['info', 'warning', 'urgent'] as const;
type Severity = (typeof SEVERITIES)[number];

export function registerNotificationsCommands(program: Command): void {
  const notifications = program
    .command('notifications')
    .description(
      'Send in-app (and email) notifications to Suntropy users.\n' +
      'Useful for Alexandria to proactively tell a user a task is done, since a\n' +
      'direct/email execution leaves no study comment (and thus no auto-notification).',
    );

  // --- send ---
  notifications
    .command('send')
    .description(
      'Send a notification to a user. It appears in the recipient\'s notification\n' +
      'bell and, if enabled in their config, is also emailed. Sent FROM Alexandria\n' +
      'by default so it is not shown as a self-notification.\n' +
      'Examples:\n' +
      '  suntropy notifications send --to-user <userUID> --message "He terminado el estudio."\n' +
      '  suntropy notifications send --to-user <userUID> --title "Estudio listo" \\\n' +
      '    --message "Revisa los resultados." --study <solarStudyId> --mention',
    )
    .requiredOption('--to-user <userUID>', 'Recipient userUID (who gets notified)')
    .requiredOption('--message <text>', 'Notification body (supports Markdown)')
    .option('--title <text>', 'Notification title', 'Alexandria')
    .option('--severity <severity>', `Severity: ${SEVERITIES.join(' | ')}`, 'info')
    .option(
      '--mention',
      'Send as a mention (type new_mention) instead of an update (new_comment). ' +
        'Mentions are gated by the user\'s "mention" notification setting.',
    )
    .option(
      '--study <solarStudyId>',
      'Link the notification to a solar study: makes it click-through to that study',
    )
    .option('--link <url>', 'Custom link for the email call-to-action')
    .option(
      '--from-user <userUID>',
      'Sender userUID shown as the author (default: the authenticated user)',
    )
    // Hidden flag mirroring `studies comment --as-alexandria`: signs the
    // notification as Alexandria (fromUserUid = "alexandria", which the front
    // resolves to Alexandria's name/avatar). Omitted from --help; the agent is
    // instructed to use it. `--from-user` still takes precedence if provided.
    .addOption(new Option('--as-alexandria').hideHelp())
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(notifications);

        const severity = opts.severity as Severity;
        if (!SEVERITIES.includes(severity)) {
          throw new Error(
            `Invalid --severity "${opts.severity}". Use one of: ${SEVERITIES.join(', ')}.`,
          );
        }
        // A linked study must be an actual study _id (24-hex ObjectId), or the
        // click-through would point nowhere.
        if (opts.study) assertStudyObjectId(opts.study);

        const client = createServiceClient('notifications', global);

        // Sender identity: explicit --from-user wins; else --as-alexandria signs
        // it as Alexandria; else fall back to the authenticated user (a plain
        // user-to-user notification).
        const profile = getActiveProfile(loadConfig());
        const fromUserUid = opts.fromUser
          ? opts.fromUser
          : opts.asAlexandria
            ? ALEXANDRIA_USER_UID
            : profile.userUID;

        const notification = {
          notificationType: opts.mention ? 'new_mention' : 'new_comment',
          severity,
          origin: opts.asAlexandria ? 'ALEXANDRIA' : 'CLI',
          fromUserUid,
          toUserUid: opts.toUser,
          notificationContent: {
            contentType: 'COMMENT',
            name: opts.title,
            description: opts.message,
            ...(opts.study ? { externalId: opts.study } : {}),
            ...(opts.link ? { link: opts.link } : {}),
          },
        };

        // `@Controller('notifications')` behind the `/notifications` gateway
        // prefix → the create route is `/notifications`. clientUID/creator come
        // from the JWT; `toUserUid` in the body is the recipient.
        const res = await client.post('/notifications', notification);

        // The service returns the created Notification, or a string reason when
        // the client/type has notifications disabled — surface both clearly.
        if (typeof res.data === 'string') {
          output(
            { sent: false, reason: res.data, toUser: opts.toUser },
            global,
          );
          return;
        }
        output(
          {
            sent: true,
            notificationId: res.data?.idNotification,
            toUser: opts.toUser,
            type: notification.notificationType,
            severity,
          },
          global,
        );
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
