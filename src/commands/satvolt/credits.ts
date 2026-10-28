import { Command } from 'commander';
import type { AxiosInstance } from 'axios';
import { createServiceClient, resolveCredential } from '../../client.js';
import { output, outputError } from '../../output.js';
import { call, getGlobalOpts, satvoltClient, satvoltError, type GlobalOpts } from './api.js';

const NEVER_PAYS =
  'The agent never pays: `credits checkout` only prints a Stripe Checkout URL.\n' +
  'Give it to the user, who pays in Stripe with their own card, and then\n' +
  'check the result with `credits balance`.';

/** Credit pack as sold by the payments service. */
interface CreditPack {
  id: string;
  credits: number;
  bonus?: number;
  totalCredits?: number;
  amount?: number;
  currency?: string;
  eurPerCredit?: number;
}

/**
 * Credit packs and Checkout live in the payments service, not in Satvolt:
 * - API v2 key: `<gateway>/api/v2/leadgen/credit-packs…` (enveloped `{ data }`);
 * - user JWT: `<server>/payments/payments/satvolt/credit-packs…` (bare body).
 * Paths are relative to the `credit-packs` collection.
 */
function packsClient(global: GlobalOpts): { client: AxiosInstance; base: string; enveloped: boolean } {
  if (resolveCredential(global).kind === 'v2') {
    return { client: satvoltClient(global), base: '/credit-packs', enveloped: true };
  }
  const client = createServiceClient('payments', global);
  client.defaults.timeout = 60000;
  return { client, base: '/payments/satvolt/credit-packs', enveloped: false };
}

async function packsCall<T>(global: GlobalOpts, method: 'get' | 'post', subPath = ''): Promise<T> {
  const { client, base, enveloped } = packsClient(global);
  if (enveloped) return call<T>(client, method, `${base}${subPath}`);
  const res = await client.request<T>({ method, url: `${base}${subPath}` });
  return res.data;
}

export function registerSatvoltCreditCommands(satvolt: Command): void {
  const credits = satvolt
    .command('credits')
    .description(
      'LeadGen credits of the account: balance, packs for sale and the payment link.\n' + NEVER_PAYS,
    );

  // --- balance ---
  credits
    .command('balance')
    .summary('Credit balance of the account: balance, held, available and the monthly cap.')
    .description(
      'Credit balance of the account: balance, credits held by running steps,\n' +
        'available (what new work can spend), this month\'s charges against the\n' +
        'monthly cap, and auto-recharge settings. Run it after the user says they\n' +
        'paid, to confirm the credits arrived.\n' +
        'Examples:\n' +
        '  suntropy satvolt credits balance\n' +
        '  suntropy satvolt credits balance --fields available,balance --format human',
    )
    .action(async () => {
      const global = getGlobalOpts(credits);
      try {
        output(await call(satvoltClient(global), 'get', '/credits'), global);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- packs ---
  credits
    .command('packs')
    .summary('Credit packs for sale: id, credits (plus bonus) and price.')
    .description(
      'Credit packs for sale: id, credits, bonus credits, total, price (amount,\n' +
        'without VAT) and price per credit. Use the id with `credits checkout <packId>`.\n' +
        NEVER_PAYS + '\n' +
        'Examples:\n' +
        '  suntropy satvolt credits packs\n' +
        '  suntropy satvolt credits packs --format human',
    )
    .action(async () => {
      const global = getGlobalOpts(credits);
      try {
        const packs = await packsCall<CreditPack[]>(global, 'get');
        const outOpts =
          global.format !== 'json' && !global.fields
            ? { ...global, fields: 'id,credits,bonus,totalCredits,amount,currency,eurPerCredit' }
            : global;
        output(packs, outOpts);
      } catch (err) {
        outputError(satvoltError(err));
      }
    });

  // --- checkout ---
  credits
    .command('checkout <packId>')
    .summary('Payment link (Stripe Checkout) for a credit pack. It does not charge anything.')
    .description(
      'Prints ONLY the Stripe Checkout URL to buy a credit pack (ids: `credits packs`).\n' +
        'It does not charge anything. Only an admin of the account can buy.\n' +
        NEVER_PAYS + '\n' +
        'Output: {"url": "https://checkout.stripe.com/…"} (json) or the bare URL (human/csv).\n' +
        'Examples:\n' +
        '  suntropy satvolt credits checkout credits-10k\n' +
        '  suntropy satvolt credits checkout credits-10k --format human',
    )
    .action(async (packId: string) => {
      const global = getGlobalOpts(credits);
      try {
        const res = await packsCall<{ url?: string }>(global, 'post', `/${encodeURIComponent(packId)}/checkout`);
        if (!res?.url) throw new Error('The payments service did not return a Checkout URL.');
        if (global.format === 'human' || global.format === 'csv') process.stdout.write(`${res.url}\n`);
        else output({ url: res.url }, { ...global, fields: undefined });
      } catch (err) {
        outputError(satvoltError(err));
      }
    });
}
