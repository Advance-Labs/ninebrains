import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installCommandFor,
  POSIX_INSTALL_COMMAND,
  WINDOWS_INSTALL_COMMAND,
} from '../api/release-links';
import { ReleaseNoticeView } from './release-notice';
import { ReleaseUpdatePanel } from './release-update-panel';

// Fed plain data, no wire: the store and main-process decisions are covered by the node tests.

describe('release notice UI', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function button(label: string): HTMLButtonElement {
    const match = Array.from(container.querySelectorAll('button')).find(
      (element) =>
        element.textContent?.includes(label) || element.getAttribute('aria-label') === label
    );
    if (!match) throw new Error(`no button "${label}"`);
    return match;
  }

  it('sidebar notice names the version, opens settings, and dismisses', async () => {
    const onOpen = vi.fn();
    const onDismiss = vi.fn();
    await act(async () =>
      root.render(<ReleaseNoticeView version="0.2.0" onOpen={onOpen} onDismiss={onDismiss} />)
    );

    expect(container.textContent).toContain('Ninebrains 0.2.0 is out');
    await act(async () => button('Ninebrains 0.2.0 is out').click());
    expect(onOpen).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();

    await act(async () => button('Hide the notice for Ninebrains 0.2.0').click());
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('update panel offers download, the terminal one-liner, and release notes', async () => {
    const onDownload = vi.fn();
    const onCopyCommand = vi.fn(async () => undefined);
    const onOpenReleaseNotes = vi.fn();
    await act(async () =>
      root.render(
        <ReleaseUpdatePanel
          version="0.2.0"
          install={installCommandFor('mac')}
          onDownload={onDownload}
          onCopyCommand={onCopyCommand}
          onOpenReleaseNotes={onOpenReleaseNotes}
        />
      )
    );

    const command = container.querySelector('[data-testid="release-install-command"]');
    expect(command?.textContent).toBe(POSIX_INSTALL_COMMAND);
    expect(container.textContent).toContain('or update from Terminal');

    await act(async () => button('Download Ninebrains 0.2.0').click());
    expect(onDownload).toHaveBeenCalledOnce();

    await act(async () => button('Copy command').click());
    expect(onCopyCommand).toHaveBeenCalledWith(POSIX_INSTALL_COMMAND);
    expect(button('Copied')).toBeTruthy();

    await act(async () => button("What's new").click());
    expect(onOpenReleaseNotes).toHaveBeenCalledOnce();
  });

  it('shows the PowerShell one-liner on Windows', async () => {
    await act(async () =>
      root.render(
        <ReleaseUpdatePanel
          version="0.2.0"
          install={installCommandFor('windows')}
          onDownload={() => {}}
          onCopyCommand={() => {}}
          onOpenReleaseNotes={() => {}}
        />
      )
    );
    expect(container.querySelector('[data-testid="release-install-command"]')?.textContent).toBe(
      WINDOWS_INSTALL_COMMAND
    );
    expect(container.textContent).toContain('or update from PowerShell');
  });
});
