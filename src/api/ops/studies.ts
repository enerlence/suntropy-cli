/**
 * Solar studies, production and PPA (contract §3.2, dominio A).
 */
import { custom, operation, send, v1, v2 } from '../core.js';
import { omit, parseV1List, v2All, v2Range, type Json, type Page } from '../translate.js';

export interface StudiesListInput {
  limit: number;
  offset: number;
  state?: string;
  clientName?: string;
  /** YYYY-MM-DD, inclusive, on creationTimestamp. */
  from?: string;
  to?: string;
}

const FIND = '/solar-study/findWithPaginationAndFilters';

export const STUDIES = {
  /**
   * A1. v1 is corrected (§3.0.6): `limit`/`offset` in the query, `--state` as
   * `states: [{ idSolarStudyMetadataState }]`, `--from` as a date filter and
   * `--to` as an offset over the studies created after it (the list is
   * ordered by creationTimestamp DESC), so total and paging stay exact.
   */
  list: operation<StudiesListInput, Page>('studies.list', {
    v1: custom(async (ctx, i) => {
      const filters: Json = { closed: false, won: false };
      if (i.clientName) filters.clientName = i.clientName;
      if (i.state) {
        const states = await send(ctx, 'get', '/solar-study/states');
        const wanted = i.state.toLowerCase();
        const match = (Array.isArray(states) ? states : []).find((s: Json) => String(s?.name ?? '').toLowerCase() === wanted);
        if (!match) return { items: [], total: 0 };
        filters.states = [{ idSolarStudyMetadataState: match.idSolarStudyMetadataState }];
      }
      if (i.from) filters.creationTimestamp = { date: i.from, operator: 'after' };
      let newer = 0;
      if (i.to) {
        const after = await send(ctx, 'post', FIND, {
          query: { limit: 1, offset: 0 },
          body: { ...filters, creationTimestamp: { date: `${i.to} 23:59:59.999`, operator: 'after' } },
        });
        newer = parseV1List(after).total;
      }
      const data = await send(ctx, 'post', FIND, { query: { limit: i.limit, offset: i.offset + newer }, body: filters });
      const page = parseV1List(data);
      return { items: page.items, total: Math.max(0, page.total - newer) };
    }),
    v2: custom((ctx, i) =>
      v2Range(
        ctx,
        'get',
        '/studies/solar',
        { closed: false, won: false, clientName: i.clientName, state: i.state, from: i.from, to: i.to },
        i.limit,
        i.offset,
      ),
    ),
  }),

  /** A2 */
  metadata: operation<{ id: string }, unknown>('studies.metadata', {
    v1: v1('get', ({ id }) => `/solar-study/findSolarStudyMetadataById/${id}`),
    v2: v2('get', ({ id }) => `/study-metadata/${id}`),
  }),

  /** A3 */
  metadataByStudyId: operation<{ id: string }, unknown>('studies.metadata-by-study-id', {
    v1: v1('get', ({ id }) => `/solar-study/metadata/solar-study-id/${id}`),
    v2: v2('get', ({ id }) => `/studies/solar/${id}/metadata`),
  }),

  /** A4: the full study document. */
  get: operation<{ id: string }, unknown>('studies.get', {
    v1: v1('get', ({ id }) => `/solar-study/findById/${id}`),
    v2: v2('get', ({ id }) => `/studies/solar/${id}`),
  }),

  /**
   * A10. v2: update (`PUT /studies/solar/:_id?stateId`) when the study has an
   * `_id` and is not saved as new; create (`POST /studies/solar`) otherwise.
   * A key never chooses what it pays: `--credit-amount` is not sent (§1.8.5).
   */
  save: operation<{ study: Json; stateId?: string; creditAmount?: string; saveAsNew?: boolean }, Json>('studies.save', {
    v1: v1('post', '/solar-study', {
      query: (i) => ({ idSolarStudyState: i.stateId, creditAmount: i.creditAmount, saveAsNew: i.saveAsNew ? 'true' : undefined }),
      body: (i) => i.study,
    }),
    v2: custom(async (ctx, i) => {
      if (i.creditAmount !== undefined) {
        process.stderr.write(
          'warning: --credit-amount is ignored with an API v2 key: the credits are computed from your licence.\n',
        );
      }
      const id = i.study._id as string | undefined;
      const env =
        id && !i.saveAsNew
          ? await send(ctx, 'put', `/studies/solar/${id}`, { query: { stateId: i.stateId }, body: i.study })
          : await send(ctx, 'post', '/studies/solar', {
              query: { idSolarStudyState: i.stateId, saveAsNew: i.saveAsNew ? 'true' : undefined },
              body: omit(i.study, ['_id']),
            });
      return env?.data;
    }),
  }),

  /**
   * A11. Returns the study after commenting and the comment that was sent. In
   * v2 a comment without a person behind it (no `userUID` in the profile)
   * goes without `creationUserUID`: the gateway signs it with the key.
   */
  comment: operation<{ studyId: string; comment: Json }, { study: unknown; comment: Json }>('studies.comment', {
    v1: v1('post', ({ studyId }) => `/solar-study/addSolarStudyComment/${studyId}`, {
      body: ({ comment }) => comment,
      out: (study, { comment }) => ({ study, comment }),
    }),
    v2: custom(async (ctx, { studyId, comment }) => {
      const sent = comment.creationUserUID === 'cli-agent' ? omit(comment, ['creationUserUID']) : comment;
      const env = await send(ctx, 'post', `/studies/solar/${studyId}/comments`, { body: sent });
      return { study: env?.data, comment: sent };
    }),
  }),

  /** A5 */
  calculateProduction: operation<Json, unknown>('studies.calculate-production', {
    v1: v1('post', '/solar-study/calculateProduction', { body: (b) => b }),
    v2: v2('post', '/calculations/solar-production', { body: (b) => b }),
  }),

  /** A6 */
  optimalAngles: operation<{ lat: number; lon: number }, unknown>('studies.optimize-surfaces', {
    v1: v1('get', '/solar-study/optimizeSurfaces', { query: (i) => ({ lat: i.lat, lon: i.lon }) }),
    v2: v2('get', '/calculations/optimal-angles', { query: (i) => ({ lat: i.lat, lon: i.lon }) }),
  }),
};

export const PPA = {
  /** A7: the v1 returns every template; v2 walks the pages. */
  list: operation<void, unknown>('ppa.templates.list', {
    v1: v1('get', '/solar-study/ppa-templates'),
    v2: custom((ctx) => v2All(ctx, '/ppa-templates')),
  }),
  /** A8 */
  get: operation<{ id: string }, unknown>('ppa.templates.get', {
    v1: v1('get', ({ id }) => `/solar-study/ppa-templates/${id}`),
    v2: v2('get', ({ id }) => `/ppa-templates/${id}`),
  }),
  /** A9: v1 body `{ data: study }`, v2 `{ study }`. */
  calculate: operation<{ study: unknown; templateId?: string }, unknown>('ppa.calculate', {
    v1: v1('post', '/solar-study/calculate-ppa-on-study', {
      body: (i) => ({ data: i.study, ...(i.templateId ? { ppaTemplateId: i.templateId } : {}) }),
    }),
    v2: v2('post', '/calculations/ppa', {
      body: (i) => ({ study: i.study, ...(i.templateId ? { ppaTemplateId: i.templateId } : {}) }),
    }),
  }),
};
