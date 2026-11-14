/**
 * `suntropy curves forecast`: pronóstico de cualquier PowerCurve con TimesFM 3.0
 * (Solar `POST /api/forecast/power-curve`).
 *
 * Lo puro (armar el cuerpo y elegir qué se imprime) vive aquí para poder
 * probarlo sin red.
 */

export type ForecastMode = 'forecast' | 'backtest';
export type ForecastGranularity = 'day' | 'hour';
export type ForecastOutput = 'full' | 'points' | 'median' | 'lower' | 'upper' | 'metrics';

export interface ForecastCliOptions {
  mode?: string;
  granularity?: string;
  horizon?: string;
  lat?: string;
  lon?: string;
  covariate?: string;
  confidence?: string;
  refresh?: boolean;
  output?: string;
}

export const OUTPUTS: ForecastOutput[] = ['full', 'points', 'median', 'lower', 'upper', 'metrics'];

function num(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
}

const isPair = (x: unknown) => Array.isArray(x) && x.length === 2 && typeof x[0] === 'string';

/**
 * Qué se ha pasado: una serie `[periodo, valor]` (la salida de `suntropy connect
 * energy`, con `points`, o directamente la lista de pares) o una PowerCurve.
 */
export function inputKind(data: unknown): { series: unknown } | { curve: unknown } {
  if (Array.isArray(data) && data.length && data.every(isPair)) return { series: data };
  const points = (data as any)?.points;
  if (Array.isArray(points) && points.length && points.every(isPair)) return { series: points };
  return { curve: data };
}

/** El cuerpo de la petición. Valida lo que no necesita al servidor; el resto lo valida Solar. */
export function buildForecastBody(input: unknown, o: ForecastCliOptions): Record<string, unknown> {
  if (o.mode && !['forecast', 'backtest'].includes(o.mode)) throw new Error('--mode must be forecast or backtest');
  if (o.granularity && !['day', 'hour'].includes(o.granularity)) throw new Error('--granularity must be day or hour');
  if (o.covariate && !['none', 'irradiance'].includes(o.covariate)) throw new Error('--covariate must be none or irradiance');
  if ((o.lat === undefined) !== (o.lon === undefined)) throw new Error('--lat and --lon go together');
  const horizon = num(o.horizon, 'horizon');
  if (horizon !== undefined && !Number.isInteger(horizon)) throw new Error('--horizon must be an integer');
  const body: Record<string, unknown> = { ...inputKind(input) };
  if (o.mode) body.mode = o.mode;
  if (o.granularity) body.granularity = o.granularity;
  if (horizon !== undefined) body.horizon = horizon;
  if (o.lat !== undefined) {
    body.latitude = num(o.lat, 'lat');
    body.longitude = num(o.lon, 'lon');
  }
  if (o.covariate) body.covariate = o.covariate;
  const confidence = num(o.confidence, 'confidence');
  if (confidence !== undefined) body.confidenceLevel = confidence;
  if (o.refresh) body.refresh = true;
  return body;
}

/**
 * Qué se imprime: la respuesta entera, solo los puntos, solo las métricas del
 * backtest, o una de las curvas (mediana, p-baja, p-alta) como PowerCurve para
 * encadenar con otros `suntropy curves` (solo en horario).
 */
export function pickOutput(data: any, output: string | undefined): unknown {
  const o = (output ?? 'full') as ForecastOutput;
  if (!OUTPUTS.includes(o)) throw new Error(`--output must be one of ${OUTPUTS.join(', ')}`);
  if (o === 'full') return data;
  if (o === 'points') return data.forecast;
  if (o === 'metrics') {
    if (!data.metrics) throw new Error('--output metrics needs --mode backtest');
    return data.metrics;
  }
  if (!data.curves) throw new Error(`--output ${o} needs --granularity hour (daily forecasts are not PowerCurves)`);
  return data.curves[o === 'median' ? 'median' : o];
}
