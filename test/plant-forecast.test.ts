import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, consumptionBalance, dayList, lastYearExpected, pairsToMap, productionSummary, windowFor, type DayRow } from '../src/connect/plant-forecast.js';

const days2y = dayList('2024-11-01', '2026-11-13');
const irr = (d: string) => 10 + (Number(d.slice(8, 10)) % 7);
const rows = (f: (d: string) => Partial<DayRow> = () => ({})): DayRow[] =>
  days2y.map((d) => ({ d, prod: 2 * irr(d), cons: 15, self: 7.5, exp: 2 * irr(d) - 7.5, irr: irr(d), ...f(d) }));
const model = (ds: string[], v: number | ((d: string) => number)) => ds.map((d) => ({ date: d, p: typeof v === 'number' ? v : v(d), lo: 0, hi: 0 }));

describe('windowFor', () => {
  it('backtest = last N finished days; forecast = from today', () => {
    assert.deepEqual(windowFor('backtest', 30, 730, '2026-11-14'), { historyFrom: '2024-11-14', historyTo: '2026-11-13', from: '2026-10-15', to: '2026-11-13' });
    assert.deepEqual(windowFor('forecast', 7, 730, '2026-11-14'), { historyFrom: '2024-11-14', historyTo: '2026-11-13', from: '2026-11-14', to: '2026-11-20' });
  });
});

describe('pairsToMap', () => {
  it('keeps nulls as missing data', () => {
    const m = pairsToMap([['2026-11-01', 3], ['2026-11-02', null], ['2026-11-03T00:00', 4]]);
    assert.deepEqual([...m.entries()], [['2026-11-01', 3], ['2026-11-02', null], ['2026-11-03', 4]]);
  });
});

describe('lastYearExpected', () => {
  it('backtest: same yield as last year → ratio 1; 20 % less → 0.8', () => {
    const ds = dayList('2026-10-15', '2026-11-13');
    assert.equal(lastYearExpected(rows(), ds, irr)!.ratio, 1);
    const worse = rows((d) => (d >= '2026-10-15' ? { prod: 1.6 * irr(d) } : {}));
    assert.equal(lastYearExpected(worse, ds, irr)!.ratio, 0.8);
  });
  it('forecast: expected only, with the forecast irradiance', () => {
    const ds = dayList('2026-11-14', '2026-11-20');
    const r = lastYearExpected(rows(), ds, irr)!;
    assert.equal(r.ratio, null);
    assert.equal(r.points[0].kwh, 2 * irr('2026-11-14'));
  });
});

describe('consumptionBalance', () => {
  it('backtest: estimate with last year factor against the real flows', () => {
    const ds = dayList('2026-10-15', '2026-11-13');
    const c = consumptionBalance(rows((d) => ({ prod: 20, exp: 12.5 })), ds, model(ds, 15), model(ds, 20), 'backtest');
    assert.equal(c.reference!.basis, 'same_period_last_year');
    assert.equal(c.real!.vsModel, 1);
    const b = c.balance as any;
    assert.equal(b.overlapFactor, 0.5);
    assert.equal(b.expected.selfConsumptionKwh, 225);
    assert.equal(b.expected.surplusKwh, 375);
    assert.equal(b.real.surplusKwh, 375);
  });
  it('forecast: no real, estimate for the coming days; previous month when there is no last year', () => {
    const ds = dayList('2026-11-14', '2026-11-20');
    const recent = rows((d) => ({ prod: 20 })).filter((r) => r.d >= '2026-09-01');
    const c = consumptionBalance(recent, ds, model(ds, 15), model(ds, 20), 'forecast');
    assert.equal(c.real, null);
    assert.equal(c.reference!.basis, 'previous_month');
    assert.equal(c.reference!.to, '2026-11-13');
    assert.equal((c.balance as any).real, null);
    assert.equal((c.balance as any).expected.selfConsumptionKwh, 52.5);
  });
});

describe('productionSummary', () => {
  it('lists anomaly and missing days in backtest', () => {
    const ds = dayList('2026-11-10', '2026-11-13');
    const r = rows((d) => (d === '2026-11-12' ? { prod: null } : {}));
    const pm = model(ds, (d) => 2 * irr(d)).map((p) => ({ ...p, anomaly: p.date === '2026-11-11' }));
    const s = productionSummary(r, ds, pm, 'backtest') as any;
    assert.deepEqual(s.anomalyDays, ['2026-11-11']);
    assert.deepEqual(s.missingDays, ['2026-11-12']);
    assert.equal(s.ratio, 1);
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  });
});
