import type {
  BrainRequest,
  BrainResponse,
  HttpBrainClient,
  JobSummary,
  Lane,
  MessageView,
  Note,
} from '@ninebrains/brain-core';
import { useApp } from 'ink';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { parseCommand, type Action, type Overlay } from './commands';
import {
  clean,
  diffSnapshots,
  dispatchHint,
  isActive,
  laneLabel,
  type FeedEntry,
  type FeedEvent,
  type Snapshot,
} from './feed';

export interface BrainDispatcherView {
  paused: boolean;
  stopLatched: boolean;
  laneModes: Record<string, 'attended' | 'unattended'>;
  activeRuns: number;
  gatesConnected: boolean;
  unattendedBudgets: unknown;
}

interface TuiState {
  jobs: JobSummary[];
  lanes: Lane[];
  notes: Note[];
  messages: MessageView[];
  dispatcherStatus: BrainDispatcherView | null;
  connected: boolean;
  feed: FeedEvent[];
  hint: string | null;
  /** When jobs started being held by lanes, for the working row's clock. Null when none are. */
  busySince: number | null;
  overlay: Overlay | null;
  projectId: string | null;
}

interface TuiActions {
  /** Runs one prompt line. Every outcome, good or bad, lands in the feed. */
  submit(line: string): Promise<void>;
  closeOverlay(): void;
}

export type BrainStore = TuiState & TuiActions;

const BrainStoreContext = createContext<BrainStore | null>(null);

export function useBrainStore(): BrainStore {
  const ctx = useContext(BrainStoreContext);
  if (!ctx) throw new Error('useBrainStore must be used within BrainStoreProvider');
  return ctx;
}

interface BrainStoreProviderProps {
  client: HttpBrainClient;
  projectId: string | undefined;
}

const FEED_LIMIT = 500;
const POLL_MS = 2_000;

function makeRequest(op: BrainRequest['op'], args: unknown): BrainRequest {
  return { v: 1, op, args } as BrainRequest;
}

