function stripMarkupAndTruncate(raw: string): string {
  if (!raw) return 'Unknown update error';

  const withoutData = raw.includes('Data:') ? raw.slice(0, raw.indexOf('Data:')) : raw;
  const noHtml = withoutData.replace(/<!DOCTYPE html.*$/is, '').replace(/<html.*$/is, '');
  const collapsed = noHtml.replace(/\s+/g, ' ').trim();
  if (!collapsed) return 'Unknown update error';
  return collapsed.length > 240 ? `${collapsed.slice(0, 240)}…` : collapsed;
}

export function formatUpdaterError(error: unknown): string {
  const err = error as Error & {
    statusCode?: number;
    code?: string;
    status?: number;
    statusMessage?: string;
    description?: string;
  };
  // Only a numeric status is an HTTP status. `err.code` is also where Node puts filesystem and
  // socket codes, so folding it in here reported `ENOTEMPTY` from an `fs.rm` as "failed with HTTP
  // ENOTEMPTY" — which is why a broken in-place install read as a network problem in the log.
  const status = err.statusCode ?? err.status;
  const statusText = err.statusMessage || err.description;
  if (typeof status === 'number') {
    const base = `Update request failed with HTTP ${status}`;
    return statusText ? `${base}: ${stripMarkupAndTruncate(String(statusText))}` : base;
  }
  if (err.code) {
    const message = error instanceof Error ? error.message : String(err.code);
    return stripMarkupAndTruncate(message.includes(err.code) ? message : `${err.code}: ${message}`);
  }
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown update error');
  return stripMarkupAndTruncate(message);
}

export function sanitizeUpdaterLogArgs(args: unknown[]) {
  return args.map((arg) => {
    if (arg instanceof Error) return formatUpdaterError(arg);
    if (typeof arg === 'string') return stripMarkupAndTruncate(arg);
    return arg;
  });
}
