import { describe, expect, it } from 'vitest';
import { provider } from './index';

describe('codebuff provider', () => {
  it('supports codebuff MCP configuration via ~/.agents/mcp.json', () => {
    expect(provider.capabilities.mcp).toEqual({
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    });
    expect(provider.behavior.mcp).toBeDefined();
  });

  it('passes the prompt as a positional argument to the codebuff CLI', () => {
    const command = provider.behavior.prompt!.buildCommand({
      cli: 'codebuff',
      autoApprove: false,
      initialPrompt: 'implement the task',
      sessionId: 'emdash-session-id',
      isResuming: false,
      model: '',
    });

    expect(command).toEqual({
      command: 'codebuff',
      args: ['implement the task'],
      env: {},
    });
  });

  it('host dependency installs the codebuff npm package', () => {
    const dependency = provider.capabilities.hostDependency;
    expect(dependency.id).toBe('codebuff');
    expect(dependency.binaryNames).toEqual(['codebuff']);
    expect(dependency.installCommands?.macos?.[0]).toMatchObject({
      method: 'npm',
      command: 'npm install -g codebuff',
    });
  });
});
