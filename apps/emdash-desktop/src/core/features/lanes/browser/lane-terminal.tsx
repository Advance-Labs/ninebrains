import { Spinner } from '@emdash/ui/react/primitives';
import { ReplicaLog } from '@emdash/wire/live';
import type { Terminal } from '@xterm/xterm';
import { TriangleAlert } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { getConversationsClient } from '@core/features/conversations/api/browser/client';
import { getTaskStore } from '@core/features/tasks/api/browser/task-state/task-selectors';
import type { FrontendPtyConnector } from '@core/features/terminals/api/browser/pty/pty';
import { PtySession } from '@core/features/terminals/api/browser/pty/pty-session';
import { createXtermLogSink } from '@core/features/terminals/api/browser/pty/xterm-log-sink';
import { PtyPane } from '@core/features/terminals/contributions/browser/pty/pty-pane';
import { log } from '@core/primitives/logging/browser/logger';
import type { Lane } from '../api';

/**
 * Binds xterm to a conversation's `tui.output` log and routes keystrokes and
 * resizes back through `tui.sendInput` / `tui.resize`. The output log is keyed
 * by conversation id alone, so a lane cell needs no task scope.
 *
 * `onInputHealth` reports whether the last keystroke actually reached the
 * agent: the PTY can be `ready` (connected fine) while the underlying agent
 * process is gone, in which case `sendInput` keeps resolving `{ success: false }`
 * or rejecting with nothing in the UI to show for it.
 */
function createLaneTuiConnector(
  conversationId: string,
  onInputHealth: (ok: boolean) => void
): FrontendPtyConnector {
  let logBinding: ReplicaLog | null = null;
  return {
    async connect(terminal: Terminal) {
      const client = await getConversationsClient();
      logBinding = new ReplicaLog(client.tui.output.handle({ conversationId }), {
        store: createXtermLogSink(terminal),
      });
      await logBinding.ready;
      return () => {
        void logBinding?.dispose();
        logBinding = null;
      };
    },
    sendInput(data: string) {
      void getConversationsClient()
        .then((client) => client.tui.sendInput({ conversationId, data }))
        .then((result) => {
          if (!result.success) log.warn('lanes: TUI input failed', { conversationId });
          onInputHealth(result.success);
        })
        .catch((error: unknown) => {
          log.warn('lanes: TUI input failed', { conversationId, error });
          onInputHealth(false);
        });
    },
    resize(cols: number, rows: number) {
      void getConversationsClient().then((client) =>
        client.tui.resize({ conversationId, cols, rows })
      );
    },
  };
}

/**
 * The lane's agent terminal. The PTY lives in main; unmounting (sleep, a
 * browser toggle) only detaches this view, and remounting replays the log.
 */
export const LaneTerminal = observer(function LaneTerminal({
  lane,
  focused,
}: {
  /** A lane, or any PTY conversation in a Task (the Brain drawer renders sessions here). */
  lane: Pick<Lane, 'conversationId' | 'projectId' | 'taskId'>;
  focused: boolean;
}) {
  const [inputHealthy, setInputHealthy] = useState(true);
  // A lane-specific session id, so this view never collides with the same
  // conversation open in its task view.
  const [session] = useState(
    () =>
      new PtySession(
        `lane-${lane.conversationId}`,
        undefined,
        undefined,
        undefined,
        createLaneTuiConnector(lane.conversationId, setInputHealthy)
      )
  );
  const terminalRef = useRef<{ focus: () => void }>(null);
  useEffect(() => () => session.destroy(), [session]);
  const ready = session.status === 'ready' && session.pty !== null;
  // A reconnect (sleep/wake, relaunch) may have fixed things; don't keep showing a stale warning.
  useEffect(() => {
    setInputHealthy(true);
  }, [ready]);
  useEffect(() => {
    if (focused && ready) terminalRef.current?.focus();
  }, [focused, ready]);

  if (!ready || !session.pty) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size="sm" />
      </div>
    );
  }
  return (
    <div className="relative h-full w-full">
      {!inputHealthy && (
        <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-center gap-1.5 bg-background-warning px-2 py-1 text-xs text-foreground-warning">
          <TriangleAlert className="h-3 w-3 shrink-0" />
          Keystrokes aren't reaching the agent. Try Relaunch agent from the lane menu.
        </div>
      )}
      <PtyPane
        ref={terminalRef}
        sessionId={session.sessionId}
        pty={session.pty}
        workspaceId={getTaskStore(lane.projectId, lane.taskId)?.workspaceId ?? ''}
        mapShiftEnterToCtrlJ
        className="h-full w-full"
      />
    </div>
  );
});
