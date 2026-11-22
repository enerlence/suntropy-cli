/**
 * `suntropy connect forecast <plantId>`: producción, consumo, autoconsumo y
 * excedente de una planta de Suntropy Connect, con TimesFM 3.0.
 *
 * Lo mismo que la tarjeta «Pronóstico de producción» de Suntropy, pero también
 * hacia delante:
 * - `backtest` (por defecto): esconde los últimos N días, los predice y los
 *   compara con lo real (¿la planta está produciendo lo que debe?).
 * - `forecast`: predice los próximos N días (16 como mucho: la irradiación
 *   prevista no llega más lejos).
 *
 * Referencias que no dependen del modelo:
 * - producción «según el año pasado»: irradiación del día × kWh por MJ/m² que
 *   rindió la planta en las mismas fechas del año pasado (±10 días);
 * - consumo: la media diaria del mismo periodo del año pasado o, sin él, del
 *   mes anterior.
 *
 * Autoconsumo estimado, cada día: f × min(producción, consumo), con f = lo que
 * se autoconsumió de ese mínimo en la referencia (recoge la coincidencia con
 * las horas de sol y la batería). Excedente = producción − autoconsumo; de
 * red = consumo − autoconsumo.
 *
 * Todo puro (sin red) para poder probarlo.
 */

export type PlantForecastMode = 'backtest' | 'forecast';

export interface DayRow {
  d: string;
  prod: number | null;
  cons: number | null;
  self: number | null;
  exp: number | null;
  /** Irradiación global del día (MJ/m²). */
  irr: number | null;
}

export interface ModelPoint {
  /** `YYYY-MM-DD` (la respuesta de Solar trae `t` y `date`). */
  date: string;
  p: number;
  lo: number;
  hi: number;
  anomaly?: boolean;
}

export interface EnergyFlows {
  productionKwh: number;
  consumptionKwh: number;
  selfConsumptionKwh: number;
  surplusKwh: number;
  gridImportKwh: number;
  selfConsumptionRate: number | null;
  coverage: number | null;
}

export type Basis = 'same_period_last_year' | 'previous_month';

const DAY = 86400_000;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const r1 = (v: number) => Math.round(v * 10) / 10;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const has = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v);

export function dayList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Las fechas: el histórico que se descarga y la ventana que se predice. */
export function windowFor(mode: PlantForecastMode, horizon: number, historyDays: number, today: string) {
  const yesterday = addDays(today, -1);
  if (mode === 'backtest') {
    return { historyFrom: addDays(yesterday, -(historyDays - 1)), historyTo: yesterday, from: addDays(yesterday, -(horizon - 1)), to: yesterday };
  }
  return { historyFrom: addDays(yesterday, -(historyDays - 1)), historyTo: yesterday, from: today, to: addDays(today, horizon - 1) };
}

/** `[periodo, valor]` del gateway → mapa por día. */
export function pairsToMap(points: unknown): Map<string, number | null> {
  const out = new Map<string, number | null>();
  if (!Array.isArray(points)) return out;
  for (const x of points) {
    if (!Array.isArray(x) || typeof x[0] !== 'string') continue;
    out.set(x[0].slice(0, 10), typeof x[1] === 'number' && Number.isFinite(x[1]) ? x[1] : null);
  }
  return out;
}

export const countValues = (m: Map<string, number | null>) => [...m.values()].filter((v) => v !== null).length;

