/**
 * Root merge gate: runs format:check, lint, typecheck, licenses, the tooling
 * node tests, and test in order via the existing Nx-powered root scripts.
 * Equivalent to running the commands by hand; stops at the first failure.
 * `licenses` is the Ninebrains licence gate (tooling/scripts/check-licenses.mjs), and
 * `brand:check` proves the generated brand SVGs still match tooling/brand/glyph.mjs.
 *
 * Ninebrains: non-mutating by default, the same checks CI runs. Pass --write
 * (or `pnpm run check:write`) to run `format` instead of `format:check`.
 */
import { spawnSync } from 'node:child_process';

const write = process.argv.includes('--write');
const steps = [
  write ? 'format' : 'format:check',
  'lint',
  'typecheck',
  'licenses',
  'brand:check',
  'test:tooling',
  'test',
];

for (const step of steps) {
  console.log(`\ncheck: running pnpm run ${step}\n`);
  const result = spawnSync('pnpm', ['run', step], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    const hint =
      step === 'format:check'
        ? '\nRun `pnpm run format` (or `pnpm run check:write`) to fix it.'
        : step === 'brand:check'
          ? '\nRun `pnpm run brand` to regenerate the brand assets (docs/brand/README.md).'
          : '';
    console.error(
      `\ncheck: failed at "pnpm run ${step}".${hint}` +
        '\nIf the failure looks environmental, run `pnpm run doctor` to rule out your setup.'
    );
    process.exit(typeof result.status === 'number' ? result.status : 1);
  }
}

console.log(`\ncheck: ${steps.join(', ')} all passed.`);
