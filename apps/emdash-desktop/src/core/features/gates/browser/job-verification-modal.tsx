import { Button, Dialog, ModalLayout, Text } from '@emdash/ui/react/primitives';
import { useState } from 'react';
import { defineModal } from '@core/primitives/modals/react';
import { getGatesClient } from '../api/browser/client';
import { JobVerification } from './job-verification';

export type JobVerificationModalArgs = { jobId: string };

export function JobVerificationModal({ jobId }: JobVerificationModalArgs) {
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  const deleteEvidence = async () => {
    const result = await (await getGatesClient()).deleteEvidence({ jobId });
    setStatus(result.success ? 'Evidence deleted.' : result.error.message);
    setReloadKey((key) => key + 1);
  };

  return (
    <ModalLayout
      header={
        <Dialog.Header>
          <Dialog.Title>Job verification</Dialog.Title>
        </Dialog.Header>
      }
      footer={
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
      }
    >
      <Dialog.Body className="gap-4 overflow-y-auto">
        <JobVerification jobId={jobId} reloadKey={reloadKey} />
      </Dialog.Body>
    </ModalLayout>
  );
}

export const jobVerificationModal = defineModal<void>()({
  id: 'jobVerificationModal',
  component: JobVerificationModal,
  size: 'lg',
});
