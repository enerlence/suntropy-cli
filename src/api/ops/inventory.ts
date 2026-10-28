/**
 * Inventory routes (contract §3.3, dominio B). The standard resources are
 * declared once in `RESOURCES` (`src/commands/inventory/index.ts`) with their
 * v1 base path, their v2 resource and the v1 quirks; `inventoryOps` turns a
 * resource into its seven operations.
 */
import { custom, operation, send, v1, v2, type Ctx, type Operation } from '../core.js';
import {
  deletedBatchV1,
  deletedBatchV2,
  deletedOne,
  eachItem,
  numericId,
  omit,
  pageInClient,
  parseV1List,
  renameKey,
  toV2Refs,
  v2All,
  v2Page,
  v2Range,
  type Json,
  type Page,
  type RefRule,
} from '../translate.js';

export interface InventoryV2 {
  /** v2 resource: `/api/v2/inventory/<resource>`. */
  resource: string;
  /** Order that reproduces the v1 list: `-creationTimestamp` or `id` (§1.3). */
  sort: 'id' | '-creationTimestamp';
  /** `filter` sends `active=true`, like the v1 filters (default true). */
  filterActive?: boolean;
  /** v1 relation objects → v2 id references in create/update bodies. */
  refs?: readonly RefRule[];
  /** Heat pumps: v1 `identifier` is v2 `name` in bodies; the v2 alias `name` is dropped from responses. */
  identifierIsName?: boolean;
}

export interface ResourceConfig {
  /** Command name (e.g. 'panels') */
  name: string;
  /** Singular display name (e.g. 'solar panel') */
  singular: string;
  /** API base path (e.g. '/solar-panels') */
  basePath: string;
  /** ID field name in the entity (e.g. 'solarPanelId') */
  idField: string;
  /** Fields to show in list view (summary) */
  listFields: string[];
  /** POST path for advanced filter, if different from basePath + '/filter' */
  filterPath?: string;
  /** Batch delete path suffix */
  batchDeletePath?: string;
  /** PUT uses body without ID in URL (some endpoints use PUT / with body containing id) */
  putBodyOnly?: boolean;
  /** Custom GET path pattern. Use ':id' as placeholder (e.g. '/custom-asset/id/:id') */
  getPath?: string;
  /** Use the whole list to get by ID (when the v1 has no GET :id endpoint) */
  getViaFilter?: boolean;
  /** v1 list reads `size` instead of `limit` (inverters). */
  v1LimitParam?: 'size';
  /**
   * How the v1 list selects active items:
   * - `unactive` (default): `unactive=true` = all, absent = active;
   * - `split`: `unactive=true` = only inactive (chargers), so «all» takes two calls;
   * - `none`: always all (custom assets).
   */
  v1Active?: 'unactive' | 'split' | 'none';
  /** v1 list returns the whole collection: page it in the client. */
  v1WholeList?: boolean;
  v2: InventoryV2;
}

export interface ListInput {
  limit: number;
  offset: number;
  activeOnly?: boolean;
}
export interface FilterInput {
  query: Json;
  limit: number;
  offset: number;
}

const inventoryPath = (cfg: ResourceConfig, id?: string | number) =>
  `/inventory/${cfg.v2.resource}${id === undefined ? '' : `/${encodeURIComponent(String(id))}`}`;

/** Response of a v2 inventory read or write, as v1 shows it. */
function fromV2(cfg: ResourceConfig) {
  return <T>(data: T): T => (cfg.v2.identifierIsName ? eachItem(data, (x) => omit(x, ['name'])) : data);
}

/** Body of a v2 inventory write, from the v1 body the user passes. */
function toV2Body(cfg: ResourceConfig, body: Json | undefined): Json {
  let out = toV2Refs(omit(body, [cfg.idField, 'clientUID']), cfg.v2.refs ?? []);
  if (cfg.v2.identifierIsName) out = renameKey(out, 'identifier', 'name');
  return out;
}

/** v1 list of one active-state selection, paged. */
async function v1ListPage(ctx: Ctx, cfg: ResourceConfig, limit: number, offset: number, unactive: boolean): Promise<Page> {
  const data = await send(ctx, 'get', cfg.basePath, {
    query: {
      [cfg.v1LimitParam ?? 'limit']: limit,
      offset,
      ...(unactive ? { unactive: true } : {}),
    },
  });
  return parseV1List(data);
}

/** id of an item, for merges and lookups. */
const idOf = (cfg: ResourceConfig, x: unknown) => Number((x as Json)?.[cfg.idField]);

