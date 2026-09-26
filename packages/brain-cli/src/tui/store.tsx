import type {
  BrainRequest,
  BrainResponse,
  HttpBrainClient,
  JobSummary,
  Lane,
  MessageView,
  Note,
} from '@ninebrains/brain-core';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

interface BrainDispatcherView {
  paused: boolean;
  stopLatched: boolean;
  laneModes: Record<string, 'attended' | 'unattended'>;
  activeRuns: number;
  gatesConnected: boolean;
  unattendedBudgets: unknown;
}

export type TuiView =
  | 'dashboard'
  | 'jobs'
  | 'lanes'
  | 'notes'
  | 'messages'
  | 'create-job'
  | 'send-message';

interface TuiState {
  view: TuiView;
  previousView: TuiView | null;
  jobs: JobSummary[];
  lanes: Lane[];
  notes: Note[];
  messages: MessageView[];
  dispatcherStatus: BrainDispatcherView | null;
  selectedJobId: string | null;
  selectedLaneId: string | null;
  loading: boolean;
  error: string | null;
  lastRefresh: number;
  showHelp: boolean;
  projectId: string | null;
}

interface TuiActions {
  setView(view: TuiView): void;
  goBack(): void;
  refresh(): Promise<void>;
  createJob(params: {
    title: string;
    body?: string;
    dependsOn?: string[];
    gates?: string[];
  }): Promise<BrainResponse>;
  sendMessage(to: { kind: 'lane' | 'brain'; id: string }, body: string): Promise<BrainResponse>;
  readInbox(limit?: number): Promise<void>;
  setSelectedJobId(id: string | null): void;
  setSelectedLaneId(id: string | null): void;
  toggleHelp(): void;
  blockJob(jobId: string, reason: string): Promise<BrainResponse>;
  completeJob(jobId: string, summary: string): Promise<BrainResponse>;
  requeueJob(jobId: string): Promise<BrainResponse>;
  assignJob(jobId: string, laneId: string): Promise<BrainResponse>;
  setLaneMode(laneId: string, mode: 'attended' | 'unattended'): Promise<BrainResponse>;
  addNote(body: string, jobId?: string): Promise<BrainResponse>;
  pauseDispatcher(): Promise<BrainResponse>;
  resumeDispatcher(): Promise<BrainResponse>;
  stopAll(): Promise<BrainResponse>;
  clearStop(): Promise<BrainResponse>;
}

const BrainStoreContext = createContext<(TuiState & TuiActions) | null>(null);

export function useBrainStore() {
  const ctx = useContext(BrainStoreContext);
  if (!ctx) throw new Error('useBrainStore must be used within BrainStoreProvider');
  return ctx;
}

interface BrainStoreProviderProps {
  client: HttpBrainClient;
  projectId: string | undefined;
}

function makeRequest(op: BrainRequest['op'], args: unknown): BrainRequest {
  return { v: 1, op, args } as BrainRequest;
}

