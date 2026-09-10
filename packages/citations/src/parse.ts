/**
 * Boundary validation for claims and sources that arrive as untrusted JSON
 * (an agent's `claims.json`, a pack's retrieval log).
 */

import type { Citation, Claim, Source } from './types';

export class ClaimsFormatError extends Error {
  constructor(
    message: string,
    readonly path: string
  ) {
    super(`${path}: ${message}`);
    this.name = 'ClaimsFormatError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function str(value: unknown, path: string, optional: true): string | undefined;
function str(value: unknown, path: string, optional?: false): string;
function str(value: unknown, path: string, optional = false): string | undefined {
  if (value === undefined && optional) return undefined;
  if (typeof value !== 'string') throw new ClaimsFormatError('expected a string', path);
  return value;
}

function parseCitation(value: unknown, path: string): Citation {
  if (!isRecord(value)) throw new ClaimsFormatError('expected an object', path);
  const sourceId = str(value.sourceId, `${path}.sourceId`);
  if (sourceId.trim().length === 0)
    throw new ClaimsFormatError('must not be empty', `${path}.sourceId`);
  const citation: Citation = { sourceId };
  const quote = str(value.quote, `${path}.quote`, true);
  const locator = str(value.locator, `${path}.locator`, true);
  if (quote !== undefined) citation.quote = quote;
  if (locator !== undefined) citation.locator = locator;
  return citation;
}

function parseClaim(value: unknown, path: string): Claim {
  if (!isRecord(value)) throw new ClaimsFormatError('expected an object', path);
  const text = str(value.text, `${path}.text`);
  const raw = value.citations ?? [];
  if (!Array.isArray(raw)) throw new ClaimsFormatError('expected an array', `${path}.citations`);
  return { text, citations: raw.map((c, i) => parseCitation(c, `${path}.citations[${i}]`)) };
}

function parseSource(value: unknown, path: string): Source {
  if (!isRecord(value)) throw new ClaimsFormatError('expected an object', path);
  const source: Source = { id: str(value.id, `${path}.id`), text: '' };
  const text = str(value.text, `${path}.text`, true);
  const url = str(value.url, `${path}.url`, true);
  const title = str(value.title, `${path}.title`, true);
  if (text !== undefined) source.text = text;
  if (url !== undefined) source.url = url;
  if (title !== undefined) source.title = title;
  if (value.hierarchy !== undefined) {
    if (!Array.isArray(value.hierarchy)) {
      throw new ClaimsFormatError('expected an array', `${path}.hierarchy`);
    }
    source.hierarchy = value.hierarchy.map((s, i) => str(s, `${path}.hierarchy[${i}]`));
  }
  return source;
}

export interface ClaimsDocument {
  claims: Claim[];
  sources: Source[];
}

/** Accepts either `Claim[]` or `{ claims: Claim[], sources?: Source[] }`. */
export function parseClaimsDocument(input: unknown): ClaimsDocument {
  if (Array.isArray(input)) {
    return { claims: input.map((c, i) => parseClaim(c, `claims[${i}]`)), sources: [] };
  }
  if (!isRecord(input)) throw new ClaimsFormatError('expected an array or an object', '$');
  if (!Array.isArray(input.claims)) throw new ClaimsFormatError('expected an array', 'claims');
  const sources = input.sources ?? [];
  if (!Array.isArray(sources)) throw new ClaimsFormatError('expected an array', 'sources');
  return {
    claims: input.claims.map((c, i) => parseClaim(c, `claims[${i}]`)),
    sources: sources.map((s, i) => parseSource(s, `sources[${i}]`)),
  };
}
