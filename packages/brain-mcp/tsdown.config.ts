import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // The bin is spawned by `claude`/`codex` from wherever the app installed
    // it, so it is fully self-contained: brain-core, the MCP SDK and zod are
    // bundled in. Only Node built-ins (node:sqlite, node:fs, ...) stay external.
    bin: 'src/bin.ts',
  },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  dts: true,
  deps: {
    alwaysBundle: [/./],
  },
  sourcemap: true,
  clean: true,
});
