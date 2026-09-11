import { Alert, Badge, Button, Spinner, Textarea } from '@emdash/ui/react/primitives';
import { useState, type ReactNode } from 'react';
import { cn } from '@core/primitives/styling/browser/cn';
import { addressKey, type BrainAddress, type BrainMessageView, type BrainSessionView } from '../api';
import { runBrainAction, useBrainJobs, useBrainOverview } from './use-brain';

export type BrainDrawerProps = {
  /** Projects with a lane in the current tab; a Brain session is started in one of them. */
  projects: ReadonlyArray<{ projectId: string; name: string }>;
  lanes: ReadonlyArray<{ laneId: string; label: string }>;
  /** Renders a session's PTY (the lanes view owns the terminal component). */
  renderTerminal(session: BrainSessionView): ReactNode;
};

const STATE_ORDER = ['ready', 'running', 'verifying', 'blocked', 'done'] as const;

/**
 * The Brain drawer inside the Lanes view (SEAMS §3.9): Brain sessions (each a
 * `claude` PTY with a Brain-role token), the unread badge, per-lane inboxes
 * with a "message lane" action, and dispatcher state. Messages sent from here
 * go out as the selected Brain session (or `user`), so replies route back to it.
 */
export function BrainDrawer({ projects, lanes, renderTerminal }: BrainDrawerProps) {
  const { unread, sessions, dispatcher } = useBrainOverview();
  const [selected, setSelected] = useState<string | null>(null);
  const projectIds = new Set(projects.map((project) => project.projectId));
  const visible = sessions.filter((session) => projectIds.has(session.projectId));
  const active = visible.find((session) => session.brainId === selected) ?? visible[0] ?? null;
  const projectId = active?.projectId ?? projects[0]?.projectId ?? null;
  const jobs = useBrainJobs(projectId);
  const fromBrainId = active?.brainId ?? 'user';

  return (
    <aside
      aria-label="Brain"
      data-testid="brain-drawer"
      className="flex h-full min-w-0 flex-col border-l border-border bg-background-secondary"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm font-medium text-foreground">Brain</span>
        <Badge tone={dispatcher.stopLatched ? 'error' : dispatcher.paused ? 'warning' : 'success'}>
          {dispatcher.stopLatched ? 'stopped' : dispatcher.paused ? 'paused' : 'dispatching'}
        </Badge>
        {!dispatcher.gatesConnected && (
          <Badge tone="warning" variant="outline" title="No gate runner is connected: finished work is marked unverified.">
            gates off
          </Badge>
        )}
        <Button
          className="ml-auto"
          size="sm"
          variant="ghost"
          disabled={dispatcher.stopLatched}
          onClick={() =>
            void runBrainAction('Could not change dispatch', (c) =>
              c.setDispatcherPaused({ paused: !dispatcher.paused })
            )
          }
        >
          {dispatcher.paused ? 'Resume' : 'Pause'}
        </Button>
      </header>

      {dispatcher.stopLatched && (
        <div className="p-2">
          <Alert.Root status="destructive">
            <Alert.Title>STOP is latched</Alert.Title>
            <Alert.Description>
              No job is dispatched and no run starts until you clear it.
            </Alert.Description>
          </Alert.Root>
          <Button
            size="sm"
            className="mt-2"
            onClick={() => void runBrainAction('Could not clear STOP', (c) => c.clearStop())}
          >
            Clear STOP
          </Button>
        </div>
      )}

      <div role="tablist" className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1">
        {visible.map((session) => {
          const count = unread[addressKey({ kind: 'brain', id: session.brainId })] ?? 0;
          return (
            <Button
              key={session.brainId}
              role="tab"
              size="sm"
              variant="ghost"
              aria-selected={session.brainId === active?.brainId}
              className={cn('h-6 px-2 text-xs', session.brainId === active?.brainId && 'bg-(--em-accent-3)')}
              onClick={() => setSelected(session.brainId)}
            >
              {session.title}
              {count > 0 && <Badge tone="info">{count}</Badge>}
            </Button>
          );
        })}
        <Button
          size="sm"
          variant={visible.length === 0 ? 'primary' : 'ghost'}
          className="h-6 px-2 text-xs"
          disabled={projectId === null}
          title={projectId === null ? 'Add a lane to this tab first' : undefined}
          onClick={() =>
            projectId &&
            void runBrainAction('Could not start the Brain', (c) => c.startBrain({ projectId })).then(
              (started) => started && setSelected(started.brainId)
            )
          }
        >
          {visible.length === 0 ? 'Start Brain' : '+ Brain'}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-40 flex-1 border-b border-border">
          {active ? (
            <SessionBody session={active} renderTerminal={renderTerminal} />
          ) : (
            <p className="p-3 text-xs text-foreground-muted">
              Start a Brain to plan work in chat. It creates jobs; the app hands ready jobs to idle
              lanes and records what comes back.
            </p>
          )}
        </div>
        <JobCounts states={jobs.map((job) => job.state)} />
        <Inboxes lanes={lanes} unread={unread} fromBrainId={fromBrainId} brainInbox={active?.brainId ?? 'user'} />
      </div>
    </aside>
  );
}