export function BrainStoreProvider({
  client,
  projectId,
  children,
}: React.PropsWithChildren<BrainStoreProviderProps>) {
  const [state, setState] = useState<TuiState>({
    view: 'dashboard',
    previousView: null,
    jobs: [],
    lanes: [],
    notes: [],
    messages: [],
    dispatcherStatus: null,
    selectedJobId: null,
    selectedLaneId: null,
    loading: false,
    error: null,
    lastRefresh: 0,
    showHelp: false,
    projectId: projectId ?? null,
  });

  const call = useCallback(
    async (request: BrainRequest): Promise<BrainResponse> => {
      try {
        return await client.call(request);
      } catch (err) {
        return {
          ok: false,
          error: {
            code: 'UNAVAILABLE',
            message: err instanceof Error ? err.message : String(err),
          },
        };
      }
    },
    [client]
  );

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    const projectArgs = state.projectId ? { projectId: state.projectId } : {};

    const [jobsRes, lanesRes, notesRes, statusRes] = await Promise.all([
      call(makeRequest('list_jobs', { ...projectArgs, limit: 100 })),
      call(makeRequest('list_lanes', projectArgs)),
      call(makeRequest('list_notes', { ...projectArgs, limit: 50 })),
      call(makeRequest('dispatcher_status', {})),
    ]);

    const jobs = jobsRes.ok ? (jobsRes.result as JobSummary[]) : [];
    const lanes = lanesRes.ok ? (lanesRes.result as Lane[]) : [];
    const notes = notesRes.ok ? (notesRes.result as Note[]) : [];
    const dispatcherStatus = statusRes.ok ? (statusRes.result as BrainDispatcherView) : null;

    const error =
      !jobsRes.ok && jobsRes.error.code !== 'UNAVAILABLE'
        ? `Jobs: ${jobsRes.error.message}`
        : !lanesRes.ok && lanesRes.error.code !== 'UNAVAILABLE'
          ? `Lanes: ${lanesRes.error.message}`
          : !statusRes.ok && statusRes.error.code !== 'UNAVAILABLE'
            ? `Status: ${statusRes.error.message}`
            : null;

    setState((s) => ({
      ...s,
      jobs,
      lanes,
      notes,
      dispatcherStatus,
      loading: false,
      error,
      lastRefresh: Date.now(),
    }));
  }, [call, state.projectId]);

  // Initial load and polling
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    void refreshRef.current();
    const interval = setInterval(() => void refreshRef.current(), 5000);
    return () => clearInterval(interval);
  }, []);

  const setView = useCallback((view: TuiView) => {
    setState((s) => ({ ...s, previousView: s.view, view, showHelp: false }));
  }, []);

  const goBack = useCallback(() => {
    setState((s) => ({
      ...s,
      view: s.previousView ?? 'dashboard',
      previousView: null,
      showHelp: false,
    }));
  }, []);

  const setSelectedJobId = useCallback((id: string | null) => {
    setState((s) => ({ ...s, selectedJobId: id }));
  }, []);

  const setSelectedLaneId = useCallback((id: string | null) => {
    setState((s) => ({ ...s, selectedLaneId: id }));
  }, []);

  const toggleHelp = useCallback(() => {
    setState((s) => ({ ...s, showHelp: !s.showHelp }));
  }, []);

  const createJob = useCallback(
    async (params: { title: string; body?: string; dependsOn?: string[]; gates?: string[] }) => {
      const args: Record<string, unknown> = {
        title: params.title,
        ...(params.body ? { body: params.body } : {}),
        ...(params.dependsOn?.length ? { dependsOn: params.dependsOn } : {}),
        ...(params.gates?.length ? { gates: params.gates } : {}),
        ...(state.projectId ? { projectId: state.projectId } : {}),
      };
      const res = await call(makeRequest('create_job', args));
      if (res.ok) void refreshRef.current();
      return res;
    },
    [call, state.projectId]
  );

  const sendMessage = useCallback(
    async (to: { kind: 'lane' | 'brain'; id: string }, body: string) => {
      const res = await call(
        makeRequest('send_message', {
          to: { kind: to.kind, id: to.id },
          body,
        })
      );
      if (res.ok) void refreshRef.current();
      return res;
    },
    [call]
  );

  const readInbox = useCallback(
    async (limit = 50) => {
      const res = await call(makeRequest('read_inbox', { limit }));
      if (res.ok) {
        setState((s) => ({ ...s, messages: res.result as MessageView[] }));
      }
    },
    [call]
  );

  const blockJob = useCallback(
    async (jobId: string, reason: string) => {
      const res = await call(makeRequest('block_job', { jobId, reason }));
      if (res.ok) void refreshRef.current();
      return res;
    },
    [call]
  );

  const completeJob = useCallback(
    async (jobId: string, summary: string) => {
      const res = await call(makeRequest('complete_job', { jobId, summary }));
      if (res.ok) void refreshRef.current();
      return res;
    },
    [call]
  );

  const requeueJob = useCallback(
    async (jobId: string) => {
      const res = await call(makeRequest('requeue_job', { jobId }));
      if (res.ok) void refreshRef.current();
      return res;
    },
    [call]
  );

  const assignJob = useCallback(
    async (jobId: string, laneId: string) => {
      const res = await call(makeRequest('assign_job', { jobId, laneId }));
      if (res.ok) void refreshRef.current();
      return res;
    },
    [call]
  );

  const setLaneMode = useCallback(
    async (laneId: string, mode: 'attended' | 'unattended') => {
      const res = await call(makeRequest('set_lane_mode', { laneId, mode }));
      if (res.ok) void refreshRef.current();
      return res;
    },
    [call]
  );

  const addNote = useCallback(
    async (body: string, jobId?: string) => {
      const args: Record<string, unknown> = {
        body,
        ...(jobId ? { jobId } : {}),
        ...(state.projectId ? { projectId: state.projectId } : {}),
      };
      const res = await call(makeRequest('add_note', args));
      if (res.ok) void refreshRef.current();
      return res;
    },
    [call, state.projectId]
  );

  const pauseDispatcher = useCallback(async () => {
    const res = await call(makeRequest('set_dispatcher_paused', { paused: true }));
    if (res.ok) void refreshRef.current();
    return res;
  }, [call]);

  const resumeDispatcher = useCallback(async () => {
    const res = await call(makeRequest('set_dispatcher_paused', { paused: false }));
    if (res.ok) void refreshRef.current();
    return res;
  }, [call]);

  const stopAll = useCallback(async () => {
    const res = await call(makeRequest('stop_all', {}));
    if (res.ok) void refreshRef.current();
    return res;
  }, [call]);

  const clearStop = useCallback(async () => {
    const res = await call(makeRequest('clear_stop', {}));
    if (res.ok) void refreshRef.current();
    return res;
  }, [call]);

  const value: TuiState & TuiActions = {
    ...state,
    setView,
    goBack,
    refresh,
    createJob,
    sendMessage,
    readInbox,
    setSelectedJobId,
    setSelectedLaneId,
    toggleHelp,
    blockJob,
    completeJob,
    requeueJob,
    assignJob,
    setLaneMode,
    addNote,
    pauseDispatcher,
    resumeDispatcher,
    stopAll,
    clearStop,
  };

  return <BrainStoreContext.Provider value={value}>{children}</BrainStoreContext.Provider>;
}
