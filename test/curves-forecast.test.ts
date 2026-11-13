import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildForecastBody, inputKind, pickOutput } from '../src/commands/curves/forecast.ts';
import { classifyPath } from '../src/access.ts';

const curve = { days: [{ date: '2026-11-01', valuesList: { '12': 3 } }] };

describe('curves forecast: body', () => {
  it('sends only what was given, with numbers as numbers', () => {
    assert.deepEqual(buildForecastBody(curve, {}), { curve });
    assert.deepEqual(
      buildForecastBody(curve, { mode: 'backtest', granularity: 'hour', horizon: '48', lat: '36.72', lon: '-4.42', confidence: '0.9', refresh: true }),
      { curve, mode: 'backtest', granularity: 'hour', horizon: 48, latitude: 36.72, longitude: -4.42, confidenceLevel: 0.9, refresh: true },
    );
  });

  it('rejects obvious mistakes before calling the API', () => {
    assert.throws(() => buildForecastBody(curve, { mode: 'next' }), /--mode/);
    assert.throws(() => buildForecastBody(curve, { granularity: 'week' }), /--granularity/);
    assert.throws(() => buildForecastBody(curve, { lat: '36' }), /go together/);
    assert.throws(() => buildForecastBody(curve, { horizon: '2.5' }), /integer/);
    assert.throws(() => buildForecastBody(curve, { covariate: 'temperature' }), /--covariate/);
  });
});

describe('curves forecast: input kind', () => {
  it('sends a Connect energy answer or a list of pairs as series, anything else as curve', () => {
    const energy = { plant: { id: 'p' }, granularity: 'day', points: [['2026-11-01', 29], ['2026-11-02', null]] };
    assert.deepEqual(inputKind(energy), { series: energy.points });
    assert.deepEqual(inputKind([['2026-11-01T10:00', 1]]), { series: [['2026-11-01T10:00', 1]] });
    assert.deepEqual(inputKind(curve), { curve });
    assert.deepEqual(inputKind(curve.days), { curve: curve.days });
    assert.deepEqual(buildForecastBody(energy, { horizon: '3' }), { series: energy.points, horizon: 3 });
  });
});

describe('curves forecast: output', () => {
  const hourly = { forecast: [{ t: 'x' }], metrics: { mae: 1 }, curves: { median: { days: [] }, lower: { days: [1] }, upper: { days: [2] } } };
  it('prints the whole answer, the points, the metrics or one curve', () => {
    assert.equal(pickOutput(hourly, undefined), hourly);
    assert.deepEqual(pickOutput(hourly, 'points'), [{ t: 'x' }]);
    assert.deepEqual(pickOutput(hourly, 'metrics'), { mae: 1 });
    assert.deepEqual(pickOutput(hourly, 'upper'), { days: [2] });
  });
  it('explains when the curve or the metrics do not exist', () => {
    assert.throws(() => pickOutput({ forecast: [] }, 'median'), /--granularity hour/);
    assert.throws(() => pickOutput({ forecast: [] }, 'metrics'), /--mode backtest/);
    assert.throws(() => pickOutput({ forecast: [] }, 'csv'), /--output must be/);
  });
});

describe('curves forecast: access profile', () => {
  it('is a read command (pure compute, nothing is stored on the account)', () => {
    assert.equal(classifyPath(['curves', 'forecast']), 'read');
  });
});