function listOp(cfg: ResourceConfig): Operation<ListInput, Page> {
  return operation(`inventory.${cfg.name}.list`, {
    v1: custom(async (ctx, { limit, offset, activeOnly }) => {
      const mode = cfg.v1Active ?? 'unactive';
      if (cfg.v1WholeList) {
        const data = await send(ctx, 'get', cfg.basePath, {
          query: mode === 'unactive' && !activeOnly ? { unactive: true } : {},
        });
        let all = parseV1List(data).items;
        if (activeOnly && mode === 'none') all = all.filter((x) => (x as Json)?.active !== false);
        return pageInClient(all, limit, offset);
      }
      if (mode === 'split' && !activeOnly) {
        // `unactive=true` returns only the inactive ones: merge both lists in id
        // order (the v1 order) and cut the requested range.
        const [active, inactive] = await Promise.all([
          v1ListPage(ctx, cfg, offset + limit, 0, false),
          v1ListPage(ctx, cfg, offset + limit, 0, true),
        ]);
        const merged = [...active.items, ...inactive.items].sort((a, b) => idOf(cfg, a) - idOf(cfg, b));
        return { items: merged.slice(offset, offset + limit), total: active.total + inactive.total };
      }
      return v1ListPage(ctx, cfg, limit, offset, mode === 'unactive' && !activeOnly);
    }),
    v2: custom(async (ctx, { limit, offset, activeOnly }) => {
      const page = await v2Range(
        ctx,
        'get',
        inventoryPath(cfg),
        { sort: cfg.v2.sort, ...(activeOnly ? { active: true } : {}) },
        limit,
        offset,
      );
      return { ...page, items: fromV2(cfg)(page.items) };
    }),
  });
}

function getOp(cfg: ResourceConfig): Operation<{ id: string }, unknown> {
  return operation(`inventory.${cfg.name}.get`, {
    v1: cfg.getViaFilter
      ? custom(async (ctx, { id }) => {
          // No GET :id in v1: list everything and look it up.
          const data = await send(ctx, 'get', cfg.basePath, { query: { unactive: true } });
          const item = parseV1List(data).items.find((r) => String((r as Json)[cfg.idField]) === String(id));
          if (!item) throw new Error(`${cfg.singular} with ${cfg.idField}=${id} not found`);
          return item;
        })
      : v1('get', ({ id }) => (cfg.getPath ? cfg.getPath.replace(':id', id) : `${cfg.basePath}/${id}`)),
    v2: v2('get', ({ id }) => inventoryPath(cfg, id), { out: fromV2(cfg) }),
  });
}

function createOp(cfg: ResourceConfig): Operation<{ body: Json | undefined }, unknown> {
  return operation(`inventory.${cfg.name}.create`, {
    v1: v1('post', cfg.basePath, { body: ({ body }) => body }),
    v2: v2('post', inventoryPath(cfg), { body: ({ body }) => toV2Body(cfg, body), out: fromV2(cfg) }),
  });
}

function updateOp(cfg: ResourceConfig): Operation<{ id: string; body: Json | undefined }, unknown> {
  return operation(`inventory.${cfg.name}.update`, {
    v1: cfg.putBodyOnly
      ? // The id goes in the body; as a number so TypeORM matches the integer key.
        v1('put', cfg.basePath, { body: ({ id, body }) => ({ ...body, [cfg.idField]: numericId(id) }) })
      : v1('put', ({ id }) => `${cfg.basePath}/${id}`, { body: ({ body }) => body }),
    v2: v2('patch', ({ id }) => inventoryPath(cfg, id), { body: ({ body }) => toV2Body(cfg, body), out: fromV2(cfg) }),
  });
}

function deleteOp(cfg: ResourceConfig): Operation<{ id: string }, unknown> {
  return operation(`inventory.${cfg.name}.delete`, {
    v1: v1('delete', ({ id }) => `${cfg.basePath}/${id}`, { out: (_d, { id }) => deletedOne(id) }),
    v2: v2('delete', ({ id }) => inventoryPath(cfg, id), { out: (_d, { id }) => deletedOne(id) }),
  });
}

function deleteBatchOp(cfg: ResourceConfig): Operation<{ ids: string[] }, unknown> {
  return operation(`inventory.${cfg.name}.delete-batch`, {
    v1: v1('post', `${cfg.basePath}/${cfg.batchDeletePath}`, {
      body: ({ ids }) => ids,
      out: (data, { ids }) => deletedBatchV1(data, ids),
    }),
    v2: v2('post', `${inventoryPath(cfg)}/batch-delete`, {
      body: ({ ids }) => ({ ids: ids.map((id) => numericId(id)) }),
      out: (data, { ids }) => deletedBatchV2(data, ids),
    }),
  });
}

