import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env, fixtures, page, parity, type Case } from './parity-helpers.js';
import { runCli, tempHome } from './helpers.js';

const F = fixtures('studies');
const SID = F.study._id;
const FIND = '/solar/solar-study/findWithPaginationAndFilters';
const DIR = mkdtempSync(join(tmpdir(), 'suntropy-parity-'));
const BASE_STUDY = join(DIR, 'base.json');
const STUDY = join(DIR, 'study.json');
const ZIP = join(DIR, 'consumo.zip');
writeFileSync(ZIP, 'PK\u0003\u0004fake');

before(async () => {
  const r = await runCli(['studies', 'init', '--file', BASE_STUDY, '--name', 'Parity'], { HOME: tempHome() });
  assert.equal(r.code, 0, r.stderr);
});
/** A fresh copy of the same local study for each run. */
const freshStudy = (patch: Record<string, unknown> = {}) => () => {
  copyFileSync(BASE_STUDY, STUDY);
  if (Object.keys(patch).length) writeFileSync(STUDY, JSON.stringify({ ...JSON.parse(readFileSync(STUDY, 'utf-8')), ...patch }));
};

const year = new Date().getFullYear();

const cases: Case[] = [
  {
    name: 'studies list --state --from --to --client-name (v1 corrected: query paging, states, dates)',
    args: ['studies', 'list', '--state', 'ganado', '--client-name', 'Ana', '--from', '2026-01-01', '--to', '2026-06-30'],
    v1: {
      'GET /solar/solar-study/states': F.states,
      [`POST ${FIND}`]: (req: any) =>
        String(req.body?.creationTimestamp?.date).includes('23:59:59') ? [[F.metadata[0]], 2] : [F.metadata, 4],
    },
    v2: { 'GET /api/v2/studies/solar': page(F.metadata, 2, 20, 0) },
    expectV1: [
      { method: 'GET', path: '/solar/solar-study/states' },
      {
        method: 'POST',
        path: FIND,
        query: { limit: '1', offset: '0' },
        body: { closed: false, won: false, clientName: 'Ana', states: [{ idSolarStudyMetadataState: 4 }], creationTimestamp: { date: '2026-06-30 23:59:59.999', operator: 'after' } },
      },
      {
        method: 'POST',
        path: FIND,
        query: { limit: '20', offset: '2' },
        body: { closed: false, won: false, clientName: 'Ana', states: [{ idSolarStudyMetadataState: 4 }], creationTimestamp: { date: '2026-01-01', operator: 'after' } },
      },
    ],
    expectV2: [
      {
        method: 'GET',
        path: '/api/v2/studies/solar',
        query: { limit: '20', offset: '0', state: 'ganado', clientName: 'Ana', from: '2026-01-01', to: '2026-06-30', closed: 'false', won: 'false' },
      },
    ],
    check: (o) => {
      assert.equal(o.total, 2);
      assert.deepEqual(Object.keys(o.data[0]).sort(), ['anualConsumption', 'anualProduction', 'clientName', 'creationTimestamp', 'currentState', 'idSolarStudyMetadata', 'peakPower', 'sellingPrice', 'solarStudyId', 'totalCost'].sort());
    },
  },
  {
    name: 'studies list with an unknown state: empty in both',
    args: ['studies', 'list', '--state', 'nope'],
    v1: { 'GET /solar/solar-study/states': F.states },
    v2: { 'GET /api/v2/studies/solar': page([], 0, 20, 0) },
    expectV1: [{ method: 'GET', path: '/solar/solar-study/states' }],
    expectV2: [{ method: 'GET', path: '/api/v2/studies/solar', query: { state: 'nope' } }],
    check: (o) => assert.deepEqual(o, { data: [], total: 0, limit: 20, offset: 0, hasMore: false }),
  },
  {
    name: 'studies metadata <id>',
    args: ['studies', 'metadata', '1'],
    v1: { 'GET /solar/solar-study/findSolarStudyMetadataById/1': F.metadata[0] },
    v2: { 'GET /api/v2/study-metadata/1': env(F.metadata[0]) },
    expectV1: [{ method: 'GET', path: '/solar/solar-study/findSolarStudyMetadataById/1' }],
    expectV2: [{ method: 'GET', path: '/api/v2/study-metadata/1' }],
  },
  {
    name: 'studies metadata --by-study-id',
    args: ['studies', 'metadata', SID, '--by-study-id'],
    v1: { [`GET /solar/solar-study/metadata/solar-study-id/${SID}`]: F.metadata[0] },
    v2: { [`GET /api/v2/studies/solar/${SID}/metadata`]: env(F.metadata[0]) },
    expectV1: [{ method: 'GET', path: `/solar/solar-study/metadata/solar-study-id/${SID}` }],
    expectV2: [{ method: 'GET', path: `/api/v2/studies/solar/${SID}/metadata` }],
  },
  {
    name: 'studies get --expand all',
    args: ['studies', 'get', SID, '--expand', 'all'],
    v1: { [`GET /solar/solar-study/findById/${SID}`]: F.study },
    v2: { [`GET /api/v2/studies/solar/${SID}`]: env(F.study) },
    expectV1: [{ method: 'GET', path: `/solar/solar-study/findById/${SID}` }],
    expectV2: [{ method: 'GET', path: `/api/v2/studies/solar/${SID}` }],
    check: (o) => assert.deepEqual(o, F.study),
  },
  {
    name: 'studies get: not found (v1 empty body, v2 404) fails in both',
    args: ['studies', 'get', SID],
    v1: { [`GET /solar/solar-study/findById/${SID}`]: '' },
    v2: { [`GET /api/v2/studies/solar/${SID}`]: { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Study not found' } } } },
    expectV1: [{ method: 'GET', path: `/solar/solar-study/findById/${SID}` }],
    expectV2: [{ method: 'GET', path: `/api/v2/studies/solar/${SID}` }],
    code: 1,
  },
  {
    name: 'studies curves (reads the study)',
    args: ['studies', 'curves', SID, 'consumption', '--total'],
    v1: { [`GET /solar/solar-study/findById/${SID}`]: F.study },
    v2: { [`GET /api/v2/studies/solar/${SID}`]: env(F.study) },
    expectV1: [{ method: 'GET', path: `/solar/solar-study/findById/${SID}` }],
    expectV2: [{ method: 'GET', path: `/api/v2/studies/solar/${SID}` }],
  },
  {
    name: 'studies pull',
    args: ['studies', 'pull', SID, '--file', STUDY],
    v1: { [`GET /solar/solar-study/findById/${SID}`]: F.study },
    v2: { [`GET /api/v2/studies/solar/${SID}`]: env(F.study) },
    expectV1: [{ method: 'GET', path: `/solar/solar-study/findById/${SID}` }],
    expectV2: [{ method: 'GET', path: `/api/v2/studies/solar/${SID}` }],
  },
  {
    name: 'studies calculate-production',
    args: ['studies', 'calculate-production', '--lat', '37.4', '--lon', '-5.9', '--power', '5000', '--year', '2026'],
    v1: { 'POST /solar/solar-study/calculateProduction': F.curve },
    v2: { 'POST /api/v2/calculations/solar-production': env(F.curve) },
    expectV1: [{ method: 'POST', path: '/solar/solar-study/calculateProduction', body: { lat: 37.4, long: -5.9, instaledPower: 5000, angle: 30, azimuth: 180, lossesPercentage: 14, year: 2026, isOptimized: false } }],
    expectV2: [{ method: 'POST', path: '/api/v2/calculations/solar-production', body: { lat: 37.4, long: -5.9, instaledPower: 5000, angle: 30, azimuth: 180, lossesPercentage: 14, year: 2026, isOptimized: false } }],
  },
  {
    name: 'studies optimize-surfaces',
    args: ['studies', 'optimize-surfaces', '--lat', '37.4', '--lon', '-5.9'],
    v1: { 'GET /solar/solar-study/optimizeSurfaces': F.angles },
    v2: { 'GET /api/v2/calculations/optimal-angles': env(F.angles) },
    expectV1: [{ method: 'GET', path: '/solar/solar-study/optimizeSurfaces', query: { lat: '37.4', lon: '-5.9' } }],
    expectV2: [{ method: 'GET', path: '/api/v2/calculations/optimal-angles', query: { lat: '37.4', lon: '-5.9' } }],
  },
  {
    name: 'studies save of a new study: v1 POST /solar-study, v2 POST /studies/solar',
    args: ['studies', 'save', '--file', STUDY, '--state-id', '4'],
    prepare: freshStudy(),
    v1: { 'POST /solar/solar-study': F.metadata[0] },
    v2: { 'POST /api/v2/studies/solar': { status: 201, body: env(F.metadata[0]) } },
    expectV1: [{ method: 'POST', path: '/solar/solar-study', query: { idSolarStudyState: '4' } }],
    expectV2: [{ method: 'POST', path: '/api/v2/studies/solar', query: { idSolarStudyState: '4', saveAsNew: null } }],
    check: (o) => assert.deepEqual(o.metadata, F.metadata[0]),
  },
  {
    name: 'studies save of an existing study: v2 PUT /studies/solar/:id, --credit-amount not sent',
    args: ['studies', 'save', '--file', STUDY, '--state-id', '4', '--credit-amount', '2'],
    prepare: freshStudy({ _id: SID }),
    v1: { 'POST /solar/solar-study': F.metadata[0] },
    v2: { [`PUT /api/v2/studies/solar/${SID}`]: env(F.metadata[0]) },
    expectV1: [{ method: 'POST', path: '/solar/solar-study', query: { idSolarStudyState: '4', creditAmount: '2' } }],
    expectV2: [{ method: 'PUT', path: `/api/v2/studies/solar/${SID}`, query: { stateId: '4', creditAmount: null } }],
  },
  {
    name: 'studies save --save-as-new: v2 POST with saveAsNew=true and no _id',
    args: ['studies', 'save', '--file', STUDY, '--save-as-new'],
    prepare: freshStudy({ _id: SID }),
    v1: { 'POST /solar/solar-study': F.metadata[1] },
    v2: { 'POST /api/v2/studies/solar': { status: 201, body: env(F.metadata[1]) } },
    expectV1: [{ method: 'POST', path: '/solar/solar-study', query: { saveAsNew: 'true' } }],
    expectV2: [{ method: 'POST', path: '/api/v2/studies/solar', query: { saveAsNew: 'true' } }],
  },
  {
    name: 'studies comment (v2 without a person: no creationUserUID)',
    args: ['studies', 'comment', SID, '--content', 'Revisado'],
    v1: { [`POST /solar/solar-study/addSolarStudyComment/${SID}`]: F.study },
    v2: { [`POST /api/v2/studies/solar/${SID}/comments`]: { status: 201, body: env(F.study) } },
    expectV1: [{ method: 'POST', path: `/solar/solar-study/addSolarStudyComment/${SID}` }],
    expectV2: [{ method: 'POST', path: `/api/v2/studies/solar/${SID}/comments` }],
    // §1.8.1: authorship differs (cli-agent / the key); the timestamp is the run's.
    normalize: (o) => ({ ...o, comment: { ...o.comment, creationUserUID: undefined, creationTimestamp: undefined } }),
    check: (o) => assert.equal(o.commentsCount, 1),
  },
  {
    name: 'studies comment --as-alexandria keeps the author in both',
    args: ['studies', 'comment', SID, '--content', 'Hecho', '--as-alexandria'],
    v1: { [`POST /solar/solar-study/addSolarStudyComment/${SID}`]: F.study },
    v2: { [`POST /api/v2/studies/solar/${SID}/comments`]: { status: 201, body: env(F.study) } },
    expectV1: [{ method: 'POST', path: `/solar/solar-study/addSolarStudyComment/${SID}` }],
    expectV2: [{ method: 'POST', path: `/api/v2/studies/solar/${SID}/comments` }],
    normalize: (o) => ({ ...o, comment: { ...o.comment, creationTimestamp: undefined } }),
    check: (o) => assert.equal(o.comment.creationUserUID, 'alexandria'),
  },
  {
    name: 'studies set tariff (v1 corrected: pais)',
    args: ['studies', 'set', 'tariff', '--file', STUDY, '--tariff-id', '13', '--market', 'pt'],
    prepare: freshStudy(),
    v1: { 'GET /periods/tarifas-atr': F.tariffs, 'GET /periods/zonas': F.zones },
    v2: { 'GET /api/v2/reference/tariffs': env(F.tariffs), 'GET /api/v2/reference/zones': env(F.zones) },
    expectV1: [
      { method: 'GET', path: '/periods/tarifas-atr', query: { pais: 'pt', market: null } },
      { method: 'GET', path: '/periods/zonas', query: { market: 'pt' } },
    ],
    expectV2: [
      { method: 'GET', path: '/api/v2/reference/tariffs', query: { market: 'pt' } },
      { method: 'GET', path: '/api/v2/reference/zones', query: { market: 'pt' } },
    ],
  },
  {
    name: 'studies set consumption --annual --pattern',
    args: ['studies', 'set', 'consumption', '--file', STUDY, '--annual', '4000', '--pattern', 'Balance', '--tariff', '2.0TD'],
    prepare: freshStudy(),
    v1: { 'POST /profiles/consumption-estimation': F.curve },
    v2: { 'POST /api/v2/calculations/consumption-estimation': env(F.curve) },
    expectV1: [{ method: 'POST', path: '/profiles/consumption-estimation', query: { anualConsumption: '4000', consumptionType: 'Balance', tariff: '2.0TD', type: 'Final' }, body: {} }],
    expectV2: [
      {
        method: 'POST',
        path: '/api/v2/calculations/consumption-estimation',
        body: { startDate: `${year}-01-01`, endDate: `${year}-12-31`, tariff: '2.0TD', type: 'Final', market: 'es', consumptionType: 'Balance', annualConsumption: 4000 },
      },
    ],
  },
  {
    name: 'studies set panel',
    args: ['studies', 'set', 'panel', '--file', STUDY, '--panel-id', '456'],
    prepare: freshStudy(),
    v1: { 'GET /solar/solar-panels/456': F.panel },
    v2: { 'GET /api/v2/inventory/panels/456': env(F.panel) },
    expectV1: [{ method: 'GET', path: '/solar/solar-panels/456' }],
    expectV2: [{ method: 'GET', path: '/api/v2/inventory/panels/456' }],
  },
  {
    name: 'studies set kit (v1 lists the kits, v2 GET :id)',
    args: ['studies', 'set', 'kit', '--file', STUDY, '--kit-id', '7'],
    prepare: freshStudy(),
    v1: { 'GET /solar/solar-kits': [F.kit] },
    v2: { 'GET /api/v2/inventory/kits/7': env(F.kit) },
    expectV1: [{ method: 'GET', path: '/solar/solar-kits', query: { unactive: 'true' } }],
    expectV2: [{ method: 'GET', path: '/api/v2/inventory/kits/7' }],
    check: () => assert.deepEqual(JSON.parse(readFileSync(STUDY, 'utf-8')).solarKit, F.kit),
  },
  {
    name: 'studies set inverter',
    args: ['studies', 'set', 'inverter', '--file', STUDY, '--inverter-id', '3,3'],
    prepare: freshStudy(),
    v1: { 'GET /solar/solar-inverter/3': { idInverter: 3 } },
    v2: { 'GET /api/v2/inventory/inverters/3': env({ idInverter: 3 }) },
    expectV1: [{ method: 'GET', path: '/solar/solar-inverter/3' }, { method: 'GET', path: '/solar/solar-inverter/3' }],
    expectV2: [{ method: 'GET', path: '/api/v2/inventory/inverters/3' }, { method: 'GET', path: '/api/v2/inventory/inverters/3' }],
  },
  {
    name: 'studies set custom-assets',
    args: ['studies', 'set', 'custom-assets', '--file', STUDY, '--asset', '9:2'],
    prepare: freshStudy(),
    v1: { 'GET /solar/custom-asset/id/9': { idCustomAsset: 9, label: 'X' } },
    v2: { 'GET /api/v2/inventory/custom-assets/9': env({ idCustomAsset: 9, label: 'X' }) },
    expectV1: [{ method: 'GET', path: '/solar/custom-asset/id/9' }],
    expectV2: [{ method: 'GET', path: '/api/v2/inventory/custom-assets/9' }],
  },
  {
    name: 'ppa templates list (v2 walks pages)',
    args: ['ppa', 'templates', 'list'],
    v1: { 'GET /solar/solar-study/ppa-templates': F.ppaTemplates },
    v2: { 'GET /api/v2/ppa-templates': page(F.ppaTemplates, 2, 100, 0) },
    expectV1: [{ method: 'GET', path: '/solar/solar-study/ppa-templates' }],
    expectV2: [{ method: 'GET', path: '/api/v2/ppa-templates', query: { limit: '100', offset: '0' } }],
  },
  {
    name: 'ppa templates get',
    args: ['ppa', 'templates', 'get', F.ppaTemplates[0]._id],
    v1: { [`GET /solar/solar-study/ppa-templates/${F.ppaTemplates[0]._id}`]: F.ppaTemplates[0] },
    v2: { [`GET /api/v2/ppa-templates/${F.ppaTemplates[0]._id}`]: env(F.ppaTemplates[0]) },
    expectV1: [{ method: 'GET', path: `/solar/solar-study/ppa-templates/${F.ppaTemplates[0]._id}` }],
    expectV2: [{ method: 'GET', path: `/api/v2/ppa-templates/${F.ppaTemplates[0]._id}` }],
  },
  {
    name: 'ppa calculate --study --template (v1 { data }, v2 { study })',
    args: ['ppa', 'calculate', '--study', SID, '--template', F.ppaTemplates[0]._id],
    v1: { [`GET /solar/solar-study/findById/${SID}`]: F.study, 'POST /solar/solar-study/calculate-ppa-on-study': F.study },
    v2: { [`GET /api/v2/studies/solar/${SID}`]: env(F.study), 'POST /api/v2/calculations/ppa': env(F.study) },
    expectV1: [{ method: 'POST', path: '/solar/solar-study/calculate-ppa-on-study', body: { data: F.study, ppaTemplateId: F.ppaTemplates[0]._id } }],
    expectV2: [{ method: 'POST', path: '/api/v2/calculations/ppa', body: { study: F.study, ppaTemplateId: F.ppaTemplates[0]._id } }],
  },
  {
    name: 'consumption estimate (v1 query + body, v2 one body)',
    args: ['consumption', 'estimate', '--annual', '5000', '--monthly-data', '{"1":300}', '--start-date', '2026-01-01', '--end-date', '2026-12-31'],
    v1: { 'POST /profiles/consumption-estimation': F.curve },
    v2: { 'POST /api/v2/calculations/consumption-estimation': env(F.curve) },
    expectV1: [{ method: 'POST', path: '/profiles/consumption-estimation', query: { anualConsumption: '5000', tariff: '3.0TD', startDate: '2026-01-01' }, body: { consumptionByMonth: { 1: 300 } } }],
    expectV2: [
      {
        method: 'POST',
        path: '/api/v2/calculations/consumption-estimation',
        body: { startDate: '2026-01-01', endDate: '2026-12-31', tariff: '3.0TD', type: 'Final', market: 'es', consumptionByMonth: { 1: 300 }, annualConsumption: 5000 },
      },
    ],
  },
  {
    name: 'consumption ree-profiles',
    args: ['consumption', 'ree-profiles', '--start', '2026-01-01', '--end', '2026-12-31', '--tariff', '2.0TD'],
    v1: { 'GET /profiles/ree-profiles': F.reeProfiles },
    v2: { 'GET /api/v2/reference/ree-profiles': env(F.reeProfiles) },
    expectV1: [{ method: 'GET', path: '/profiles/ree-profiles', query: { startDate: '2026-01-01', tariff: '2.0TD', type: 'Final', market: 'es' } }],
    expectV2: [{ method: 'GET', path: '/api/v2/reference/ree-profiles', query: { startDate: '2026-01-01', endDate: '2026-12-31', tariff: '2.0TD', type: 'Final', market: 'es' } }],
  },
  {
    name: 'consumption custom-tags (v1 corrected: clientId)',
    args: ['consumption', 'custom-tags'],
    v1: { 'GET /profiles/custom-profiles/getTags': F.tags },
    v2: { 'GET /api/v2/reference/custom-profiles/tags': env(F.tags) },
    expectV1: [{ method: 'GET', path: '/profiles/custom-profiles/getTags', query: { clientId: 'client-1' } }],
    expectV2: [{ method: 'GET', path: '/api/v2/reference/custom-profiles/tags' }],
  },
  {
    name: 'consumption custom-profile-info (v1 corrected: clientId + filter by id)',
    args: ['consumption', 'custom-profile-info', '--id', 'cp-2'],
    v1: { 'GET /profiles/custom-profiles/getInfo': F.customProfiles },
    v2: { 'GET /api/v2/reference/custom-profiles': env([F.customProfiles[1]]) },
    expectV1: [{ method: 'GET', path: '/profiles/custom-profiles/getInfo', query: { clientId: 'client-1', id: null } }],
    expectV2: [{ method: 'GET', path: '/api/v2/reference/custom-profiles', query: { id: 'cp-2' } }],
    check: (o) => assert.deepEqual(o, [F.customProfiles[1]]),
  },
  {
    name: 'consumption periods',
    args: ['consumption', 'periods', '--tariff-id', '13', '--zone-id', '1', '--start', '2026-01-01', '--end', '2026-12-31'],
    v1: { 'GET /periods/periodos': F.periods },
    v2: { 'GET /api/v2/reference/periods': env(F.periods) },
    expectV1: [{ method: 'GET', path: '/periods/periodos', query: { idTarifa: '13', idZona: '1', fechaInicio: '2026-01-01', fechaFin: '2026-12-31', market: 'es' } }],
    expectV2: [{ method: 'GET', path: '/api/v2/reference/periods', query: { tariffId: '13', zoneId: '1', startDate: '2026-01-01', endDate: '2026-12-31', market: 'es' } }],
  },
  {
    name: 'consumption from-file --eredes-zip (multipart in both)',
    args: ['consumption', 'from-file', '--eredes-zip', ZIP],
    v1: { 'POST /profiles/consumption-files-processor/portugal/eredes-zip': F.curve },
    v2: { 'POST /api/v2/calculations/consumption-files/eredes-zip': env(F.curve) },
    expectV1: [{ method: 'POST', path: '/profiles/consumption-files-processor/portugal/eredes-zip' }],
    expectV2: [{ method: 'POST', path: '/api/v2/calculations/consumption-files/eredes-zip' }],
  },
  {
    name: 'notifications send',
    args: ['notifications', 'send', '--to-user', 'u2', '--message', 'Listo', '--as-alexandria'],
    v1: { 'POST /notifications/notifications': F.notification },
    v2: { 'POST /api/v2/notifications': { status: 201, body: env(F.notification) } },
    expectV1: [{ method: 'POST', path: '/notifications/notifications' }],
    expectV2: [{ method: 'POST', path: '/api/v2/notifications' }],
    check: (o) => assert.deepEqual(o, { sent: true, notificationId: 31, toUser: 'u2', type: 'new_comment', severity: 'info' }),
  },
  {
    name: 'notifications send, disabled for the client: v1 string, v2 422 → same output, exit 0',
    args: ['notifications', 'send', '--to-user', 'u2', '--message', 'Listo'],
    v1: { 'POST /notifications/notifications': 'NOTIFICATIONS_DISABLED_FOR_CLIENT' },
    v2: { 'POST /api/v2/notifications': { status: 422, body: { error: { code: 'NOTIFICATIONS_DISABLED_FOR_CLIENT', message: 'disabled' } } } },
    expectV1: [{ method: 'POST', path: '/notifications/notifications' }],
    expectV2: [{ method: 'POST', path: '/api/v2/notifications' }],
    check: (o) => assert.deepEqual(o, { sent: false, reason: 'NOTIFICATIONS_DISABLED_FOR_CLIENT', toUser: 'u2' }),
  },
];

for (const c of cases) test(c.name, () => parity(c).then(() => undefined));

test('a v2 error keeps code, message and status on stderr; stdout stays empty', async () => {
  const { v2 } = await parity({
    name: 'v2 error',
    args: ['studies', 'metadata', '99'],
    v1: { 'GET /solar/solar-study/findSolarStudyMetadataById/99': { status: 404, body: { statusCode: 404, message: 'Not Found' } } },
    v2: { 'GET /api/v2/study-metadata/99': { status: 404, body: { error: { code: 'NOT_FOUND', message: 'Study metadata not found' }, requestId: 'r' } } },
    expectV1: [{ method: 'GET', path: '/solar/solar-study/findSolarStudyMetadataById/99' }],
    expectV2: [{ method: 'GET', path: '/api/v2/study-metadata/99' }],
    code: 1,
  });
  assert.equal(v2.stdout, '');
  const err = JSON.parse(v2.stderr.trim());
  assert.equal(err.code, 'NOT_FOUND');
  assert.equal(err.message, 'Study metadata not found');
  assert.equal(err.status, 404);
});
