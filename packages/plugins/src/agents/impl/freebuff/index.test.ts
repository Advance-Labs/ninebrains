import { describe, expect, it } from 'vitest';
import { provider } from './index';

describe('freebuff provider', () => {
  it('supports freebuff MCP configuration via ~/.agents/mcp.json', () => {
    expect(provider.capabilities.mcp).toEqual({
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    });
    expect(provider.behavior.mcp).toBeDefined();
  });

  it('delivers fresh prompts through the interactive TUI, never as argv', () => {
    expect(provider.capabilities.prompt.kind).toBe('pty-only');

    const command = provider.behavior.prompt!.buildCommand({
      cli: 'freebuff',
      autoApprove: false,
      initialPrompt: 'implement the task',
      sessionId: 'emdash-session-id',
      isResuming: false,
      model: '',
    });

    expect(command.args).not.toContain('implement the task');
    expect(command.args).toHaveLength(0);
  });

  it('host dependency installs the freebuff npm package', () => {
    const dependency = provider.capabilities.hostDependency;
    expect(dependency.id).toBe('freebuff');
    expect(dependency.binaryNames).toEqual(['freebuff']);
    expect(dependency.installCommands?.macos?.[0]).toMatchObject({
      method: 'npm',
      command: 'npm install -g freebuff',
    });
  });
});