function filterOp(cfg: ResourceConfig): Operation<FilterInput, Page> {
  return operation(`inventory.${cfg.name}.filter`, {
    // limit/offset go in the query: the v1 controllers read them there (§0.1).
    v1: v1('post', cfg.filterPath || `${cfg.basePath}/filter`, {
      query: ({ limit, offset }) => ({ limit, offset }),
      body: ({ query }) => query,
      out: (data) => parseV1List(data),
    }),
    v2: custom(async (ctx, { query, limit, offset }) => {
      let body = omit(query, ['clientUID', 'limit', 'offset']);
      if (cfg.v2.identifierIsName) body = renameKey(body, 'identifier', 'name');
      const page = await v2Range(
        ctx,
        'post',
        `${inventoryPath(cfg)}/search`,
        cfg.v2.filterActive === false ? {} : { active: true },
        limit,
        offset,
        body,
      );
      return { ...page, items: fromV2(cfg)(page.items) };
    }),
  });
}

export interface InventoryOps {
  list: Operation<ListInput, Page>;
  get: Operation<{ id: string }, unknown>;
  create: Operation<{ body: Json | undefined }, unknown>;
  update: Operation<{ id: string; body: Json | undefined }, unknown>;
  delete: Operation<{ id: string }, unknown>;
  deleteBatch: Operation<{ ids: string[] }, unknown>;
  filter: Operation<FilterInput, Page>;
}

export function inventoryOps(cfg: ResourceConfig): InventoryOps {
  return {
    list: listOp(cfg),
    get: getOp(cfg),
    create: createOp(cfg),
    update: updateOp(cfg),
    delete: deleteOp(cfg),
    deleteBatch: deleteBatchOp(cfg),
    filter: filterOp(cfg),
  };
}

// ─── Kits, kit components, manufacturers and custom fields ────────────────

/** v1 kit body → v2 (B-70). */
export const KIT_REFS: readonly RefRule[] = [
  { from: 'kitSolarPanel', to: 'kitSolarPanelId', key: 'idKitSolarPanel' },
  { from: 'kitInverter', to: 'kitInverterId', key: 'idKitInverter' },
  { from: 'battery', to: 'batteryId', key: 'batteryId' },
  { from: 'kitCategories', to: 'kitCategoryIds', ids: 'idKitCategory' },
  { from: 'solarKitCustomAssets', to: 'customAssets', many: { ref: 'customAsset', key: 'idCustomAsset', to: 'customAssetId', keep: ['units'] } },
];

/** A whole v1 collection, or every page of the v2 one. */
function wholeList(id: string, v1Path: string, v2Path: string, v2Query: Json = {}): Operation<void, unknown[]> {
  return operation(id, {
    v1: v1('get', v1Path, { out: (data) => parseV1List(data).items }),
    v2: custom((ctx) => v2All(ctx, v2Path, v2Query)),
  });
}

const kitComponent = (name: 'panels' | 'inverters' | 'batteries', v1Base: string, v2Resource: string) => ({
  list: wholeList(`inventory.kits.${name}.list`, v1Base, `/inventory/${v2Resource}`, { sort: 'id' }),
  create: operation<{ body: Json }, unknown>(`inventory.kits.${name}.create`, {
    v1: v1('post', v1Base, { body: ({ body }) => body }),
    v2: v2('post', `/inventory/${v2Resource}`, { body: ({ body }) => omit(body, ['clientUID']) }),
  }),
  update: operation<{ id: string; body: Json }, unknown>(`inventory.kits.${name}.update`, {
    v1: v1('put', ({ id }) => `${v1Base}/${id}`, { body: ({ body }) => body }),
    v2: v2('patch', ({ id }) => `/inventory/${v2Resource}/${id}`, { body: ({ body }) => omit(body, ['clientUID']) }),
  }),
  delete: operation<{ id: string }, unknown>(`inventory.kits.${name}.delete`, {
    v1: v1('delete', ({ id }) => `${v1Base}/${id}`, { out: (_d, { id }) => deletedOne(id) }),
    v2: v2('delete', ({ id }) => `/inventory/${v2Resource}/${id}`, { out: (_d, { id }) => deletedOne(id) }),
  }),
});

export const KIT_PANELS = {
  ...kitComponent('panels', '/solar-kits/solar-panels', 'kit-panels'),
  get: operation<{ id: string }, unknown>('inventory.kits.panels.get', {
    // No GET :id in v1: the filter by id. v2 emits `data` (B-77).
    v1: v1('post', '/solar-kits/solar-panels/filter', {
      body: ({ id }) => ({ idKitSolarPanel: numericId(id) }),
      out: (data, { id }) => {
        const item = parseV1List(data).items[0];
        if (!item) throw notFound('Kit solar panel', id);
        return item;
      },
    }),
    v2: v2('get', ({ id }) => `/inventory/kit-panels/${id}`),
  }),
  featured: operation<{ id: string }, unknown>('inventory.kits.panels.featured', {
    v1: v1('get', ({ id }) => `/solar-kits/solar-panels/findFeaturedSolarKits/${id}`),
    v2: custom((ctx, { id }) => v2All(ctx, `/inventory/kit-panels/${id}/kits`)),
  }),
};

