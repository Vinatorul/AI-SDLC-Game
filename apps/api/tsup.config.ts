import { defineConfig } from 'tsup';

export default defineConfig({
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
  clean: true,
  entry: ['src/server.ts', 'src/backup.ts'],
  external: ['node:sqlite'],
  format: ['esm'],
  noExternal: [/.*/],
  outDir: 'dist',
  platform: 'node',
  removeNodeProtocol: false,
  sourcemap: true,
  target: 'node24',
});