function SessionBody({
  session,
  renderTerminal,
}: {
  session: BrainSessionView;
  renderTerminal: BrainDrawerProps['renderTerminal'];
}) {
  if (session.status === 'running') return <>{renderTerminal(session)}</>;
  if (session.status === 'starting') {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-xs text-foreground-muted">
        <Spinner size="sm" /> Starting the Brain…
      </div>
    );
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-3 text-xs text-foreground-muted">
      {session.error ?? 'This Brain session is stopped.'}
    </div>
  );
}

function JobCounts({ states }: { states: readonly string[] }) {
  if (states.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 border-b border-border px-3 py-2 text-xs text-foreground-muted">
      {STATE_ORDER.map((state) => {
        const count = states.filter((candidate) => candidate === state).length;
        return count > 0 ? (
          <Badge key={state} tone={state === 'blocked' ? 'error' : state === 'done' ? 'success' : 'neutral'}>
            {count} {state}
          </Badge>
        ) : null;
      })}
    </div>
  );
}

function Inboxes({
  lanes,
  unread,
  fromBrainId,
  brainInbox,
}: {
  lanes: BrainDrawerProps['lanes'];
  unread: Record<string, number>;
  fromBrainId: string;
  brainInbox: string;
}) {
  const [composing, setComposing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<BrainMessageView[] | null>(null);
  const inbox: BrainAddress = { kind: 'brain', id: brainInbox };
  const inboxCount = unread[addressKey(inbox)] ?? 0;

  const send = async (laneId: string) => {
    const sent = await runBrainAction('Could not send the message', (c) =>
      c.sendMessage({ fromBrainId, to: { kind: 'lane', id: laneId }, body: draft })
    );
    if (sent) {
      setDraft('');
      setComposing(null);
    }
  };

  return (
    <section aria-label="Inboxes" className="flex max-h-72 min-h-0 flex-col overflow-y-auto p-2 text-xs">
      <div className="flex items-center gap-1 px-1 pb-1">
        <span className="font-medium text-foreground">Inboxes</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-6 px-2 text-xs"
          onClick={() =>
            void runBrainAction('Could not read the inbox', (c) =>
              c.readInbox({ address: inbox, includeRead: true })
            ).then((read) => read && setMessages(read))
          }
        >
          Replies {inboxCount > 0 && <Badge tone="info">{inboxCount}</Badge>}
        </Button>
      </div>
      {messages && (
        <ul className="mb-2 flex flex-col gap-1">
          {messages.length === 0 && <li className="px-1 text-foreground-muted">No replies yet.</li>}
          {messages.map((message) => (
            <li key={message.id} className="rounded-md bg-background px-2 py-1">
              <div className="text-foreground-muted">
                from {message.from.kind} {message.from.id.slice(0, 8)}
                {message.untrusted && ' · agent-written'}
              </div>
              <div className="whitespace-pre-wrap text-foreground">{message.body}</div>
            </li>
          ))}
        </ul>
      )}
      <ul className="flex flex-col gap-1">
        {lanes.map((lane) => {
          const count = unread[addressKey({ kind: 'lane', id: lane.laneId })] ?? 0;
          return (
            <li key={lane.laneId} className="rounded-md px-1 py-0.5">
              <div className="flex items-center gap-1">
                <span className="truncate text-foreground">{lane.label}</span>
                {count > 0 && <Badge tone="info">{count} unread</Badge>}
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-6 px-2 text-xs"
                  onClick={() => setComposing(composing === lane.laneId ? null : lane.laneId)}
                >
                  Message
                </Button>
              </div>
              {composing === lane.laneId && (
                <div className="mt-1 flex flex-col gap-1">
                  <Textarea
                    aria-label={`Message ${lane.label}`}
                    value={draft}
                    rows={2}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <Button size="sm" disabled={!draft.trim()} onClick={() => void send(lane.laneId)}>
                    Send
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
