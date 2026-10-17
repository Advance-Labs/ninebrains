import { describe, expect, it } from 'vitest';
import { parseSkipPlugins, pluginSkipArgs } from './plugin-skip';

describe('plugin skip list', () => {
  it('parses one id per line or comma, dropping junk and duplicates', () => {
    expect(
      parseSkipPlugins(
        'typescript-lsp@claude-plugins-official\nswift-lsp@claude-plugins-official, \n not an id\n--settings\ntypescript-lsp@claude-plugins-official'
      )
    ).toEqual(['typescript-lsp@claude-plugins-official', 'swift-lsp@claude-plugins-official']);
  });

  it('builds one --settings argument that turns each plugin off', () => {
    const args = pluginSkipArgs('claude', ['a@m', 'b.c@m-2']);
    expect(args[0]).toBe('--settings');
    expect(JSON.parse(args[1]!)).toEqual({ enabledPlugins: { 'a@m': false, 'b.c@m-2': false } });
  });

  it('adds nothing for an empty list, another agent, or ids that could smuggle a flag', () => {
    expect(pluginSkipArgs('claude', [])).toEqual([]);
    expect(pluginSkipArgs('claude', undefined)).toEqual([]);
    expect(pluginSkipArgs('codex', ['a@m'])).toEqual([]);
    expect(pluginSkipArgs('claude', ['--dangerously-skip-permissions', 'x"}@y'])).toEqual([]);
  });

  it("steps aside when the user's own arguments already pass --settings", () => {
    expect(pluginSkipArgs('claude', ['a@m'], ['--settings', '{}'])).toEqual([]);
    expect(pluginSkipArgs('claude', ['a@m'], ['--settings={}'])).toEqual([]);
    expect(pluginSkipArgs('claude', ['a@m'], ['--model', 'x'])).toHaveLength(2);
  });
});
