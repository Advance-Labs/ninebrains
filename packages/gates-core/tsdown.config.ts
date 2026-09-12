import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // Just the nonce fence, for brain-mcp's bundled bin (no image-diff dependencies).
    untrusted: 'src/untrusted.ts',
  },
  format: ['esm'],
  dts: true,
  deps: {
    neverBundle: ['@emdash/citations', 'pixelmatch', 'pngjs'],
  },
  sourcemap: true,
  clean: true,
});
