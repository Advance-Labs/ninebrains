/**
 * Node 22-24 prints "SQLite is an experimental feature" to stderr the first
 * time node:sqlite loads. Harmless for the stdio protocol (only stdout
 * carries JSON-RPC) but it lands in every agent's MCP log, so drop exactly
 * that warning. Must be imported before anything that loads node:sqlite.
 */
const originalEmitWarning = process.emitWarning.bind(process);

process.emitWarning = ((warning: string | Error, ...rest: unknown[]) => {
  const text = typeof warning === 'string' ? warning : warning.message;
  if (text.includes('SQLite is an experimental feature')) return;
  return (originalEmitWarning as (...args: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

export {};
