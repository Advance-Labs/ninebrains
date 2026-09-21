import { BRAND_NAME } from '@core/primitives/app-identity/api/app-identity';
import { defineCommand } from '@core/primitives/commands/api';

export const devProcessPanelCommand = defineCommand({
  id: 'devPerf.processPanel',
  title: 'Open Process Panel',
  description: `Show live CPU and memory usage for every ${BRAND_NAME} process`,
  category: 'Developer',
  icon: 'activity',
});

export const devPerfCaptureTraceCommand = defineCommand({
  id: 'devPerf.captureTrace',
  title: 'Capture Performance Trace',
  description: 'Record a 10-second contentTracing trace to a file',
  category: 'Developer',
  icon: 'gauge',
});

export const DEV_PERF_COMMAND_DEFS = [devProcessPanelCommand, devPerfCaptureTraceCommand] as const;
