import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';

// Read the real version from package.json at build time (cwd is the package root
// when running `npm run build`) and inline it, so `--version` always matches the
// published package instead of a hardcoded value.
const pkg = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string };

export default defineConfig({
  entry: ['bin/suntropy.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist/bin',
  clean: true,
  sourcemap: true,
  splitting: false,
  define: {
    __CLI_VERSION__: JSON.stringify(pkg.version),
  },
  banner: {
    js: '#!/usr/bin/env node',
  },
});
