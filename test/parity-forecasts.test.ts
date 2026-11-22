import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { env, parity } from './parity-helpers.js';

// A daily series: `curves forecast` accepts [period, value] pairs.
const dir = mkdtempSync(join(tmpdir(), 'forecast-'));
const input = join(dir, 'series.json');
const series = Array.from({ length: 30 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, '0')}`, 10 + i]);
writeFileSync(input, JSON.stringify(series));

const result = { forecast: [{ t: '2026-11-01', median: 40, lower: 35, upper: 45 }], granularity: 'day' };

test('curves forecast: v1 /solar/api/forecast/power-curve, v2 /api/v2/forecasts/power-curve, same output', async () => {
  await parity({
    name: 'curves forecast',
    args: ['curves', 'forecast', '--input', input, '--horizon', '7'],
    v1: { 'POST /solar/api/forecast/power-curve': { code: 200, data: result } },
    v2: { 'POST /api/v2/forecasts/power-curve': env(result) },
    expectV1: [{ method: 'POST', path: '/solar/api/forecast/power-curve' }],
    expectV2: [{ method: 'POST', path: '/api/v2/forecasts/power-curve' }],
  });
});

test('curves forecast: the v1 error envelope (200 with code 422) is an error on both sides', async () => {
  const { v1, v2 } = await parity({
    name: 'curves forecast error',
    args: ['curves', 'forecast', '--input', input],
    v1: { 'POST /solar/api/forecast/power-curve': { code: 422, error: { code: 'NOT_ENOUGH_HISTORY', message: 'Too little history' } } },
    v2: { 'POST /api/v2/forecasts/power-curve': { status: 422, body: { error: { code: 'NOT_ENOUGH_HISTORY', message: 'Too little history' }, requestId: 'r-1' } } },
    expectV1: [{ method: 'POST', path: '/solar/api/forecast/power-curve' }],
    expectV2: [{ method: 'POST', path: '/api/v2/forecasts/power-curve' }],
    code: 1,
  });
  for (const r of [v1, v2]) {
    const err = JSON.parse(r.stderr.trim());
    assert.equal(err.code, 'NOT_ENOUGH_HISTORY');
    assert.equal(err.status, 422);
  }
});
