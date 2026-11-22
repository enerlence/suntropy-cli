import { test } from 'node:test';
import assert from 'node:assert/strict';
import { env, fixtures, page, parity, type Case } from './parity-helpers.js';

const F = fixtures('settings');
const P = F.project;

const cases: Case[] = [
  // ─── theme (§3.1) ───
  {
    name: 'config theme get (v1 by the session clientUID, v2 the key own theme)',
    args: ['config', 'theme', 'get'],
    v1: { 'GET /security/clients/config/clientThemeByClientUID/client-1': F.theme },
    v2: { 'GET /api/v2/settings/theme': env(F.theme) },
    expectV1: [{ method: 'GET', path: '/security/clients/config/clientThemeByClientUID/client-1' }],
    expectV2: [{ method: 'GET', path: '/api/v2/settings/theme' }],
  },
  {
    name: 'config theme set (v1 POST updateTheme, v2 PATCH /settings/theme)',
    args: ['config', 'theme', 'set', '--primary', '#000000', '--set', 'idClientThemeConfig=3'],
    v1: { 'POST /security/clients/config/updateTheme': F.theme },
    v2: { 'PATCH /api/v2/settings/theme': env(F.theme) },
    expectV1: [{ method: 'POST', path: '/security/clients/config/updateTheme', body: { idClientThemeConfig: 3, primary: '#000000' } }],
    expectV2: [{ method: 'PATCH', path: '/api/v2/settings/theme', body: { primary: '#000000' } }],
  },
  // ─── solar-form config (C10–C16) ───
  {
    name: 'solarform config (public view)',
    args: ['solarform', 'config'],
    v1: { 'GET /solar/solar-form/solar-form-config': F.publicView },
    v2: { 'GET /api/v2/settings/solar-form/public-view': env(F.publicView) },
    expectV1: [{ method: 'GET', path: '/solar/solar-form/solar-form-config' }],
    expectV2: [{ method: 'GET', path: '/api/v2/settings/solar-form/public-view' }],
  },
  {
    name: 'config solarform get --with-parameters',
    args: ['config', 'solarform', 'get', '--with-parameters'],
    v1: { 'GET /solar/solar-form/get-solar-form-config': F.solarForm },
    v2: { 'GET /api/v2/settings/solar-form': env(F.solarForm) },
    expectV1: [{ method: 'GET', path: '/solar/solar-form/get-solar-form-config', query: { getParameters: 'true' } }],
    expectV2: [{ method: 'GET', path: '/api/v2/settings/solar-form', query: { includeParameters: 'true' } }],
  },
  {
    name: 'config solarform create',
    args: ['config', 'solarform', 'create', '--url', 'acme', '--form-title', 'Calcula'],
    v1: { 'POST /solar/solar-form/solar-form-config': F.solarForm },
    v2: { 'POST /api/v2/settings/solar-form': { status: 201, body: env(F.solarForm) } },
    expectV1: [{ method: 'POST', path: '/solar/solar-form/solar-form-config', body: { solarFormUrl: 'acme', enabled: true, formTitle: 'Calcula' } }],
    expectV2: [{ method: 'POST', path: '/api/v2/settings/solar-form', body: { solarFormUrl: 'acme', enabled: true, formTitle: 'Calcula' } }],
  },
  {
    name: 'config solarform update <id> (v2 PATCH with the id as identity check)',
    args: ['config', 'solarform', 'update', '12', '--form-title', 'Nuevo'],
    v1: { 'PUT /solar/solar-form/solar-form-config/12': F.solarForm },
    v2: { 'PATCH /api/v2/settings/solar-form': env(F.solarForm) },
    expectV1: [{ method: 'PUT', path: '/solar/solar-form/solar-form-config/12', body: { formTitle: 'Nuevo' } }],
    expectV2: [{ method: 'PATCH', path: '/api/v2/settings/solar-form', body: { formTitle: 'Nuevo', idSolarFormConfig: 12 } }],
  },
  {
    name: 'config solarform advanced get',
    args: ['config', 'solarform', 'advanced', 'get'],
    v1: { 'GET /solar/solar-form/config/advanced': F.advanced },
    v2: { 'GET /api/v2/settings/solar-form/advanced': env(F.advanced) },
    expectV1: [{ method: 'GET', path: '/solar/solar-form/config/advanced' }],
    expectV2: [{ method: 'GET', path: '/api/v2/settings/solar-form/advanced' }],
  },
  {
    name: 'config solarform advanced update (GET + merged PUT/PATCH)',
    args: ['config', 'solarform', 'advanced', 'update', '--set', 'coverTitle=Adios'],
    v1: { 'GET /solar/solar-form/config/advanced': F.advanced, 'PUT /solar/solar-form/config/advanced': { ...F.advanced, coverTitle: 'Adios' } },
    v2: { 'GET /api/v2/settings/solar-form/advanced': env(F.advanced), 'PATCH /api/v2/settings/solar-form/advanced': env({ ...F.advanced, coverTitle: 'Adios' }) },
    expectV1: [{ method: 'GET', path: '/solar/solar-form/config/advanced' }, { method: 'PUT', path: '/solar/solar-form/config/advanced', body: { ...F.advanced, coverTitle: 'Adios' } }],
    expectV2: [
      { method: 'GET', path: '/api/v2/settings/solar-form/advanced' },
      { method: 'PATCH', path: '/api/v2/settings/solar-form/advanced', body: { ...F.advanced, coverTitle: 'Adios' } },
    ],
  },
  {
    name: 'config solarform advanced general get (section)',
    args: ['config', 'solarform', 'advanced', 'general', 'get'],
    v1: { 'GET /solar/solar-form/config/advanced': F.advanced },
    v2: { 'GET /api/v2/settings/solar-form/advanced': env(F.advanced) },
    expectV1: [{ method: 'GET', path: '/solar/solar-form/config/advanced' }],
    expectV2: [{ method: 'GET', path: '/api/v2/settings/solar-form/advanced' }],
  },
  {
    name: 'config solarform advanced delete → { success: true }',
    args: ['config', 'solarform', 'advanced', 'delete'],
    v1: { 'DELETE /solar/solar-form/config/advanced': { raw: [], affected: 1 } },
    v2: { 'DELETE /api/v2/settings/solar-form/advanced': { status: 204 } },
    expectV1: [{ method: 'DELETE', path: '/solar/solar-form/config/advanced' }],
    expectV2: [{ method: 'DELETE', path: '/api/v2/settings/solar-form/advanced' }],
    check: (o) => assert.deepEqual(o, { success: true }),
  },
  // ─── solar-form estimates (C8, C9) ───
  {
    name: 'solarform simple --email --kit-id (v1 PublicApiResponse, v2 { data } 201)',
    args: ['solarform', 'simple', '--region', 'Andalucía', '--sub-region', 'Sevilla', '--consumption', '5000', '--email', 'a@b.es', '--kit-id', '7', '--raw'],
    v1: { 'POST /solar/api/solar-form/simple': { code: 200, data: F.estimate } },
    v2: { 'POST /api/v2/solar-form/estimates/simple': { status: 201, body: env(F.estimate) } },
    expectV1: [{ method: 'POST', path: '/solar/api/solar-form/simple', query: { email: 'a@b.es', solarKitId: '7' } }],
    expectV2: [
      {
        method: 'POST',
        path: '/api/v2/solar-form/estimates/simple',
        query: { email: 'a@b.es', solarKitId: '7' },
        body: { region: 'Andalucía', subRegion: 'Sevilla', selectedConsumptionPattern: 'Balance', consumptionQuantity: 5000, consumptionQuantityIntroductionMode: 'monthlyConsumption' },
      },
    ],
  },
  {
    name: 'solarform calculate',
    args: ['solarform', 'calculate', '--data', '{"center":{"lat":37.4,"lng":-5.9},"consumptionMode":"consumptionPatterns","locationMode":"locationOnly"}', '--raw'],
    v1: { 'POST /solar/api/solar-form': { code: 200, data: F.estimate } },
    v2: { 'POST /api/v2/solar-form/estimates': { status: 201, body: env(F.estimate) } },
    expectV1: [{ method: 'POST', path: '/solar/api/solar-form' }],
    expectV2: [{ method: 'POST', path: '/api/v2/solar-form/estimates', body: { center: { lat: 37.4, lng: -5.9 }, consumptionMode: 'consumptionPatterns', locationMode: 'locationOnly' } }],
  },
  // ─── projects (C1–C7) ───
  {
    name: 'projects list (v2 walks pages)',
    args: ['projects', 'list'],
    v1: { 'GET /solar/api/alexandria-projects': F.projects },
    v2: { 'GET /api/v2/projects': page(F.projects, 2, 100, 0) },
    expectV1: [{ method: 'GET', path: '/solar/api/alexandria-projects' }],
    expectV2: [{ method: 'GET', path: '/api/v2/projects', query: { limit: '100', offset: '0' } }],
  },
  {
    name: 'projects get',
    args: ['projects', 'get', '5'],
    v1: { 'GET /solar/api/alexandria-projects/5': P },
    v2: { 'GET /api/v2/projects/5': env(P) },
    expectV1: [{ method: 'GET', path: '/solar/api/alexandria-projects/5' }],
    expectV2: [{ method: 'GET', path: '/api/v2/projects/5' }],
  },
  {
    name: 'projects files list',
    args: ['projects', 'files', 'list', '5'],
    v1: { 'GET /solar/api/alexandria-projects/5': P },
    v2: { 'GET /api/v2/projects/5': env(P) },
    expectV1: [{ method: 'GET', path: '/solar/api/alexandria-projects/5' }],
    expectV2: [{ method: 'GET', path: '/api/v2/projects/5' }],
    check: (o) => assert.deepEqual(o, P.files),
  },
  {
    name: 'projects create',
    args: ['projects', 'create', '--name', 'Obra', '--visibility', 'client'],
    v1: { 'POST /solar/api/alexandria-projects': P },
    v2: { 'POST /api/v2/projects': { status: 201, body: env(P) } },
    expectV1: [{ method: 'POST', path: '/solar/api/alexandria-projects', body: { name: 'Obra', visibility: 'CLIENT' } }],
    expectV2: [{ method: 'POST', path: '/api/v2/projects', body: { name: 'Obra', visibility: 'CLIENT' } }],
  },
  {
    name: 'projects update (PUT → PATCH)',
    args: ['projects', 'update', '5', '--description', 'nueva'],
    v1: { 'PUT /solar/api/alexandria-projects/5': P },
    v2: { 'PATCH /api/v2/projects/5': env(P) },
    expectV1: [{ method: 'PUT', path: '/solar/api/alexandria-projects/5', body: { description: 'nueva' } }],
    expectV2: [{ method: 'PATCH', path: '/api/v2/projects/5', body: { description: 'nueva' } }],
  },
  {
    name: 'projects delete',
    args: ['projects', 'delete', '5'],
    v1: { 'DELETE /solar/api/alexandria-projects/5': { ok: true } },
    v2: { 'DELETE /api/v2/projects/5': { status: 204 } },
    expectV1: [{ method: 'DELETE', path: '/solar/api/alexandria-projects/5' }],
    expectV2: [{ method: 'DELETE', path: '/api/v2/projects/5' }],
    check: (o) => assert.deepEqual(o, { deleted: true, id: 5 }),
  },
  {
    name: 'projects files add (JSON in both)',
    args: ['projects', 'files', 'add', '5', '--name', 'plano.pdf', '--url', 'https://documents.enerlence.com/f/9', '--size', '10'],
    v1: { 'POST /solar/api/alexandria-projects/5/files': F.file },
    v2: { 'POST /api/v2/projects/5/files': { status: 201, body: env(F.file) } },
    expectV1: [{ method: 'POST', path: '/solar/api/alexandria-projects/5/files', body: { name: 'plano.pdf', url: 'https://documents.enerlence.com/f/9', size: 10 } }],
    expectV2: [{ method: 'POST', path: '/api/v2/projects/5/files', body: { name: 'plano.pdf', url: 'https://documents.enerlence.com/f/9', size: 10 } }],
  },
  {
    name: 'projects files remove',
    args: ['projects', 'files', 'remove', '5', '9'],
    v1: { 'DELETE /solar/api/alexandria-projects/5/files/9': { ok: true } },
    v2: { 'DELETE /api/v2/projects/5/files/9': { status: 204 } },
    expectV1: [{ method: 'DELETE', path: '/solar/api/alexandria-projects/5/files/9' }],
    expectV2: [{ method: 'DELETE', path: '/api/v2/projects/5/files/9' }],
    check: (o) => assert.deepEqual(o, { removed: true, projectId: 5, fileId: 9 }),
  },
  // ─── shares (C17), templates and geocoding ───
  {
    name: 'shareables create --link-params (v1 in the URL, v2 linkParams object)',
    args: ['shareables', 'create', '--element-id', '665000000000000000000001', '--name', 'Para Ana', '--link-params', 'utm_source=cli&b=2'],
    v1: { 'POST /templates/shareable': F.shareable },
    v2: { 'POST /api/v2/shares': { status: 201, body: env(F.shareable) } },
    expectV1: [{ method: 'POST', path: '/templates/shareable', query: { utm_source: 'cli', b: '2' } }],
    expectV2: [
      {
        method: 'POST',
        path: '/api/v2/shares',
        body: { elementId: '665000000000000000000001', elementType: 'solarStudy', shareableType: 'TEMPLATE', privacy: 'PUBLIC', name: 'Para Ana', linkParams: { utm_source: 'cli', b: '2' } },
      },
    ],
  },
  {
    name: 'templates list',
    args: ['templates', 'list', '--type', 'veChargerStudy'],
    v1: { 'GET /solar/api/templates': F.templates },
    v2: { 'GET /api/v2/templates': env(F.templates) },
    expectV1: [{ method: 'GET', path: '/solar/api/templates', query: { templateIdentifier: 'veChargerStudy' } }],
    expectV2: [{ method: 'GET', path: '/api/v2/templates', query: { templateIdentifier: 'veChargerStudy' } }],
  },
  {
    name: 'geocode resolve',
    args: ['geocode', 'resolve', '--address', 'Calle Mayor 1, Madrid'],
    v1: { 'GET /solar/api/geocode': { code: 200, data: F.geocode } },
    v2: { 'GET /api/v2/reference/geocode': env(F.geocode) },
    expectV1: [{ method: 'GET', path: '/solar/api/geocode', query: { address: 'Calle Mayor 1, Madrid' } }],
    expectV2: [{ method: 'GET', path: '/api/v2/reference/geocode', query: { address: 'Calle Mayor 1, Madrid' } }],
    check: (o) => assert.equal(o.lat, 40.41),
  },
  {
    name: 'geocode reverse --all',
    args: ['geocode', 'reverse', '--lat', '40.41', '--lng', '-3.7', '--all'],
    v1: { 'GET /solar/api/reverse-geocode': { code: 200, data: F.geocode } },
    v2: { 'GET /api/v2/reference/reverse-geocode': env(F.geocode) },
    expectV1: [{ method: 'GET', path: '/solar/api/reverse-geocode', query: { lat: '40.41', lng: '-3.7' } }],
    expectV2: [{ method: 'GET', path: '/api/v2/reference/reverse-geocode', query: { lat: '40.41', lng: '-3.7' } }],
  },
];

