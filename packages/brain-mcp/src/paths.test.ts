import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { InvalidInputError } from '@ninebrains/brain-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveAttachmentPath } from './paths';

let root: string;
let project: string;
let evidence: string;
let outside: string;

beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'brain-mcp-paths-')));
  project = path.join(root, 'project');
  evidence = path.join(root, 'evidence');
  outside = path.join(root, 'outside');
  for (const dir of [project, evidence, outside, path.join(project, 'src')]) mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(project, 'src', 'app.ts'), '');
  writeFileSync(path.join(evidence, 'shot.png'), '');
  writeFileSync(path.join(outside, 'secret.txt'), '');
  symlinkSync(path.join(outside, 'secret.txt'), path.join(project, 'sneaky-link'));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('resolveAttachmentPath', () => {
  it('resolves relative paths against the project dir', () => {
    expect(resolveAttachmentPath('src/app.ts', [project, evidence])).toBe(path.join(project, 'src', 'app.ts'));
  });

  it('accepts absolute paths inside any root', () => {
    expect(resolveAttachmentPath(path.join(evidence, 'shot.png'), [project, evidence])).toBe(
      path.join(evidence, 'shot.png')
    );
    expect(resolveAttachmentPath(project, [project])).toBe(project);
  });

  it.each([
    ['../outside/secret.txt', /outside the project/],
    ['sneaky-link', /outside the project/],
    ['src/missing.ts', /does not exist/],
    ['bad\0path', /NUL/],
    ['', /1-1024/],
    ['x'.repeat(1025), /1-1024/],
  ])('rejects %j', (input, message) => {
    expect(() => resolveAttachmentPath(input, [project, evidence])).toThrow(InvalidInputError);
    expect(() => resolveAttachmentPath(input, [project, evidence])).toThrow(message);
  });

  it('rejects absolute paths outside every root', () => {
    expect(() => resolveAttachmentPath(path.join(outside, 'secret.txt'), [project, evidence])).toThrow(/outside/);
  });

  it('rejects a sibling dir that only shares a name prefix', () => {
    const sibling = `${project}-evil`;
    mkdirSync(sibling, { recursive: true });
    writeFileSync(path.join(sibling, 'x'), '');
    expect(() => resolveAttachmentPath(path.join(sibling, 'x'), [project])).toThrow(/outside/);
  });

  it('refuses attachments when no root is configured', () => {
    expect(() => resolveAttachmentPath('src/app.ts', [])).toThrow(/disabled/);
  });
});