export const KIT_INVERTERS = {
  ...kitComponent('inverters', '/solar-kits/inverters', 'kit-inverters'),
  get: operation<{ id: string }, unknown>('inventory.kits.inverters.get', {
    v1: custom(async (ctx, { id }) => {
      const data = await send(ctx, 'get', '/solar-kits/inverters');
      const item = parseV1List(data).items.find((x) => String((x as Json).idKitInverter) === String(id));
      if (!item) throw notFound('Kit inverter', id);
      return item;
    }),
    v2: v2('get', ({ id }) => `/inventory/kit-inverters/${id}`),
  }),
  featured: operation<{ id: string }, unknown>('inventory.kits.inverters.featured', {
    v1: v1('get', ({ id }) => `/solar-kits/inverters/findFeaturedSolarKits/${id}`),
    v2: custom((ctx, { id }) => v2All(ctx, `/inventory/kit-inverters/${id}/kits`)),
  }),
};

export const KIT_BATTERIES = kitComponent('batteries', '/solar-kits/batteries', 'kit-batteries');

export const KITS = {
  archive: operation<{ id: string }, unknown>('inventory.kits.archive', {
    v1: v1('put', ({ id }) => `/solar-kits/archive/${id}`, { out: (_d, { id }) => ({ idSolarKit: numericId(id), active: false }) }),
    v2: v2('post', ({ id }) => `/inventory/kits/${id}/archive`, { out: (_d, { id }) => ({ idSolarKit: numericId(id), active: false }) }),
  }),
  assemble: operation<{ body: Json }, unknown>('inventory.kits.assemble', {
    v1: v1('post', '/solar-kits', { body: ({ body }) => body }),
    v2: v2('post', '/inventory/kits', { body: ({ body }) => toV2Refs(body, KIT_REFS) }),
  }),
  /** Every active kit: `studies optimize-peakpower` (B-69). */
  allActive: operation<void, unknown[]>('inventory.kits.all-active', {
    v1: v1('get', '/solar-kits', { out: (data) => parseV1List(data).items }),
    v2: custom((ctx) => v2All(ctx, '/inventory/kits', { active: true, sort: 'id' })),
  }),
};

export const MANUFACTURERS = {
  list: wholeList('inventory.manufacturers.list', '/manufacturers', '/inventory/manufacturers'),
  create: operation<{ body: Json }, unknown>('inventory.manufacturers.create', {
    v1: v1('post', '/manufacturers', { body: ({ body }) => body }),
    v2: v2('post', '/inventory/manufacturers', { body: ({ body }) => body }),
  }),
};

export const CUSTOM_FIELDS = {
  list: wholeList('inventory.custom-fields.list', '/custom-asset/custom-field/all', '/inventory/custom-fields'),
  get: operation<{ id: string }, unknown>('inventory.custom-fields.get', {
    v1: v1('get', ({ id }) => `/custom-asset/custom-field/id/${id}`),
    v2: v2('get', ({ id }) => `/inventory/custom-fields/${id}`),
  }),
  create: operation<{ body: Json | undefined }, unknown>('inventory.custom-fields.create', {
    v1: v1('post', '/custom-asset/custom-field', { body: ({ body }) => body }),
    v2: v2('post', '/inventory/custom-fields', {
      body: ({ body }) => toV2Refs(body, [{ from: 'customAssetType', to: 'customAssetTypeId', key: 'idCustomAssetType' }]),
    }),
  }),
  update: operation<{ id: string; body: Json | undefined }, unknown>('inventory.custom-fields.update', {
    v1: v1('put', ({ id }) => `/custom-asset/custom-field/${id}`, { body: ({ body }) => body }),
    v2: v2('patch', ({ id }) => `/inventory/custom-fields/${id}`, {
      body: ({ body }) =>
        toV2Refs(omit(body, ['idCustomField', 'clientUID']), [{ from: 'customAssetType', to: 'customAssetTypeId', key: 'idCustomAssetType' }]),
    }),
  }),
  delete: operation<{ id: string }, unknown>('inventory.custom-fields.delete', {
    v1: v1('delete', ({ id }) => `/custom-asset/custom-field/${id}`, { out: (_d, { id }) => deletedOne(id) }),
    v2: v2('delete', ({ id }) => `/inventory/custom-fields/${id}`, { out: (_d, { id }) => deletedOne(id) }),
  }),
};

function notFound(what: string, id: string | number): Error {
  return Object.assign(new Error(`${what} ${id} not found`), { code: 'NOT_FOUND' });
}
