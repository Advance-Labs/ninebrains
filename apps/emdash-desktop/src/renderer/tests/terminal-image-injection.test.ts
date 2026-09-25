import { describe, expect, it } from 'vitest';
import {
  buildTerminalImageInjection,
  escapePathForTerminal,
  escapeWindowsPathForTerminal,
  extractClipboardImageFiles,
  formatTerminalImagePaths,
  isHeicLikeFile,
  isNearDuplicatePaste,
  isUnstableDropPath,
  wrapAsBracketedPaste,
} from '@core/features/terminals/api/browser/pty/terminal-image-paths';

describe('terminal-image-injection', () => {
  it('detects unstable Chromium drop paths', () => {
    expect(isUnstableDropPath('/var/folders/xx/T/Drops/image.png')).toBe(true);
    expect(isUnstableDropPath('/var/folders/xx/T/emdash-drop-123-image.png')).toBe(false);
    expect(isUnstableDropPath('/Users/me/Desktop/shot.png')).toBe(false);
  });

  it('escapes spaces without wrapping in quotes', () => {
    expect(escapePathForTerminal('/tmp/my image.png')).toBe('/tmp/my\\ image.png');
  });

  it('quotes Windows paths instead of POSIX-escaping spaces', () => {
    expect(escapeWindowsPathForTerminal('C:\\Users\\me\\my image.png')).toBe(
      '"C:\\Users\\me\\my image.png"'
    );
  });

  it('detects HEIC-like files without relying on image MIME types', () => {
    expect(isHeicLikeFile(new File([], 'photo.heic', { type: '' }))).toBe(true);
    expect(isHeicLikeFile(new File([], 'photo.png', { type: 'image/png' }))).toBe(false);
  });

  it('deduplicates identical clipboard image file items', () => {
    const file = new File(['image'], 'image.png', { type: 'image/png', lastModified: 1 });
    const clipboardData = {
      items: [
        { kind: 'file', getAsFile: () => file },
        { kind: 'file', getAsFile: () => file },
      ],
      types: ['Files'],
    } as unknown as DataTransfer;

    expect(extractClipboardImageFiles(clipboardData)).toEqual([file]);
  });

  it('collapses alternate image representations from one clipboard image', () => {
    const png = new File(['png'], 'image.png', { type: 'image/png', lastModified: 1 });
    const tiff = new File(['tiff'], 'image.tiff', { type: 'image/tiff', lastModified: 1 });
    const clipboardData = {
      items: [
        { kind: 'file', getAsFile: () => png },
        { kind: 'file', getAsFile: () => tiff },
      ],
      types: ['image/png', 'image/tiff'],
    } as unknown as DataTransfer;

    expect(extractClipboardImageFiles(clipboardData)).toEqual([png]);
  });

  it('detects near-duplicate paste paths from the same user gesture', () => {
    expect(isNearDuplicatePaste(1_000, 1_249)).toBe(true);
    expect(isNearDuplicatePaste(1_000, 1_250)).toBe(false);
    // initial ref value (0) must never be treated as a recent paste
    expect(isNearDuplicatePaste(0, 100)).toBe(false);
  });

  it('wraps formatted paths for bracketed paste', () => {
    const payload = wrapAsBracketedPaste(formatTerminalImagePaths(['/tmp/a.png'], 'darwin'));
    expect(payload).toBe('\x1b[200~/tmp/a.png\x1b[201~');
    expect(payload.charCodeAt(0)).toBe(27);
  });

  // Ninebrains (#84): a dropped path arrived in a Claude Code pane as a lone
  // space. The payload was wrapped in bracketed paste, the pane consumed the
  // wrapped portion, and only the trailing space the caller appends survived.
  describe('path injection is never bracketed paste (#84)', () => {
    it('emits no paste markers for a POSIX path', () => {
      const payload = buildTerminalImageInjection(['/tmp/a.png'], 'darwin');
      expect(payload).toBe('/tmp/a.png');
      expect(payload).not.toContain('\x1b[200~');
      expect(payload).not.toContain('\x1b[201~');
    });

    it('emits no paste markers for a Windows path', () => {
      const payload = buildTerminalImageInjection(['C:\\Users\\me\\a.png'], 'win32');
      expect(payload).toBe('"C:\\Users\\me\\a.png"');
      expect(payload).not.toContain('\x1b[200~');
    });

    it('survives the repro path, which has two consecutive spaces', () => {
      const name = '/Users/me/Downloads/Ninebrains  Strategy to Own Verified.md';
      const payload = buildTerminalImageInjection([name], 'darwin');
      expect(payload).not.toContain('\x1b[200~');
      // Each space is escaped individually, so the path stays one shell token
      // and the doubled space is not collapsed.
      expect(payload).toContain('Ninebrains\\ \\ Strategy');
      expect(payload.replace(/\\/g, '')).toBe(name);
    });

    it('keeps multi-file drops space-separated', () => {
      expect(buildTerminalImageInjection(['/tmp/a.png', '/tmp/b.png'], 'darwin')).toBe(
        '/tmp/a.png /tmp/b.png'
      );
    });

    it('produces the same bytes the in-app file-tree drag produces', () => {
      // The two drop branches in pty-pane.tsx now share one helper. This asserts
      // the property that unification is for: identical input, identical bytes.
      for (const platform of ['darwin', 'linux', 'win32'] as const) {
        const paths = ['/w/a b.md', '/w/c.md'];
        expect(buildTerminalImageInjection(paths, platform)).toBe(
          formatTerminalImagePaths(paths, platform)
        );
      }
    });

    it('emits nothing at all for an empty path list', () => {
      expect(buildTerminalImageInjection([], 'darwin')).toBe('');
    });
  });
});
