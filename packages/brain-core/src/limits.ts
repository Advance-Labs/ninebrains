/** Hard size limits enforced by the core (the MCP layer re-checks them at the boundary). */
export const LIMITS = {
  titleChars: 200,
  bodyBytes: 32 * 1024,
  summaryBytes: 32 * 1024,
  reasonChars: 4_000,
  attachments: 20,
  artifacts: 50,
  pathChars: 1_024,
  planNodes: 500,
} as const;

export function utf8Bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}
