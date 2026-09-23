import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { protocol: 'src/protocol.ts' },
  format: ['esm'],
  dts: false,
  sourcemap: true,
  clean: false,
  deps: { alwaysBundle: [/.*/] },
});
