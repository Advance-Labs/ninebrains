/**
 * Readable text from HTML without a parser dependency.
 *
 * This is deliberately a stripper, not a DOM. Quote verification only needs the
 * words a reader would see, in order: drop non-content elements wholesale, turn
 * block boundaries into line breaks so adjacent paragraphs don't fuse into one
 * token, remove every remaining tag, and decode entities. Anything subtler
 * (layout, hidden elements via CSS) is out of scope.
 */

const DROP_ELEMENTS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'head',
  'iframe',
  'object',
];

const BLOCK_TAG =
  /<\/?(?:p|div|br|hr|li|ul|ol|tr|td|th|table|h[1-6]|section|article|header|footer|nav|aside|main|blockquote|pre|figure|figcaption|dd|dt|dl)\b[^>]*>/gi;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  copy: '©',
  reg: '®',
  trade: '™',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const hex = body[1] === 'x' || body[1] === 'X';
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return whole;
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Heuristic: does this body look like markup rather than plain text? */
export function looksLikeHtml(body: string): boolean {
  return /<(?:!doctype\s+html|html|body|p|div|span|h[1-6]|article|main)\b/i.test(
    body.slice(0, 4096)
  );
}

export function extractReadableText(html: string): string {
  let text = html.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of DROP_ELEMENTS) {
    text = text.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}\\s*>`, 'gi'), ' ');
  }
  text = text.replace(BLOCK_TAG, '\n').replace(/<[^>]*>/g, ' ');
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[ \t\f\v ]+/g, ' ').trim())
    .filter((line) => line.length > 0)
    .join('\n');
}
