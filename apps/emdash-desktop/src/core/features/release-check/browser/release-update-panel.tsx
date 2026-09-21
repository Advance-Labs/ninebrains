import { Button, Text } from '@emdash/ui/react/primitives';
import { ArrowUpRight, Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { BRAND_NAME } from '@core/primitives/app-identity/api/app-identity';
import type { InstallCommand } from '../api/release-links';

export type ReleaseUpdatePanelProps = {
  version: string;
  install: InstallCommand;
  onDownload: () => void;
  onCopyCommand: (command: string) => Promise<unknown> | void;
  onOpenReleaseNotes: () => void;
};

/**
 * Settings → General when a newer release exists. The app never downloads or installs anything
 * (SEC-36): the primary action opens the download page, the secondary one copies the installer
 * one-liner for the user to run themselves.
 */
export function ReleaseUpdatePanel({
  version,
  install,
  onDownload,
  onCopyCommand,
  onOpenReleaseNotes,
}: ReleaseUpdatePanelProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-border px-4 py-4"
      data-testid="release-update-panel"
    >
      <div className="flex items-baseline justify-between gap-3">
        <Text variant="body" className="text-foreground">
          {BRAND_NAME} {version} is available
        </Text>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="inline-flex items-center gap-1"
          onClick={onOpenReleaseNotes}
        >
          What&apos;s new
          <ArrowUpRight className="size-3.5" />
        </Button>
      </div>
      <div>
        <Button type="button" variant="primary" size="sm" onClick={onDownload}>
          Download {BRAND_NAME} {version}
        </Button>
      </div>
      <div className="flex flex-col gap-1.5">
        <Text variant="description" tone="muted">
          or update from {install.shell}: paste this line and press Enter. It downloads the release
          from GitHub and checks it against the published checksums before installing.
        </Text>
        <div className="flex items-center gap-2 rounded-md border border-border bg-background-secondary px-2 py-1.5">
          <code
            className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap text-foreground"
            data-testid="release-install-command"
          >
            {install.command}
          </code>
          <Button
            type="button"
            variant="ghost"
            size="xs"
            icon
            aria-label={copied ? 'Copied' : 'Copy command'}
            onClick={() => {
              void Promise.resolve(onCopyCommand(install.command)).then(() => setCopied(true));
            }}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