/** Producción esperada según el año pasado, día a día de la ventana. */
export function lastYearExpected(rows: DayRow[], days: string[], irrOf: (d: string) => number | null) {
  const byDay = new Map(rows.map((r) => [r.d, r]));
  const points: Array<{ date: string; kwh: number | null }> = [];
  let real = 0;
  let exp = 0;
  let n = 0;
  for (const d of days) {
    let k = 0;
    let i = 0;
    let used = 0;
    for (let j = -10; j <= 10; j++) {
      const p = byDay.get(addDays(d, -365 + j));
      if (!p || !has(p.prod) || p.prod <= 0 || !has(p.irr) || p.irr <= 0) continue;
      k += p.prod;
      i += p.irr;
      used++;
    }
    const irr = irrOf(d);
    const e = used >= 7 && i > 0 && has(irr) ? (k / i) * irr : null;
    points.push({ date: d, kwh: e === null ? null : r1(e) });
    const today = byDay.get(d);
    if (e !== null && has(today?.prod)) {
      real += today!.prod as number;
      exp += e;
      n++;
    }
  }
  if (points.filter((p) => p.kwh !== null).length < Math.max(1, days.length / 2)) return null;
  const total = points.reduce((a, p) => a + (p.kwh ?? 0), 0);
  return {
    expectedKwh: r1(total),
    /** Solo en backtest: real frente a esperado en los días con los dos. */
    realKwh: n ? r1(real) : null,
    ratio: n && exp > 0 ? r3(real / exp) : null,
    points,
  };
}

function flows(prod: number, cons: number, self: number, surplus?: number): EnergyFlows {
  return {
    productionKwh: r1(prod),
    consumptionKwh: r1(cons),
    selfConsumptionKwh: r1(self),
    surplusKwh: r1(surplus ?? Math.max(0, prod - self)),
    gridImportKwh: r1(Math.max(0, cons - self)),
    selfConsumptionRate: prod > 0 ? r3(self / prod) : null,
    coverage: cons > 0 ? r3(self / cons) : null,
  };
}

/** Mismo periodo del año pasado si tiene la mitad de días útiles; si no, los 30 días antes de la ventana (solo con datos). */
function basisFor(rows: DayRow[], from: string, to: string, windowDays: number, ok: (r: DayRow) => boolean) {
  const lyFrom = addDays(from, -365);
  const lyTo = addDays(to, -365);
  const ly = rows.filter((r) => r.d >= lyFrom && r.d <= lyTo && ok(r));
  if (ly.length >= Math.max(7, windowDays / 2)) return { basis: 'same_period_last_year' as Basis, from: lyFrom, to: lyTo, rows: ly };
  const lastData = rows.filter((r) => r.d < from).slice(-1)[0]?.d ?? addDays(from, -1);
  const pTo = lastData < from ? lastData : addDays(from, -1);
  const pFrom = addDays(pTo, -29);
  const prev = rows.filter((r) => r.d >= pFrom && r.d <= pTo && ok(r));
  if (prev.length >= 10) return { basis: 'previous_month' as Basis, from: pFrom, to: pTo, rows: prev };
  return null;
}

/**
 * Consumo y balance de la ventana. `consModel`/`prodModel` son los puntos de
 * TimesFM de la ventana. En backtest compara con lo real; en forecast solo hay
 * estimación.
 */
