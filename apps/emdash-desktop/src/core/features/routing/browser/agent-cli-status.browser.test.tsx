import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentCliStatusEntry } from '../api';
import { AgentCliStatusSection } from './agent-cli-status';

// The read-only "Agents" panel in Settings → Models: fed plain data, like the rest of this
// slice's browser tests, no wire involved.

const INSTALLED_SUBSCRIPTION: AgentCliStatusEntry = {
  provider: 'claude',
  installed: true,
  path: '/usr/local/bin/claude',
  roles: [
    { role: 'worker', mode: { kind: 'subscription' } },
    { role: 'subagent', mode: { kind: 'subscription' } },
    { role: 'reviewer', mode: { kind: 'subscription' } },
  ],
};

const NOT_INSTALLED: AgentCliStatusEntry = {
  provider: 'codex',
  installed: false,
  path: null,
  roles: [
    { role: 'worker', mode: { kind: 'subscription' } },
    { role: 'subagent', mode: { kind: 'subscription' } },
    { role: 'reviewer', mode: { kind: 'subscription' } },
  ],
};

const BLOCKED_REVIEWER: AgentCliStatusEntry = {
  provider: 'claude',
  installed: true,
  path: '/usr/local/bin/claude',
  roles: [
    { role: 'worker', mode: { kind: 'subscription' } },
    {
      role: 'subagent',
      mode: { kind: 'profile', profileLabel: 'DeepSeek cheap', tier: 'cheap' },
    },
    {
      role: 'reviewer',
      mode: { kind: 'blocked', reason: 'model profile "Strong reviewer" is turned off' },
    },
  ],
};

describe('Agents status panel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('shows a loading state while status is null', async () => {
    await act(async () => root.render(<AgentCliStatusSection status={null} />));
    expect(container.textContent).toContain('Loading');
  });

  it('renders an installed CLI with its path and subscription roles', async () => {
    await act(async () => root.render(<AgentCliStatusSection status={[INSTALLED_SUBSCRIPTION]} />));
    expect(container.textContent).toContain('Claude Code');
    expect(container.textContent).toContain('Installed');
    expect(container.textContent).toContain('/usr/local/bin/claude');
    const worker = container.querySelector('[data-testid="agent-cli-status-role-worker"]');
    expect(worker?.textContent).toContain('your subscription login');
  });

  it('renders a not-installed CLI with no path, independent of role data', async () => {
    await act(async () => root.render(<AgentCliStatusSection status={[NOT_INSTALLED]} />));
    expect(container.textContent).toContain('Codex');
    expect(container.textContent).toContain('Not installed');
    expect(container.textContent).not.toContain('null');
    const worker = container.querySelector('[data-testid="agent-cli-status-role-worker"]');
    expect(worker?.textContent).toContain('your subscription login');
  });

  it('renders a profile mode and a blocked reviewer with its reason', async () => {
    await act(async () => root.render(<AgentCliStatusSection status={[BLOCKED_REVIEWER]} />));
    const subagent = container.querySelector('[data-testid="agent-cli-status-role-subagent"]');
    expect(subagent?.textContent).toContain('API key profile "DeepSeek cheap" (cheap tier)');
    const reviewer = container.querySelector('[data-testid="agent-cli-status-role-reviewer"]');
    expect(reviewer?.textContent).toContain('blocked');
    expect(reviewer?.textContent).toContain('model profile "Strong reviewer" is turned off');
  });
});
