import { build } from 'esbuild';
import { rm } from 'node:fs/promises';

await rm('dist/main', { recursive: true, force: true });
await rm('dist/harness', { recursive: true, force: true });

const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
  external: ['electron'],
};

await Promise.all([
  build({
    ...common,
    entryPoints: ['src/main/index.ts'],
    outfile: 'dist/main/electron.js',
    format: 'cjs',
  }),
  build({
    ...common,
    entryPoints: ['src/preload/index.ts'],
    outfile: 'dist/main/preload.js',
    format: 'cjs',
  }),
  build({
    ...common,
    entryPoints: ['src/main/harness/server.ts'],
    outfile: 'dist/harness/server.cjs',
    format: 'cjs',
  }),
]);
