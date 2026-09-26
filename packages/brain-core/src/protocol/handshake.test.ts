import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { USER_BRAIN_ID } from '../types';
import {
  BRAIN_HANDSHAKE_VERSION,
  brainHandshakeCandidates,
  brainHandshakePath,
  findBrainHandshake,
  handshakeProcessAlive,
  readBrainHandshake,
  removeBrainHandshake,
  writeBrainHandshake,
} from './handshake';
import { TokenRegistry } from './tokens';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempUserData(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'brain-handshake-'));
  dirs.push(dir);
  return dir;
}

const token = (): string =>
  new TokenRegistry().issue({
    identity: { role: 'brain', brainId: USER_BRAIN_ID },
    projectId: null,
    attachmentRoots: [],
    user: true,
  });

function write(userData: string, over: Record<string, unknown> = {}): string {
  const file = brainHandshakePath(userData);
  return writeBrainHandshake(
    { url: 'http://127.0.0.1:54321', token: token(), pid: process.pid, startedAt: 1, ...over },
    file
  );
}

describe('the CLI handshake', () => {
  it('SEC-10: writes 0600 in a 0700 directory', () => {
    const file = write(tempUserData());
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
  });

  it('tightens the mode of a file an earlier launch left world-readable', () => {
    const userData = tempUserData();
    const file = brainHandshakePath(userData);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, '{}', { mode: 0o644 });
    expect(statSync(file).mode & 0o777).toBe(0o644);
    write(userData);
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });

  it('round-trips', () => {
    const userData = tempUserData();
    const file = write(userData, { url: 'http://127.0.0.1:9', startedAt: 42 });
    const result = readBrainHandshake(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.handshake).toMatchObject({
      version: BRAIN_HANDSHAKE_VERSION,
      url: 'http://127.0.0.1:9',
      pid: process.pid,
      startedAt: 42,
    });
  });

  it('reports a missing file as missing, not as an error', () => {
    expect(readBrainHandshake(brainHandshakePath(tempUserData()))).toMatchObject({
      ok: false,
      reason: 'missing',
    });
  });

  it('SEC-04: refuses a handshake that names a non-loopback endpoint', () => {
    const userData = tempUserData();
    const file = brainHandshakePath(userData);
    mkdirSync(path.dirname(file), { recursive: true });
    for (const url of [
      'http://10.0.0.5:5000',
      'http://localhost:5000',
      'https://127.0.0.1:5000',
      'http://127.0.0.1.evil.test:5000',
    ]) {
      writeFileSync(
        file,
        JSON.stringify({ version: 1, url, token: token(), pid: 1, startedAt: 0 })
      );
      expect(readBrainHandshake(file), url).toMatchObject({ ok: false, reason: 'malformed' });
    }
  });

  it('refuses a token of the wrong length and an unknown version', () => {
    const userData = tempUserData();
    const file = brainHandshakePath(userData);
    mkdirSync(path.dirname(file), { recursive: true });
    const base = { url: 'http://127.0.0.1:1', pid: 1, startedAt: 0 };
    writeFileSync(file, JSON.stringify({ ...base, version: 1, token: 'short' }));
    expect(readBrainHandshake(file)).toMatchObject({ ok: false, reason: 'malformed' });
    writeFileSync(file, JSON.stringify({ ...base, version: 2, token: token() }));
    expect(readBrainHandshake(file)).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('reports garbage as malformed rather than throwing', () => {
    const userData = tempUserData();
    const file = brainHandshakePath(userData);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, 'not json at all');
    expect(readBrainHandshake(file)).toMatchObject({ ok: false, reason: 'malformed' });
  });

  it('honours the NINEBRAINS_BRAIN_HANDSHAKE override and finds it', () => {
    const userData = tempUserData();
    const file = write(userData);
    const env = { NINEBRAINS_BRAIN_HANDSHAKE: file } as NodeJS.ProcessEnv;
    expect(brainHandshakeCandidates(env)).toEqual([file]);
    expect(findBrainHandshake(env)).toMatchObject({ ok: true, file });
  });

  it('tries every known userData directory when there is no override', () => {
    const candidates = brainHandshakeCandidates({ HOME: '/tmp/nobody' } as NodeJS.ProcessEnv);
    expect(candidates).toHaveLength(3);
    expect(candidates.some((file) => file.includes('ninebrains-canary'))).toBe(true);
    expect(candidates.some((file) => file.includes('ninebrains-dev'))).toBe(true);
  });

  it('reports every attempt when nothing is found', () => {
    const result = findBrainHandshake({ HOME: '/tmp/definitely-not-here' } as NodeJS.ProcessEnv);
    expect(result).toMatchObject({ ok: false, reason: 'none' });
    if (result.ok || result.reason !== 'none') return;
    expect(result.tried).toHaveLength(3);
    expect(result.tried.every((attempt) => !attempt.ok)).toBe(true);
  });

  it('detects a live pid and a dead one', () => {
    const base = { version: BRAIN_HANDSHAKE_VERSION, url: 'http://127.0.0.1:1', token: token() };
    expect(handshakeProcessAlive({ ...base, pid: process.pid, startedAt: 0 })).toBe(true);
    // 2^22 is above every platform's pid_max default, so it cannot be running.
    expect(handshakeProcessAlive({ ...base, pid: 4_194_304, startedAt: 0 })).toBe(false);
  });

  it('remove is idempotent', () => {
    const userData = tempUserData();
    const file = write(userData);
    removeBrainHandshake(file);
    removeBrainHandshake(file);
    expect(readBrainHandshake(file)).toMatchObject({ ok: false, reason: 'missing' });
  });
});
