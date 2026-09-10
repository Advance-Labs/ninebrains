/**
 * Licence gate for the Ninebrains fork (plan task 0.4).
 *
 * Two scopes are checked:
 *
 * - production: `pnpm licenses list --json --prod`. Every package must carry a licence on
 *   ALLOWED_LICENSES or have a reviewed entry, with a written reason, in
 *   allowlist-exceptions.json.
 * - installed: every package.json in the hoisted node_modules trees, dev dependencies included.
 *   The desktop renderer bundles the app's devDependencies, so a blocked package added there would
 *   still ship. Only the blocklist and the forbidden licences apply to this scope.
 *
 * Blocked packages and forbidden licences can never be excepted.
 *
 * Usage: `pnpm run licenses` (runs the unit tests, then this script).
 */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '../..');
export const EXCEPTIONS_FILE = path.join(SCRIPT_DIR, 'allowlist-exceptions.json');

export const ALLOWED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  '0BSD',
  'MPL-2.0',
  'BlueOak-1.0.0',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
]);

/** Non-SPDX spellings seen in package.json files, keyed in lower case. */
const LICENSE_ALIASES = new Map([
  ['apache 2.0', 'Apache-2.0'],
  ['apache-2', 'Apache-2.0'],
  ['apache license 2.0', 'Apache-2.0'],
  ['apache license, version 2.0', 'Apache-2.0'],
  ['mit license', 'MIT'],
]);

/** Package names that may never be installed, in any scope. A trailing `/*` matches a scope. */
export const BLOCKED_PACKAGES = [
  { pattern: 'tldraw', reason: 'tldraw needs a commercial licence key in production' },
  { pattern: '@tldraw/*', reason: 'tldraw needs a commercial licence key in production' },
  { pattern: 'remotion', reason: 'Remotion needs a paid company licence above 3 employees' },
  { pattern: '@remotion/*', reason: 'Remotion needs a paid company licence above 3 employees' },
  { pattern: 'task-master-ai', reason: 'claude-task-master carries the Commons Clause' },
  { pattern: 'mcp_agent_mail', reason: 'mcp_agent_mail carries an anti-Anthropic/OpenAI rider' },
];

/**
 * Licences that can never ship, even with an exception. LGPL is deliberately absent: it is not on
 * the allowlist either, so it needs a reviewed exception (for example an optional binary).
 * BSL-1.0 (Boost) is permissive and is not the Business Source License (BSL-1.1).
 */
const FORBIDDEN_LICENSES = [
  { label: 'AGPL', test: (id) => /^AGPL/i.test(id) },
  { label: 'GPL', test: (id) => /^GPL/i.test(id) },
  { label: 'SSPL', test: (id) => /^SSPL/i.test(id) },
  { label: 'Elastic License', test: (id) => /^(ELv2|Elastic)/i.test(id) },
  { label: 'BUSL', test: (id) => /^(BUSL|BSL-1\.1|Business Source)/i.test(id) },
  { label: 'Commons Clause', test: (id) => /Commons[- ]Clause/i.test(id) },
];

