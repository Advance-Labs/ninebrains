import { CollectionToolbar } from '@emdash/ui/react/patterns';
import { Button } from '@emdash/ui/react/primitives';
import { Loader2, Plus, RefreshCw, Upload } from 'lucide-react';
import React from 'react';
import { useSearchFocusHotkeys } from '@core/primitives/keybindings/browser';

type McpToolbarProps = {
  search: string;
  onSearchChange: (search: string) => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onAddCustom: () => void;
  onSeedFromClaude?: () => void;
  isSeeding?: boolean;
  canSeedFromClaude?: boolean;
};

export function McpToolbar({
  search,
  onSearchChange,
  onRefresh,
  isRefreshing,
  onAddCustom,
  onSeedFromClaude,
  isSeeding = false,
  canSeedFromClaude = true,
}: McpToolbarProps) {
  const searchRef = useSearchFocusHotkeys();
  return (
    <CollectionToolbar.Root>
      <CollectionToolbar.Search
        ref={searchRef}
        value={search}
        onValueChange={onSearchChange}
        placeholder="Search servers…"
      />
      <CollectionToolbar.Spacer />
      <CollectionToolbar.Group>
        <Button
          variant="secondary"
          icon
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh providers"
        >
          <RefreshCw
            className={`text-muted-foreground h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
          />
        </Button>
        {onSeedFromClaude && (
          <Button
            variant="secondary"
            onClick={onSeedFromClaude}
            disabled={isSeeding || !canSeedFromClaude}
            title="Copy Claude-synced MCP servers to Freebuff and Codebuff"
          >
            {isSeeding ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            Seed from Claude
          </Button>
        )}
        <Button variant="primary" onClick={onAddCustom}>
          <Plus className="size-4" />
          Custom MCP
        </Button>
      </CollectionToolbar.Group>
    </CollectionToolbar.Root>
  );
}
