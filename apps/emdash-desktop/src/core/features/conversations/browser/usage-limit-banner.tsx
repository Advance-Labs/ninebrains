import type { TuiUsageLimit } from '@emdash/core/runtimes/tui-agents/api';
import { Alert } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';

export const UsageLimitBanner = observer(function UsageLimitBanner({
  usageLimit,
}: {
  usageLimit: TuiUsageLimit;
}) {
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);

  if (dismissedAt === usageLimit.detectedAt) return null;

  return (
    <Alert.Root
      status="warning"
      className="absolute inset-x-2 top-2 z-20 shadow-sm"
      onDismiss={() => setDismissedAt(usageLimit.detectedAt)}
    >
      <Alert.Title>Usage limit reached</Alert.Title>
      <Alert.Description>{usageLimit.message}</Alert.Description>
    </Alert.Root>
  );
});