export function consumptionBalance(rows: DayRow[], days: string[], consModel: ModelPoint[], prodModel: ModelPoint[], mode: PlantForecastMode) {
  const from = days[0];
  const to = days[days.length - 1];
  const byDay = new Map(rows.map((r) => [r.d, r]));
  const cm = new Map(consModel.map((p) => [p.date, Math.max(0, p.p)]));
  const pm = new Map(prodModel.map((p) => [p.date, Math.max(0, p.p)]));
  const expectedCons = days.reduce((a, d) => a + (cm.get(d) ?? 0), 0);

  const ref = basisFor(rows, from, to, days.length, (r) => has(r.cons));
  const reference = ref
    ? (() => {
        const daily = ref.rows.reduce((a, r) => a + (r.cons as number), 0) / ref.rows.length;
        return { basis: ref.basis, from: ref.from, to: ref.to, dailyKwh: r1(daily), kwh: r1(daily * days.length) };
      })()
    : null;

  let real: { consumptionKwh: number; days: number; vsModel: number | null; vsReference: number | null } | null = null;
  if (mode === 'backtest') {
    const withCons = days.filter((d) => has(byDay.get(d)?.cons));
    const rc = withCons.reduce((a, d) => a + (byDay.get(d)!.cons as number), 0);
    const mc = withCons.reduce((a, d) => a + (cm.get(d) ?? 0), 0);
    real = {
      consumptionKwh: r1(rc),
      days: withCons.length,
      vsModel: mc > 0 ? r3(rc / mc) : null,
      vsReference: reference && reference.dailyKwh > 0 && withCons.length ? r3(rc / (reference.dailyKwh * withCons.length)) : null,
    };
  }

  let balance: Record<string, unknown> | null = null;
  const full = (r: DayRow) => has(r.prod) && has(r.cons) && has(r.self);
  const bb = basisFor(rows, from, to, days.length, full);
  if (bb && cm.size && pm.size) {
    const overlap = bb.rows.reduce((a, r) => a + Math.min(r.prod as number, r.cons as number), 0);
    const selfRef = bb.rows.reduce((a, r) => a + (r.self as number), 0);
    if (overlap > 0) {
      const f = Math.max(0, Math.min(1, selfRef / overlap));
      const complete = days.filter((d) => byDay.get(d) && full(byDay.get(d)!) && cm.has(d) && pm.has(d));
      const useReal = mode === 'backtest' && complete.length >= days.length / 2;
      const set = useReal ? complete : days.filter((d) => cm.has(d) && pm.has(d));
      let p = 0;
      let c = 0;
      let s = 0;
      for (const d of set) {
        const pe = pm.get(d) as number;
        const ce = cm.get(d) as number;
        p += pe;
        c += ce;
        s += f * Math.min(pe, ce);
      }
      let realFlows: EnergyFlows | null = null;
      if (useReal) {
        const rs = set.map((d) => byDay.get(d)!);
        const allExp = rs.every((r) => has(r.exp));
        realFlows = flows(
          rs.reduce((a, r) => a + (r.prod as number), 0),
          rs.reduce((a, r) => a + (r.cons as number), 0),
          rs.reduce((a, r) => a + Math.min(r.self as number, r.prod as number), 0),
          allExp ? rs.reduce((a, r) => a + (r.exp as number), 0) : undefined,
        );
      }
      if (set.length) {
        balance = { basis: bb.basis, from: bb.from, to: bb.to, overlapFactor: r3(f), days: set.length, expected: flows(p, c, s), real: realFlows };
      }
    }
  }

  return {
    expected: { consumptionKwh: r1(expectedCons), byModel: 'TimesFM 3.0 (sin covariable)' },
    reference,
    real,
    balance,
    days: days.map((d) => ({ date: d, consumptionKwh: cm.has(d) ? r1(cm.get(d) as number) : null, real: mode === 'backtest' ? byDay.get(d)?.cons ?? null : undefined })),
  };
}

/** Resumen de producción de la ventana: modelo, año pasado y (backtest) lo real. */
export function productionSummary(rows: DayRow[], days: string[], prodModel: ModelPoint[], mode: PlantForecastMode) {
  const byDay = new Map(rows.map((r) => [r.d, r]));
  const pm = new Map(prodModel.map((p) => [p.date, p]));
  const expected = days.reduce((a, d) => a + Math.max(0, pm.get(d)?.p ?? 0), 0);
  const out: Record<string, unknown> = { expectedKwh: r1(expected) };
  if (mode === 'backtest') {
    const withReal = days.filter((d) => has(byDay.get(d)?.prod) && pm.has(d));
    const real = withReal.reduce((a, d) => a + (byDay.get(d)!.prod as number), 0);
    const exp = withReal.reduce((a, d) => a + Math.max(0, pm.get(d)!.p), 0);
    out.realKwh = r1(real);
    out.ratio = exp > 0 ? r3(real / exp) : null;
    out.anomalyDays = prodModel.filter((p) => p.anomaly).map((p) => p.date);
    out.missingDays = days.filter((d) => !has(byDay.get(d)?.prod));
  }
  return out;
}
