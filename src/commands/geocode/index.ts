import { Command } from 'commander';
import { createServiceClient, handleApiError } from '../../client.js';
import { output, outputError, type OutputOptions } from '../../output.js';

function getGlobalOpts(cmd: Command): OutputOptions & Record<string, unknown> {
  let root = cmd;
  while (root.parent) root = root.parent;
  return root.opts() as any;
}

interface GeocodeResult {
  formattedAddress: string;
  lat: number;
  lng: number;
  locationType: string;
  placeId: string;
  types: string[];
  addressComponents: { longName: string; shortName: string; types: string[] }[];
}

interface GeocodeResponse {
  status: 'OK' | 'ZERO_RESULTS';
  count: number;
  results: GeocodeResult[];
}

/** Print the best match by default, or the full candidate list with --all. */
function emit(
  data: GeocodeResponse,
  all: boolean | undefined,
  query: Record<string, unknown>,
  global: OutputOptions,
): void {
  if (all) {
    output(data.results, global);
    return;
  }
  if (data.count === 0) {
    output({ found: false, ...query }, global);
    return;
  }
  output(data.results[0], global);
}

export function registerGeocodeCommands(program: Command): void {
  const geocode = program.command('geocode').description(
    'Geocoding via the solar service (proxy to Google Geocoding API).\n' +
      'Resolve an address into coordinates and vice versa.',
  );

  // --- geocode resolve (address -> coordinates) ---
  geocode
    .command('resolve')
    .description(
      'Resolve an address into coordinates (lat/lng + formatted address).\n' +
        'Examples:\n' +
        '  suntropy geocode resolve --address "Calle Mayor 1, Madrid"\n' +
        '  suntropy geocode resolve --address "Gran Vía, Madrid" --country es --all',
    )
    .requiredOption('--address <string>', 'Address to geocode (quote it)')
    .option('--country <code>', 'Bias results to a country (ISO code, e.g. es, pt, it)')
    .option('--all', 'Return all candidate matches instead of only the best one')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(geocode);
        const client = createServiceClient('solar', global);
        const res = await client.get<GeocodeResponse>('/geocoding/geocode', {
          params: { address: opts.address, country: opts.country },
        });
        emit(res.data, opts.all, { address: opts.address }, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });

  // --- geocode reverse (coordinates -> address) ---
  geocode
    .command('reverse')
    .description(
      'Resolve coordinates into an address (reverse geocoding).\n' +
        'Example:\n' +
        '  suntropy geocode reverse --lat 40.4168 --lng -3.7038',
    )
    .requiredOption('--lat <number>', 'Latitude')
    .requiredOption('--lng <number>', 'Longitude')
    .option('--all', 'Return all candidate matches instead of only the best one')
    .action(async (opts) => {
      try {
        const global = getGlobalOpts(geocode);
        const client = createServiceClient('solar', global);
        const res = await client.get<GeocodeResponse>('/geocoding/reverse', {
          params: { lat: opts.lat, lng: opts.lng },
        });
        emit(res.data, opts.all, { lat: opts.lat, lng: opts.lng }, global);
      } catch (err) {
        outputError(handleApiError(err));
      }
    });
}
