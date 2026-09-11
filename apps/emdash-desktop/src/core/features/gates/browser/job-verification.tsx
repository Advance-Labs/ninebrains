import { Badge, Button, Text } from '@emdash/ui/react/primitives';
import { useCallback, useEffect, useState } from 'react';
import type { AttemptHistory, GateVerdict, JobVerificationView } from '../api';
import { getGatesClient } from '../api/browser/client';

type BadgeTone = 'neutral' | 'success' | 'warning' | 'error' | 'info';

/** Returns a data URL for images and decoded text for everything else, or null. */
export type LoadEvidence = (attempt: number, file: string) => Promise<string | null>;

const LOG_LINES = 40;
const SHOT_WIDTHS = [1440, 768, 390];

const shotWidth = (file: string) => Number(/-(\d+)\.png$/.exec(file)?.[1] ?? 0);

function latestBadge(view: JobVerificationView): { tone: BadgeTone; label: string; hint: string } {
  if (view.state === 'verifying') {
    return { tone: 'info', label: 'Verifying', hint: 'Gates are running now.' };
  }
  if (view.state === 'blocked') {
    return { tone: 'error', label: 'Blocked', hint: 'The job needs your attention.' };
  }
  if (view.latest?.status === 'unverified') {
    return {
      tone: 'warning',
      label: 'Unverified',
      hint: 'No gate applied to this job, so only the worker judged it.',
    };
  }
  if (view.latest?.verified) {
    return { tone: 'success', label: 'Verified', hint: 'Every gate passed.' };
  }
  return { tone: 'neutral', label: view.state, hint: '' };
}

function attemptBadge(
  entry: AttemptHistory,
  inProgress: boolean
): { tone: BadgeTone; label: string } {
  const verdict = entry.verdict;
  if (!verdict)
    return inProgress
      ? { tone: 'info', label: 'Running' }
      : { tone: 'neutral', label: 'Interrupted' };
  if (verdict.decision === 'pass') {
    return verdict.status === 'unverified'
      ? { tone: 'warning', label: 'Unverified' }
      : { tone: 'success', label: 'Passed' };
  }
  if (verdict.decision === 'retry') return { tone: 'error', label: 'Failed, sent back' };
  return { tone: 'error', label: verdict.nonRetryable ? 'Blocked: setup' : 'Blocked' };
}

const GATE_TONE: Record<GateVerdict['status'], BadgeTone> = {
  pass: 'success',
  fail: 'error',
  timeout: 'warning',
  error: 'warning',
  cancelled: 'neutral',
};

function useEvidence(load: LoadEvidence, attempt: number, file: string, enabled = true) {
  const [value, setValue] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void load(attempt, file).then((next) => {
      if (!cancelled) setValue(next);
    });
    return () => {
      cancelled = true;
    };
  }, [load, attempt, file, enabled]);
  return value;
}

function Thumbnail(props: {
  attempt: number;
  file: string;
  load: LoadEvidence;
  onOpen: (src: string, label: string) => void;
}) {
  const src = useEvidence(props.load, props.attempt, props.file);
  const label = `${shotWidth(props.file)} px`;
  return (
    <figure className="flex min-w-0 flex-col gap-1">
      <button
        type="button"
        aria-label={`Enlarge the ${label} screenshot`}
        className="flex h-28 items-start justify-center overflow-hidden rounded-md border border-border bg-background-secondary"
        disabled={!src}
        onClick={() => src && props.onOpen(src, `Attempt ${props.attempt}, ${label}`)}
      >
        {src ? (
          <img
            src={src}
            alt={`Screenshot at ${label}`}
            className="w-full object-cover object-top"
          />
        ) : (
          <Text variant="description" tone="muted" className="self-center">
            {src === null ? 'Unavailable' : 'Loading…'}
          </Text>
        )}
      </button>
      <figcaption>
        <Text variant="description" tone="muted">
          {label}
        </Text>
      </figcaption>
    </figure>
  );
}

function LogExcerpt(props: { attempt: number; file: string; label: string; load: LoadEvidence }) {
  const [open, setOpen] = useState(false);
  const text = useEvidence(props.load, props.attempt, props.file, open);
  const tail = text ? text.split('\n').slice(-LOG_LINES).join('\n') : '';
  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} className="self-start">
        {open ? 'Hide' : 'Show'} {props.label}
      </Button>
      {open && (
        <pre className="max-h-56 overflow-auto rounded-md border border-border bg-background-secondary p-2 text-xs whitespace-pre-wrap text-foreground">
          {text === undefined ? 'Loading…' : text === null ? 'This log is unavailable.' : tail}
        </pre>
      )}
    </div>
  );
}

function GateRow(props: { gate: GateVerdict; attempt: number; load: LoadEvidence }) {
  const { gate } = props;
  const logs = gate.evidence.filter((e) => e.kind === 'log' || e.kind === 'text');
  return (
    <li className="flex flex-col gap-1 border-t border-border py-2 first:border-t-0">
      <div className="flex items-center gap-2">
        <Text variant="body" className="font-medium">
          {gate.title}
        </Text>
        <Badge tone={GATE_TONE[gate.status]}>{gate.status}</Badge>
        <Text variant="description" tone="muted">
          {(gate.durationMs / 1000).toFixed(1)} s
        </Text>
      </div>
      {gate.status !== 'pass' && (
        <Text as="p" variant="description" className="whitespace-pre-wrap text-foreground-muted">
          {gate.feedback}
        </Text>
      )}
      {logs.map((log) => (
        <LogExcerpt
          key={log.file}
          attempt={props.attempt}
          file={log.file}
          label={log.label}
          load={props.load}
        />
      ))}
    </li>
  );
}

