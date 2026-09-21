import { Button } from '@emdash/ui/react/primitives';
import { ArrowUpCircle, X } from 'lucide-react';
import { BRAND_NAME } from '@core/primitives/app-identity/api/app-identity';

export type ReleaseNoticeViewProps = {
  version: string;
  onOpen: () => void;
  onDismiss: () => void;
};

export function ReleaseNoticeView({ version, onOpen, onDismiss }: ReleaseNoticeViewProps) {
  return (
    <div
      role="status"
      className="mb-2 flex items-center gap-1 rounded-lg border border-border bg-background-secondary pl-3 text-sm"
      data-testid="release-notice"
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-2 text-left text-foreground focus:outline-none focus-visible:underline"
        onClick={onOpen}
      >
        <ArrowUpCircle className="size-4 shrink-0" />
        <span className="truncate">
          {BRAND_NAME} {version} is out
        </span>
      </button>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        icon
        aria-label={`Hide the notice for ${BRAND_NAME} ${version}`}
        onClick={onDismiss}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
