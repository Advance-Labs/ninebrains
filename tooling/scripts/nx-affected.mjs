/**
 * CI helper: writes `run=true|false` to $GITHUB_OUTPUT for one Nx project. True when NX_SCOPE
 * is not `affected` (weekly and manual runs test everything), or when the project is in
 * `nx show projects --affected` for the NX_BASE/NX_HEAD that nrwl/nx-set-shas exported.
 *
 * Usage: node tooling/scripts/nx-affected.mjs <project>
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function shouldRun({ project, scope, affected }) {
  if (scope !== 'affected') return true;
  return affected().includes(project);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const project = process.argv[2];
  if (!project) throw new Error('Usage: nx-affected.mjs <project>');
  const run = shouldRun({
    project,
    scope: process.env.NX_SCOPE ?? 'affected',
    affected: () =>
      JSON.parse(
        execFileSync('pnpm', ['exec', 'nx', 'show', 'projects', '--affected', '--json'], {
          encoding: 'utf8',
        })
      ),
  });
  console.log(run ? `${project} is affected: running.` : `${project} is not affected: skipping.`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
}