function AttemptSection(props: {
  entry: AttemptHistory;
  inProgress: boolean;
  load: LoadEvidence;
  onOpen: (src: string, label: string) => void;
}) {
  const { entry } = props;
  const badge = attemptBadge(entry, props.inProgress);
  const shots = entry.evidence
    .filter((e) => e.kind === 'screenshot' && e.file.startsWith('screenshot-'))
    .sort(
      (a, b) => SHOT_WIDTHS.indexOf(shotWidth(a.file)) - SHOT_WIDTHS.indexOf(shotWidth(b.file))
    );
  return (
    <section
      aria-label={`Attempt ${entry.attempt}`}
      className="flex flex-col gap-3 rounded-lg border border-border p-3"
    >
      <div className="flex items-center gap-2">
        <Text variant="body" className="font-medium">
          Attempt {entry.attempt}
        </Text>
        <Badge tone={badge.tone}>{badge.label}</Badge>
      </div>
      {shots.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {shots.map((shot) => (
            <Thumbnail
              key={shot.file}
              attempt={entry.attempt}
              file={shot.file}
              load={props.load}
              onOpen={props.onOpen}
            />
          ))}
        </div>
      )}
      {entry.verdict && entry.verdict.gates.length > 0 ? (
        <ul className="flex flex-col">
          {entry.verdict.gates.map((gate) => (
            <GateRow key={gate.gateId} gate={gate} attempt={entry.attempt} load={props.load} />
          ))}
        </ul>
      ) : entry.verdict ? (
        <Text variant="description" tone="muted">
          No gate applied to this attempt.
        </Text>
      ) : null}
    </section>
  );
}

export function VerificationPanel(props: { view: JobVerificationView; load: LoadEvidence }) {
  const { view } = props;
  const [enlarged, setEnlarged] = useState<{ src: string; label: string } | null>(null);
  const badge = latestBadge(view);
  const attempts = [...view.history].reverse();
  const newest = view.history.at(-1)?.attempt;
  return (
    <div className="flex flex-col gap-4" data-testid="job-verification">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Text variant="body" className="font-medium text-foreground">
            {view.title}
          </Text>
          <Badge tone={badge.tone} title={badge.hint}>
            {badge.label}
          </Badge>
          <Badge variant="outline">{view.kind}</Badge>
        </div>
        <Text variant="description" tone="muted">
          {view.history.length} {view.history.length === 1 ? 'attempt' : 'attempts'} ·{' '}
          {view.attempts} of {view.maxAttempts} failures allowed used
          {badge.hint ? ` · ${badge.hint}` : ''}
        </Text>
      </div>
      {attempts.length === 0 && (
        <Text variant="description" tone="muted">
          No verification has run for this job yet.
        </Text>
      )}
      {attempts.map((entry) => (
        <AttemptSection
          key={entry.attempt}
          entry={entry}
          inProgress={view.state === 'verifying' && entry.attempt === newest}
          load={props.load}
          onOpen={(src, label) => setEnlarged({ src, label })}
        />
      ))}
      {view.workerArtifacts.length > 0 && (
        <div className="flex flex-col gap-1">
          <Text variant="body" className="font-medium">
            Worker-supplied files
          </Text>
          <Text variant="description" tone="muted">
            Reported by the agent with its result. They are not evidence: no gate relies on them.
          </Text>
          <ul className="list-disc pl-5">
            {view.workerArtifacts.map((file) => (
              <li key={file}>
                <Text variant="description">{file}</Text>
              </li>
            ))}
          </ul>
        </div>
      )}
      {enlarged && (
        <div
          role="dialog"
          aria-label={enlarged.label}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-2 bg-background p-6"
        >
          <img src={enlarged.src} alt={enlarged.label} className="max-h-[85vh] max-w-full" />
          <div className="flex items-center gap-3">
            <Text variant="description" tone="muted">
              {enlarged.label}
            </Text>
            <Button size="sm" variant="ghost" onClick={() => setEnlarged(null)}>
              Close
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function decodeBase64(base64: string): string {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Loads the view for a job and renders it. The modal wraps this in dialog chrome. */
export function JobVerification(props: { jobId: string; reloadKey?: number }) {
  const [state, setState] = useState<
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
    | { kind: 'ready'; view: JobVerificationView }
  >({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void getGatesClient()
      .then((client) => client.getVerification({ jobId: props.jobId }))
      .then((result) => {
        if (cancelled) return;
        setState(
          result.success
            ? { kind: 'ready', view: result.data }
            : { kind: 'error', message: result.error.message }
        );
      });
    return () => {
      cancelled = true;
    };
  }, [props.jobId, props.reloadKey]);

  const load = useCallback<LoadEvidence>(
    async (attempt, file) => {
      const client = await getGatesClient();
      const result = await client.readEvidence({ jobId: props.jobId, attempt, file });
      if (!result.success) return null;
      const { mime, base64 } = result.data;
      return mime.startsWith('image/') ? `data:${mime};base64,${base64}` : decodeBase64(base64);
    },
    [props.jobId]
  );

  if (state.kind === 'loading') {
    return (
      <Text variant="description" tone="muted">
        Loading verification…
      </Text>
    );
  }
  if (state.kind === 'error') {
    return (
      <Text variant="description" tone="muted">
        {state.message}
      </Text>
    );
  }
  return <VerificationPanel view={state.view} load={load} />;
}
