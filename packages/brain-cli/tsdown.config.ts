import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    // Self-contained, like brain-mcp's bin: the operator may run it from a shell
    // that knows nothing about the workspace, so brain-core and zod are bundled.
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