for (const c of cases) test(c.name, () => parity(c).then(() => undefined));

test('config theme get --client-uid of another account with a sun_ key: CLIENT_UID_MISMATCH before reading', async () => {
  const { v2 } = await parity({
    name: 'mismatch',
    args: ['config', 'theme', 'get', '--client-uid', 'other'],
    v1: { 'GET /security/clients/config/clientThemeByClientUID/other': { status: 403, body: {} } },
    v2: { 'GET /api/v2/me': env({ clientUID: 'client-1', keyId: 'k', scopes: [] }) },
    expectV1: [{ method: 'GET', path: '/security/clients/config/clientThemeByClientUID/other' }],
    expectV2: [{ method: 'GET', path: '/api/v2/me' }],
    code: 1,
  });
  assert.equal(JSON.parse(v2.stderr.trim()).code, 'CLIENT_UID_MISMATCH');
  assert.ok(!v2.requests.some((r) => r.url.startsWith('/api/v2/settings')));
});

test('v1-only commands (§4) refuse a sun_ key with V2_KEY_NOT_SUPPORTED', async () => {
  for (const args of [
    ['config', 'solarform', 'advanced', 'init-default', '--client-uid', 'c'],
    ['solarform', 'statistics', '--create'],
    ['solarform', 'statistics', '--update', '--data', '{}'],
  ]) {
    const { v2 } = await parity({ name: args.join(' '), args, v1: {}, v2: {}, expectV1: [], expectV2: [], code: 1 });
    assert.equal(JSON.parse(v2.stderr.trim()).code, 'V2_KEY_NOT_SUPPORTED', args.join(' '));
    assert.equal(v2.requests.length, 0);
  }
});