export function BrainStoreProvider({
  client,
  projectId,
  children,
}: React.PropsWithChildren<BrainStoreProviderProps>) {
  const [state, setState] = useState<TuiState>({
    jobs: [],
    lanes: [],
    notes: [],
    messages: [],
    dispatcherStatus: null,
    connected: false,
    feed: [],
    hint: null,
    busySince: null,
    overlay: null,
    projectId: projectId ?? null,
  });
  const { exit } = useApp();
  const previous = useRef<Snapshot | null>(null);
  const lastHint = useRef<string | null>(null);
  const nextId = useRef(0);
  const projectArgs = useMemo(() => (projectId ? { projectId } : {}), [projectId]);

  const append = useCallback((entries: FeedEntry[]) => {
    if (entries.length === 0) return;
    const at = Date.now();
    const events = entries.map((entry) => ({
      ...entry,
      text: clean(entry.text),
      id: nextId.current++,
      at,
    }));
    setState((s) => ({ ...s, feed: [...s.feed, ...events].slice(-FEED_LIMIT) }));
  }, []);

  const call = useCallback(
    async (request: BrainRequest): Promise<BrainResponse> => {
      try {
        return await client.call(request);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: { code: 'UNAVAILABLE', message } };
      }
    },
    [client]
  );

  const refresh = useCallback(async () => {
    const [jobsRes, lanesRes, notesRes, statusRes] = await Promise.all([
      call(makeRequest('list_jobs', { ...projectArgs, limit: 100 })),
      call(makeRequest('list_lanes', projectArgs)),
      call(makeRequest('list_notes', { ...projectArgs, limit: 50 })),
      call(makeRequest('dispatcher_status', {})),
    ]);
    if (!jobsRes.ok || !lanesRes.ok) {
      const error = !jobsRes.ok ? jobsRes.error : !lanesRes.ok ? lanesRes.error : null;
      if (previous.current) {
        append([{ tone: 'fail', kind: 'brain', text: `lost the Brain: ${error?.message ?? ''}` }]);
      }
      previous.current = null;
      setState((s) => ({ ...s, connected: false }));
      return;
    }

    // Sanitized once here, so the feed, overlays and working row never see a raw control byte.
    const jobs = (jobsRes.result as JobSummary[]).map((job) => ({
      ...job,
      title: clean(job.title),
      body: clean(job.body),
      ...(job.reason ? { reason: clean(job.reason) } : {}),
    }));
    const lanes = lanesRes.result as Lane[];
    const status = statusRes.ok ? (statusRes.result as BrainDispatcherView) : null;
    const snapshot: Snapshot = {
      jobs,
      lanes,
      paused: status?.paused ?? false,
      stopLatched: status?.stopLatched ?? false,
    };
    const hint = dispatchHint(snapshot);
    const entries: FeedEntry[] = previous.current
      ? diffSnapshots(previous.current, snapshot)
      : [
          {
            tone: 'ok',
            kind: 'brain',
            text: `connected · ${jobs.length} jobs · ${lanes.map(laneLabel).join(', ') || 'no lanes'}`,
          },
        ];
    if (hint && hint !== lastHint.current)
      entries.push({ tone: 'warn', kind: 'brain', text: hint });
    previous.current = snapshot;
    lastHint.current = hint;
    append(entries);
    setState((s) => ({
      ...s,
      jobs,
      lanes,
      notes: notesRes.ok
        ? (notesRes.result as Note[]).map((note) => ({ ...note, body: clean(note.body) }))
        : s.notes,
      dispatcherStatus: status,
      connected: true,
      hint,
      busySince: jobs.some(isActive) ? (s.busySince ?? Date.now()) : null,
    }));
  }, [call, append, projectArgs]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    void refreshRef.current();
    const interval = setInterval(() => void refreshRef.current(), POLL_MS);
    return () => clearInterval(interval);
  }, []);

  const request = useCallback(
    (action: Exclude<Action, { type: 'overlay' } | { type: 'quit' }>): BrainRequest => {
      switch (action.type) {
        case 'new':
          return makeRequest('create_job', {
            ...projectArgs,
            title: action.title,
            ...(action.body ? { body: action.body } : {}),
          });
        case 'send':
          return makeRequest('send_message', { to: action.to, body: action.body });
        case 'assign':
          return makeRequest('assign_job', { jobId: action.jobId, laneId: action.laneId });
        case 'requeue':
          return makeRequest('requeue_job', { jobId: action.jobId });
        case 'block':
          return makeRequest('block_job', { jobId: action.jobId, reason: action.reason });
        case 'complete':
          return makeRequest('complete_job', { jobId: action.jobId, summary: action.summary });
        case 'note':
          return makeRequest('add_note', { ...projectArgs, body: action.body });
        case 'mode':
          return makeRequest('set_lane_mode', { laneId: action.laneId, mode: action.mode });
        case 'pause':
        case 'resume':
          return makeRequest('set_dispatcher_paused', { paused: action.type === 'pause' });
        case 'stop':
          return makeRequest('stop_all', {});
        case 'clear-stop':
          return makeRequest('clear_stop', {});
      }
    },
    [projectArgs]
  );

  const submit = useCallback(
    async (line: string) => {
      const parsed = parseCommand(line, { jobs: state.jobs, lanes: state.lanes });
      if (!parsed.ok) {
        append([{ tone: 'warn', kind: 'you', text: parsed.error }]);
        return;
      }
      const { action } = parsed;
      if (action.type === 'quit') {
        exit();
        return;
      }
      if (action.type === 'overlay') {
        if (action.overlay === 'inbox') {
          // Reading marks the messages read, so the inbox loads only when asked for.
          const res = await call(makeRequest('read_inbox', { limit: 50 }));
          if (res.ok) {
            const messages = (res.result as MessageView[]).map((m) => ({
              ...m,
              body: clean(m.body),
            }));
            setState((s) => ({ ...s, messages }));
          }
        }
        setState((s) => ({ ...s, overlay: action.overlay }));
        return;
      }
      const res = await call(request(action));
      append([
        res.ok
          ? { tone: 'ok', kind: 'you', text: line.trim() }
          : { tone: 'fail', kind: 'you', text: `${line.trim()}: ${res.error.message}` },
      ]);
      if (res.ok) void refreshRef.current();
    },
    [state.jobs, state.lanes, append, call, request, exit]
  );

  const closeOverlay = useCallback(() => setState((s) => ({ ...s, overlay: null })), []);

  return (
    <BrainStoreContext.Provider value={{ ...state, submit, closeOverlay }}>
      {children}
    </BrainStoreContext.Provider>
  );
}
