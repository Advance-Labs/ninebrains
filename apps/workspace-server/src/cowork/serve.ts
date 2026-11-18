import { lstat, readFile } from 'node:fs/promises';
import type { WorkspaceServerConfig } from '../config';
import { startCoworkServer } from './server';

export type CoworkServeHandle = { dispose(): Promise<void> };

export async function serveCowork(config: WorkspaceServerConfig): Promise<CoworkServeHandle> {
  if (!config.cowork) {
    throw new Error(
      'serve-cowork requires: <worktree-root> <socket-path> <state-dir> <token-file>'
    );
  }
  const tokenStat = await lstat(config.cowork.tokenFile);
  if (
    !tokenStat.isFile() ||
    (tokenStat.mode & 0o077) !== 0 ||
    (process.getuid && tokenStat.uid !== process.getuid())
  ) {
    throw new Error('Token file must be owned by the server account and readable only by it');
  }
  const token = (await readFile(config.cowork.tokenFile, 'utf8')).trim();
  const handle = await startCoworkServer({
    root: config.cowork.root,
    socketPath: config.cowork.socketPath,
    stateDir: config.cowork.stateDir,
    token,
  });
  return { dispose: () => handle.close() };
}
