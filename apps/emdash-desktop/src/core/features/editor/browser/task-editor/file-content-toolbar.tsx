import { Button, Input, Popover, ToggleGroup } from '@emdash/ui/react/primitives';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import type { FileTabResource } from '@core/features/editor/api/browser/task-editor/stores/file-tab-resource';
import { useWorkspace } from '@core/features/workbench/api/browser/task-composition-context';
import { relativeToWorkspace } from '@core/features/workspaces/api/browser/workspace-path';
import { useEditorContext } from './editor-provider';

interface FileContentToolbarProps {
  tab: FileTabResource;
  canToggle: boolean;
}

/** Top bar shown on every file tab: file path on the left, Raw/Preview tabs on the right. */
export const FileContentToolbar = observer(function FileContentToolbar({
  tab,
  canToggle,
}: FileContentToolbarProps) {
  const workspace = useWorkspace();
  const { cowork } = useEditorContext();
  const [socketPath, setSocketPath] = useState('');
  const [token, setToken] = useState('');
  const displayPath = tab.inWorkspace
    ? relativeToWorkspace(workspace.path, tab.path)
    : tab.displayPath;
  return (
    <div className="flex h-[41px] shrink-0 items-center justify-between gap-2 border-b border-border bg-(--em-surface) px-2">
      <span
        className="min-w-0 flex-1 truncate text-xs text-foreground-passive"
        title={tab.displayPath}
      >
        {displayPath}
      </span>
      {workspace.sshConnectionId && tab.inWorkspace && tab.usesOpenFileStore && (
        <Popover.Root>
          <Popover.Trigger className="shrink-0 rounded px-2 py-1 text-xs text-foreground-muted hover:bg-(--em-surface-hover)">
            {cowork.activePath === tab.path ? `Cowork: ${cowork.status}` : 'Cowork'}
          </Popover.Trigger>
          <Popover.Content align="end" className="flex w-80 flex-col gap-2 p-3">
            <div className="text-sm font-medium">Share this file</div>
            <p className="text-xs text-foreground-muted">
              Connect to a cowork server on this SSH host. Ask the host owner for its socket path
              and access token.
            </p>
            <Input
              aria-label="Cowork socket path"
              placeholder="/shared/ninebrains/cowork.sock"
              value={socketPath}
              onChange={(event) => setSocketPath(event.target.value)}
            />
            <Input
              aria-label="Cowork access token"
              placeholder="Access token"
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
            />
            {cowork.error && <p className="text-destructive text-xs">{cowork.error}</p>}
            {cowork.activePath === tab.path ? (
              <div className="flex gap-2">
                {cowork.status === 'disconnected' && (
                  <Button size="sm" onClick={() => void cowork.reconnect()}>
                    Reconnect
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={cowork.leave}>
                  Leave shared file
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                disabled={!socketPath || !token || cowork.status === 'connecting'}
                onClick={() => void cowork.join(socketPath, token)}
              >
                {cowork.status === 'connecting' ? 'Connecting…' : 'Join shared file'}
              </Button>
            )}
          </Popover.Content>
        </Popover.Root>
      )}
      {canToggle && (
        <ToggleGroup.Root
          multiple={false}
          value={[tab.viewMode]}
          onValueChange={([value]) => {
            if (value === 'preview' || value === 'source') tab.setViewMode(value);
          }}
        >
          <ToggleGroup.Item size="sm" value="source" className="text-xs">
            Raw
          </ToggleGroup.Item>
          <ToggleGroup.Item size="sm" value="preview" className="text-xs">
            Preview
          </ToggleGroup.Item>
        </ToggleGroup.Root>
      )}
    </div>
  );
});
