/**
 * Curve forecasts (TimesFM). v1: `POST <server>/solar/api/forecast/power-curve`,
 * which answers 200 with the `{ code, data, error }` envelope even on failure;
 * v2: `POST /api/v2/forecasts/power-curve` (`calculations:write`), with plain
 * HTTP errors. Both return the forecast itself.
 */
import { operation, v1, v2 } from '../core.js';
import { CliError } from '../../client.js';
import type { Json } from '../translate.js';

/** Unwraps the v1 envelope; a `code` >= 400 or an `error` becomes a CliError. */
function v1Forecast(data: any): Json {
  if (data?.error || (Number.isInteger(data?.code) && data.code >= 400)) {
    const code = typeof data?.error?.code === 'string' ? data.error.code : 'FORECAST_ERROR';
    throw new CliError(data?.error?.message || data?.error?.code || 'Forecast error', code, data?.code);
  }
  return data?.data ?? data;
}

/** The model can take a couple of minutes on a cold start. */
const FORECAST_TIMEOUT = 180000;

export const FORECASTS = {
  powerCurve: operation<Json, Json>('forecasts.powerCurve', {
    v1: v1('post', '/api/forecast/power-curve', { body: (input) => input, out: v1Forecast, timeout: FORECAST_TIMEOUT }),
    v2: v2('post', '/forecasts/power-curve', { body: (input) => input, timeout: FORECAST_TIMEOUT }),
  }),
};
