import { chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EvidencePathError, FsEvidenceStore } from './evidence-store';

let tmp: string;
let root: string;

beforeEach(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'gates-evidence-hygiene-'));
  root = path.join(tmp, 'evidence');
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const mode = async (p: string) => (await stat(p)).mode & 0o777;

describe('SEC-24 evidence store hygiene', () => {
  it.skipIf(process.platform === 'win32')(
    'makes every directory 0700 and every file 0600, even under an existing root',
    async () => {
      await mkdir(root, { recursive: true });
      await chmod(root, 0o755);
      const store = await FsEvidenceStore.open({ root, jobId: 'job-1', attempt: 1 });
      const evidence = await store.put({
        kind: 'log',
        label: 'log',
        fileName: 'tests.log',
        data: 'ok\n',
      });
      expect(await mode(root)).toBe(0o700);
      expect(await mode(path.dirname(store.dir))).toBe(0o700);
      expect(await mode(store.dir)).toBe(0o700);
      expect(await mode(evidence.path)).toBe(0o600);
      expect(await mode(path.join(store.dir, 'manifest.json'))).toBe(0o600);
    }
  );

  it('accepts only the shared SEC-14 id grammar', async () => {
    for (const bad of ['a.b', '.', '..', 'a:b', 'a/b', 'x'.repeat(65), '', 'job 1']) {
      await expect(FsEvidenceStore.open({ root, jobId: bad, attempt: 1 })).rejects.toBeInstanceOf(
        EvidencePathError
      );
    }
    for (const good of ['x'.repeat(64), 'job_1-A']) {
      await expect(FsEvidenceStore.open({ root, jobId: good, attempt: 1 })).resolves.toBeDefined();
    }
  });

  it('redacts secrets from text evidence and leaves screenshots byte-for-byte', async () => {
    const token = 'nb-live-token-abcdefghijklmnopqrstuvwxyz0123456';
    const store = await FsEvidenceStore.open({
      root,
      jobId: 'job-2',
      attempt: 1,
      secrets: [token],
    });
    const leaks = [
      token,
      'other-token-value-123',
      'dXNlcjpwYXNz',
      'abcdefghijklmnop',
      `ghp_${'a'.repeat(36)}`,
      'AKIAABCDEFGHIJKLMNOP',
      `sk-ant-api03-${'b'.repeat(30)}`,
    ];
    const log = await store.put({
      kind: 'log',
      label: 'env dump',
      fileName: 'tests.log',
      data: [
        `NINEBRAINS_TOKEN=${token}`,
        'NINEBRAINS_TOKEN=other-token-value-123',
        'Authorization: Basic dXNlcjpwYXNz',
        'curl -H "Authorization: Bearer abcdefghijklmnop" https://example.invalid',
        `GITHUB_TOKEN=ghp_${'a'.repeat(36)}`,
        'aws_access_key_id = AKIAABCDEFGHIJKLMNOP',
        `ANTHROPIC_API_KEY=sk-ant-api03-${'b'.repeat(30)}`,
        `the token again, inline: ${token}`,
        'ordinary line',
      ].join('\n'),
    });
    const text = await readFile(log.path, 'utf8');
    for (const leak of leaks) expect(text).not.toContain(leak);
    expect(text).toContain('ordinary line');
    expect(text).toContain('[REDACTED');

    const json = await store.put({
      kind: 'json',
      label: 'env',
      fileName: 'env.json',
      data: JSON.stringify({ env: { NINEBRAINS_TOKEN: 'zzzzzzzzzzzz12' }, ok: true }),
    });
    const parsed = JSON.parse(await readFile(json.path, 'utf8'));
    expect(parsed).toEqual({ env: { NINEBRAINS_TOKEN: '[REDACTED]' }, ok: true });

    const bytes = await store.put({
      kind: 'text',
      label: 'bytes',
      fileName: 'reply.txt',
      data: new TextEncoder().encode(`reply ${token}`),
    });
    expect(await readFile(bytes.path, 'utf8')).toBe('reply [REDACTED]');

    const png = Buffer.from(`\x89PNG fake ${token}`, 'latin1');
    const shot = await store.put({
      kind: 'screenshot',
      label: 'shot',
      fileName: 'shot.png',
      data: png,
    });
    expect(Buffer.compare(await readFile(shot.path), png)).toBe(0);

    const manifest = JSON.parse(await readFile(path.join(store.dir, 'manifest.json'), 'utf8'));
    expect(manifest.evidence[2].bytes).toBe(Buffer.byteLength('reply [REDACTED]'));
  });
});
