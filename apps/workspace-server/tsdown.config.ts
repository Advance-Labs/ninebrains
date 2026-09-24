import { defineConfig } from 'tsdown';
import { workspaceWorkerBuildInputs } from './src/gateway/worker-manifest.js';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    ...workspaceWorkerBuildInputs(),
    cowork: 'src/cowork/serve.ts',
    'cowork-protocol': 'src/cowork/protocol.ts',
  },
  format: ['esm'],
  outputOptions: {
    codeSplitting: true,
  },
  dts: false,
  sourcemap: true,
  clean: true,
  deps: {
    alwaysBundle: [/.*/],
    neverBundle: ['node-pty', 'better-sqlite3', '@parcel/watcher'],
    onlyBundle: false,
  },
});
