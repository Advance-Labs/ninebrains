import { Spinner } from '@emdash/ui/react/primitives';
import { ReplicaLog } from '@emdash/wire/live';
import type { Terminal } from '@xterm/xterm';
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
 */
function createLaneTuiConnector(conversationId: string): FrontendPtyConnector {
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
        })
        .catch((error: unknown) => log.warn('lanes: TUI input failed', { conversationId, error }));
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
  lane: Lane;
  focused: boolean;
}) {
  // A lane-specific session id, so this view never collides with the same
  // conversation open in its task view.
  const [session] = useState(
    () =>
      new PtySession(
        `lane-${lane.conversationId}`,
        undefined,
        undefined,
        undefined,
        createLaneTuiConnector(lane.conversationId)
      )
  );
  const terminalRef = useRef<{ focus: () => void }>(null);
  useEffect(() => () => session.destroy(), [session]);
  const ready = session.status === 'ready' && session.pty !== null;
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
    <PtyPane
      ref={terminalRef}
      sessionId={session.sessionId}
      pty={session.pty}
      workspaceId={getTaskStore(lane.projectId, lane.taskId)?.workspaceId ?? ''}
      mapShiftEnterToCtrlJ
      className="h-full w-full"
    />
  );
});