export function matchesPattern(name, pattern) {
  return pattern.endsWith('/*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern;
}

function blockedEntry(name) {
  return BLOCKED_PACKAGES.find((entry) => matchesPattern(name, entry.pattern));
}

export function normalizeLicenseId(raw) {
  const id = String(raw ?? '').trim();
  if (!id || /^unknown$/i.test(id)) return 'UNKNOWN';
  const alias = LICENSE_ALIASES.get(id.toLowerCase());
  if (alias) return alias;
  for (const allowed of ALLOWED_LICENSES) {
    if (allowed.toLowerCase() === id.toLowerCase()) return allowed;
  }
  return id;
}

/**
 * Parses an SPDX-style expression such as `(MIT OR Apache-2.0)` into a tree of
 * `{ op: 'OR' | 'AND', left, right }` and `{ id }` nodes. `X WITH exception` reduces to `X`.
 * Free-form names ("Apache 2.0") are kept as one id.
 */
export function parseLicenseExpression(raw) {
  const tokens = String(raw ?? '')
    .replace(/[()]/g, (paren) => ` ${paren} `)
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let index = 0;
  const isKeyword = (token, keyword) => token !== undefined && token.toUpperCase() === keyword;

  function expression() {
    let node = term();
    while (isKeyword(tokens[index], 'OR')) {
      index += 1;
      node = { op: 'OR', left: node, right: term() };
    }
    return node;
  }

  function term() {
    let node = factor();
    while (isKeyword(tokens[index], 'AND')) {
      index += 1;
      node = { op: 'AND', left: node, right: factor() };
    }
    return node;
  }

  function factor() {
    if (tokens[index] === '(') {
      index += 1;
      const node = expression();
      if (tokens[index] === ')') index += 1;
      return node;
    }
    const words = [];
    while (
      index < tokens.length &&
      tokens[index] !== '(' &&
      tokens[index] !== ')' &&
      !isKeyword(tokens[index], 'OR') &&
      !isKeyword(tokens[index], 'AND')
    ) {
      words.push(tokens[index]);
      index += 1;
    }
    const withAt = words.findIndex((word) => isKeyword(word, 'WITH'));
    return { id: normalizeLicenseId((withAt === -1 ? words : words.slice(0, withAt)).join(' ')) };
  }

  return expression();
}

function isAllowed(node) {
  if ('id' in node) return ALLOWED_LICENSES.has(node.id);
  return node.op === 'OR'
    ? isAllowed(node.left) || isAllowed(node.right)
    : isAllowed(node.left) && isAllowed(node.right);
}

/** Returns the forbidden licence a package cannot avoid, or undefined if some choice avoids all. */
function unavoidableForbidden(node) {
  if ('id' in node) return FORBIDDEN_LICENSES.find((entry) => entry.test(node.id))?.label;
  const left = unavoidableForbidden(node.left);
  const right = unavoidableForbidden(node.right);
  if (node.op === 'OR') return left && right ? left : undefined;
  return left ?? right;
}

export function validateExceptions(data) {
  if (!data || !Array.isArray(data.exceptions)) {
    throw new Error('allowlist-exceptions.json: expected an "exceptions" array');
  }
  return data.exceptions.map((entry, position) => {
    const where = `allowlist-exceptions.json exceptions[${position}]`;
    if (typeof entry?.package !== 'string' || entry.package.trim() === '') {
      throw new Error(`${where}: "package" is required`);
    }
    if (typeof entry.license !== 'string' || entry.license.trim() === '') {
      throw new Error(`${where} (${entry.package}): "license" is required`);
    }
    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 20) {
      throw new Error(`${where} (${entry.package}): a written reason (20+ characters) is required`);
    }
    if (blockedEntry(entry.package)) {
      throw new Error(`${where}: ${entry.package} is on the blocklist and cannot be excepted`);
    }
    return {
      package: entry.package.trim(),
      license: entry.license.trim(),
      reason: entry.reason.trim(),
    };
  });
}

export function loadExceptions(file = EXCEPTIONS_FILE) {
  return validateExceptions(JSON.parse(readFileSync(file, 'utf8')));
}

/**
 * Evaluates both scopes. Packages are `{ name, version, license }`.
 * Returns every violation plus the exceptions that matched no package.
 */
export function evaluateLicenses({ production = [], installed = [] }, exceptions = []) {
  const violations = [];
  const reported = new Set();
  const usedExceptions = new Set();

  const report = (pkg, scope, rule, detail) => {
    const key = `${pkg.name}@${pkg.version}|${rule}`;
    if (reported.has(key)) return;
    reported.add(key);
    violations.push({ ...pkg, scope, rule, detail });
  };

  for (const [scope, packages] of [
    ['production', production],
    ['installed', installed],
  ]) {
    for (const pkg of packages) {
      const blocked = blockedEntry(pkg.name);
      if (blocked) {
        report(pkg, scope, 'blocked-package', blocked.reason);
        continue;
      }
      const expression = parseLicenseExpression(pkg.license);
      const forbidden = unavoidableForbidden(expression);
      if (forbidden) {
        report(pkg, scope, 'forbidden-license', `${forbidden} licences can never ship`);
        continue;
      }
      if (scope !== 'production' || isAllowed(expression)) continue;
      const license = String(pkg.license ?? '').trim();
      const exception = exceptions.find((e) => e.package === pkg.name && e.license === license);
      if (exception) {
        usedExceptions.add(exception);
        continue;
      }
      report(pkg, scope, 'not-allowlisted', 'not on the allowlist and no reviewed exception');
    }
  }

  return { violations, unusedExceptions: exceptions.filter((e) => !usedExceptions.has(e)) };
}

