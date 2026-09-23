#!/usr/bin/env node
import { lstat, readFile } from 'node:fs/promises';
import { startCoworkServer } from './server';

async function main(): Promise<void> {
  const [root, socketPath, stateDir, tokenFile] = process.argv.slice(2);
  if (!root || !socketPath || !stateDir || !tokenFile) {
    throw new Error('Usage: cowork-server <worktree-root> <socket-path> <state-dir> <token-file>');
  }
  const tokenStat = await lstat(tokenFile);
  if (
    !tokenStat.isFile() ||
    (tokenStat.mode & 0o077) !== 0 ||
    (process.getuid && tokenStat.uid !== process.getuid())
  ) {
    throw new Error('Token file must be owned by the server account and readable only by it');
  }
  const token = (await readFile(tokenFile, 'utf8')).trim();
  const handle = await startCoworkServer({ root, socketPath, stateDir, token });
  const stop = (): void => {
    void handle.close().then(() => process.exit(0));
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
