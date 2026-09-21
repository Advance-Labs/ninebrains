import { describe, expect, it } from 'vitest';
import {
  getFileKind,
  isBinaryForDiff,
  isMonacoBackedKind,
} from '@core/features/editor/api/browser/renderers/fileKind';

describe('fileKind', () => {
  it('treats csv as a Monaco-backed preview kind', () => {
    const kind = getFileKind('customers.csv');

    expect(kind).toBe('csv');
    expect(isMonacoBackedKind(kind)).toBe(true);
  });

  it('opens pdf in the PDF viewer, not Monaco', () => {
    const kind = getFileKind('docs/Report.PDF');

    expect(kind).toBe('pdf');
    expect(isMonacoBackedKind(kind)).toBe(false);
  });

  it('keeps pdf out of the text diff', () => {
    expect(isBinaryForDiff('docs/report.pdf')).toBe(true);
  });
});
