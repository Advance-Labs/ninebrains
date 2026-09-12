import { Button, Dialog, Text } from '@emdash/ui/react/primitives';
import { useState } from 'react';
import { defineModal } from '@core/primitives/modals/react';
import { getGatesClient } from '../api/browser/client';
import { JobVerification } from './job-verification';

export type JobVerificationModalArgs = { jobId: string };

/**
 * Header, a scrolling body and footer as direct children of the dialog's flex
 * column. `ModalLayout`'s animated height would break the column, so a long
 * history pushed the footer off screen.
 */
export function JobVerificationModal({ jobId }: JobVerificationModalArgs) {
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  const deleteEvidence = async () => {
    const result = await (await getGatesClient()).deleteEvidence({ jobId });
    setStatus(result.success ? 'Evidence deleted.' : result.error.message);
    setReloadKey((key) => key + 1);
  };

  return (
    <>
      <Dialog.Header>
        <Dialog.Title>Job verification</Dialog.Title>
      </Dialog.Header>
      <Dialog.Body className="min-h-0 flex-1 gap-4 overflow-y-auto">
        <JobVerification jobId={jobId} reloadKey={reloadKey} />
      </Dialog.Body>
      <Dialog.Footer>
        {status && (
          <Text variant="description" tone="muted" className="mr-auto">
            {status}
          </Text>
        )}
        <Button variant="ghost" onClick={() => void deleteEvidence()}>
          Delete evidence
        </Button>
        <Dialog.Close render={<Button variant="primary">Close</Button>} />
      </Dialog.Footer>
    </>
  );
}

export const jobVerificationModal = defineModal<void>()({
  id: 'jobVerificationModal',
  component: JobVerificationModal,
  size: 'lg',
});