/** Flattens `pnpm licenses list --json` output (licence -> packages) into package records. */
export function fromPnpmLicensesJson(json) {
  if (json?.error) throw new Error(`pnpm licenses list failed: ${json.error.message}`);
  const packages = [];
  for (const [license, entries] of Object.entries(json ?? {})) {
    for (const entry of entries) {
      for (const version of entry.versions ?? [entry.version]) {
        packages.push({ name: entry.name, version, license: entry.license ?? license });
      }
    }
  }
  return packages;
}

export function readProductionPackages({ cwd = ROOT, spawn = spawnSync } = {}) {
  const result = spawn('pnpm', ['licenses', 'list', '--json', '--prod'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    shell: process.platform === 'win32',
  });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new Error(`pnpm licenses list failed (exit ${result.status}): ${result.stderr}`);
  }
  return fromPnpmLicensesJson(json);
}

function licenseOf(manifest) {
  if (typeof manifest.license === 'string') return manifest.license;
  if (manifest.license && typeof manifest.license.type === 'string') return manifest.license.type;
  if (Array.isArray(manifest.licenses)) {
    return manifest.licenses.map((entry) => entry?.type ?? entry).join(' OR ');
  }
  return 'UNKNOWN';
}

function readManifest(dir) {
  try {
    return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

function listDir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Walks every node_modules tree in the workspace (the repo uses `node-linker=hoisted`, so these
 * are real directories). Symlinks are skipped: they are workspace links to our own packages.
 */
export function readInstalledPackages(root = ROOT) {
  const found = new Map();

  const visitPackage = (dir) => {
    const manifest = readManifest(dir);
    if (manifest?.name) {
      const version = manifest.version ?? '0.0.0';
      const key = `${manifest.name}@${version}`;
      if (!found.has(key)) found.set(key, { name: manifest.name, version, license: licenseOf(manifest) });
    }
    visitNodeModules(path.join(dir, 'node_modules'));
  };

  const visitNodeModules = (dir) => {
    for (const entry of listDir(dir)) {
      if (entry.name.startsWith('.') || !entry.isDirectory()) continue;
      const full = path.join(dir, entry.name);
      if (!entry.name.startsWith('@')) {
        visitPackage(full);
        continue;
      }
      for (const scoped of listDir(full)) {
        if (scoped.isDirectory()) visitPackage(path.join(full, scoped.name));
      }
    }
  };

  const SKIP = new Set(['node_modules', 'dist', 'out', 'release', '.git', '.nx']);
  const visitWorkspace = (dir, depth) => {
    visitNodeModules(path.join(dir, 'node_modules'));
    if (depth === 0) return;
    for (const entry of listDir(dir)) {
      if (entry.isDirectory() && !SKIP.has(entry.name) && !entry.name.startsWith('.')) {
        visitWorkspace(path.join(dir, entry.name), depth - 1);
      }
    }
  };

  visitNodeModules(path.join(root, 'node_modules'));
  for (const top of ['apps', 'packages']) visitWorkspace(path.join(root, top), 4);
  return [...found.values()];
}

function summarize(packages) {
  const counts = new Map();
  for (const pkg of packages) {
    const license = String(pkg.license ?? 'UNKNOWN');
    counts.set(license, (counts.get(license) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function main() {
  const exceptions = loadExceptions();
  const production = readProductionPackages();
  const installed = readInstalledPackages();

  console.log(`licenses: ${production.length} production package versions by licence:`);
  for (const [license, count] of summarize(production)) console.log(`  ${count}\t${license}`);
  console.log(`licenses: ${installed.length} installed package versions walked (dev included)`);

  const { violations, unusedExceptions } = evaluateLicenses({ production, installed }, exceptions);
  for (const unused of unusedExceptions) {
    console.warn(`licenses: warning: exception ${unused.package} (${unused.license}) is unused`);
  }
  if (violations.length === 0) {
    console.log(`licenses: OK (${exceptions.length} reviewed exceptions)`);
    return 0;
  }
  console.error(`\nlicenses: ${violations.length} violation(s):`);
  for (const v of violations) {
    console.error(`  ${v.rule}\t${v.name}@${v.version}\t[${v.license}]\t(${v.scope}) ${v.detail}`);
  }
  console.error(
    `\nRemove the dependency, or add a reviewed entry with a written reason to ` +
      `${path.relative(ROOT, EXCEPTIONS_FILE)}. Blocked packages and forbidden licences ` +
      'cannot be excepted.'
  );
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
