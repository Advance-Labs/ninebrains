import { Button, Dialog, Textarea } from '@emdash/ui/react/primitives';
import { useState } from 'react';
import { PLANNER_LIMITS } from '@core/features/planner/api';

export interface DraftFromBriefModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves to an error message, or null when the draft landed on the canvas. */
  onSubmit: (brief: string) => Promise<string | null>;
}

/**
 * Collects a brief and asks the Brain for a draft. Proposed nodes land on the
 * canvas dashed; the user accepts or rejects them there, not in this modal.
 */
export function DraftFromBriefModal({ open, onOpenChange, onSubmit }: DraftFromBriefModalProps) {
  const [brief, setBrief] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!brief.trim() || busy) return;
    setBusy(true);
    setError(null);
    const failure = await onSubmit(brief.trim());
    setBusy(false);
    if (failure) {
      setError(failure);
      return;
    }
    setBrief('');
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <Dialog.Content size="md">
        <Dialog.Header>
          <Dialog.Title>Draft from brief</Dialog.Title>
          <Dialog.Description>
            Describe the outcome. The Brain proposes jobs and dependencies; you accept or reject
            them on the canvas.
          </Dialog.Description>
        </Dialog.Header>
        <Dialog.Body>
          <Textarea
            aria-label="Brief"
            rows={6}
            maxLength={PLANNER_LIMITS.briefChars}
            placeholder="Ship a login page with email magic links, tests and a screenshot check."
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
          />
          {error ? (
            <p role="alert" className="mt-3 text-sm text-foreground-warning">
              {error}
            </p>
          ) : null}
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void submit()} disabled={!brief.trim() || busy}>
            {busy ? 'Drafting…' : 'Draft'}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
