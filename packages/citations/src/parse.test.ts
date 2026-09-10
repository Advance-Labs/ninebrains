import { describe, expect, it } from 'vitest';
import { ClaimsFormatError, parseClaimsDocument } from './parse';

describe('parseClaimsDocument', () => {
  it('accepts a bare claims array', () => {
    expect(
      parseClaimsDocument([{ text: 'x', citations: [{ sourceId: 's', quote: 'q' }] }])
    ).toEqual({ claims: [{ text: 'x', citations: [{ sourceId: 's', quote: 'q' }] }], sources: [] });
  });

  it('accepts an object with claims and sources, and defaults missing citations to []', () => {
    const doc = parseClaimsDocument({
      claims: [{ text: 'x' }],
      sources: [{ id: 's', url: 'https://example.org', hierarchy: ['a', 'b'] }],
    });
    expect(doc.claims[0].citations).toEqual([]);
    expect(doc.sources[0]).toEqual({
      id: 's',
      url: 'https://example.org',
      hierarchy: ['a', 'b'],
      text: '',
    });
  });

  it('reports the path of a malformed field', () => {
    expect(() =>
      parseClaimsDocument({ claims: [{ text: 'x', citations: [{ quote: 'q' }] }] })
    ).toThrow(new ClaimsFormatError('expected a string', 'claims[0].citations[0].sourceId'));
    expect(() => parseClaimsDocument('nope')).toThrow(ClaimsFormatError);
    expect(() =>
      parseClaimsDocument({ claims: [{ text: 'x', citations: [{ sourceId: ' ' }] }] })
    ).toThrow(/must not be empty/);
  });
});
