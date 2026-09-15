import { Badge } from '@emdash/ui/react/primitives';
import type { AgentCliStatusEntry, AgentRoleMode } from '../api';

/**
 * Read-only "Agents" panel (`docs/plans/2026-09-15-routing-usability.md`): which CLI is
 * installed, and what auth mode each role will actually run under. No control here, only
 * visibility — the routes themselves are set elsewhere (the lane header, the reviewer pin).
 */

const PROVIDER_LABELS: Record<AgentCliStatusEntry['provider'], string> = {
  claude: 'Claude Code',
  codex: 'Codex',
};

const ROLE_LABELS: Record<AgentCliStatusEntry['roles'][number]['role'], string> = {
  worker: 'Worker',
  subagent: 'Subagent',
  reviewer: 'Reviewer',
};

function modeText(mode: AgentRoleMode): string {
  switch (mode.kind) {
    case 'subscription':
      return 'your subscription login';
    case 'profile':
      return `API key profile "${mode.profileLabel}" (${mode.tier} tier)`;
    case 'blocked':
      return `blocked — ${mode.reason}`;
  }
}

function ProviderCard({ entry }: { entry: AgentCliStatusEntry }) {
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3"
      data-testid="agent-cli-status"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {PROVIDER_LABELS[entry.provider]}
        </span>
        <Badge tone={entry.installed ? 'success' : 'neutral'}>
          {entry.installed ? 'Installed' : 'Not installed'}
        </Badge>
      </div>
      {entry.installed && entry.path && (
        <div className="text-xs break-all text-foreground-muted">{entry.path}</div>
      )}
      <ul className="flex flex-col gap-1">
        {entry.roles.map(({ role, mode }) => (
          <li
            key={role}
            data-testid={`agent-cli-status-role-${role}`}
            className="text-xs text-foreground-muted"
          >
            <span className="font-medium text-foreground">{ROLE_LABELS[role]}:</span>{' '}
            {modeText(mode)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AgentCliStatusSection({ status }: { status: AgentCliStatusEntry[] | null }) {
  if (!status) return <p className="text-sm text-foreground-muted">Loading…</p>;
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {status.map((entry) => (
        <div key={entry.provider} className="flex-1">
          <ProviderCard entry={entry} />
        </div>
      ))}
    </div>
  );
}
