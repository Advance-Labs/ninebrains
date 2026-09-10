import { describe, expect, it } from 'vitest';
import { decodeEntities, extractReadableText, looksLikeHtml } from './html';

describe('extractReadableText', () => {
  it('drops scripts, styles and comments and keeps visible text in order', () => {
    const html = `<!doctype html><html><head><title>T</title><style>p{color:red}</style></head>
      <body><script>var secret = "not content";</script><!-- hidden -->
      <h1>Tide Tables</h1><p>High tide at <b>06:42</b>.</p><p>Low&nbsp;tide &amp; slack water.</p>
      </body></html>`;
    const text = extractReadableText(html);
    expect(text).toBe('Tide Tables\nHigh tide at 06:42 .\nLow tide & slack water.');
    expect(text).not.toMatch(/secret|color|hidden/);
  });

  it('keeps adjacent blocks on separate lines so words do not fuse', () => {
    expect(extractReadableText('<div>alpha</div><div>beta</div>')).toBe('alpha\nbeta');
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities and leaves unknown ones', () => {
    expect(decodeEntities('&lt;a&gt; &#39;x&#39; &#x2014; &bogus;')).toBe("<a> 'x' — &bogus;");
  });

  it('leaves out-of-range code points alone', () => {
    expect(decodeEntities('&#99999999;')).toBe('&#99999999;');
  });
});

describe('looksLikeHtml', () => {
  it('detects markup and ignores plain text', () => {
    expect(looksLikeHtml('<!DOCTYPE html><html>')).toBe(true);
    expect(looksLikeHtml('plain text with a < b comparison')).toBe(false);
  });
});
