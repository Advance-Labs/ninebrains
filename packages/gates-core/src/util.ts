export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The last `n` lines of `text`, without a trailing empty line. */
export function tailLines(text: string, n: number): string {
  const lines = text.replace(/\s+$/, '').split(/\r?\n/);
  return lines.slice(Math.max(0, lines.length - n)).join('\n');
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n… (${text.length - max} more chars)`;
}

/** A relative path with no traversal, absolute root or drive letter. */
export function isSafeRelativePath(value: string): boolean {
  if (value.length === 0 || value.includes('\0')) return false;
  if (/^(?:[a-zA-Z]:)?[\\/]/.test(value) || /^[a-zA-Z]:/.test(value)) return false;
  return value.split(/[\\/]/).every((segment) => segment !== '..');
}
