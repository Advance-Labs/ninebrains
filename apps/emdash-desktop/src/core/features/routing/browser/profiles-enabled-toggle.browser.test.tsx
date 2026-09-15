import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfilesEnabledToggle } from './profiles-enabled-toggle';

// T47 (`docs/plans/2026-09-15-routing-usability.md`): the toggle that replaces the old
// `MODEL_PROFILES_ENABLED` build flag. Fed plain data, like the rest of this slice's browser
// tests, no wire involved.

describe('ProfilesEnabledToggle', () => {
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

  it('shows the warning next to the switch, once, off by default', async () => {
    await act(async () =>
      root.render(<ProfilesEnabledToggle enabled={false} onChange={() => {}} />)
    );
    const toggle = container.querySelector('[data-testid="profiles-enabled-toggle"]');
    expect(toggle).not.toBeNull();
    expect(toggle?.textContent).toContain('billed to you');
    expect(toggle?.textContent).toContain('changes nothing');
    const switchEl = container.querySelector('[aria-label="Model profiles"]');
    expect(switchEl?.getAttribute('aria-checked')).toBe('false');
  });

  it('reflects the enabled state', async () => {
    await act(async () =>
      root.render(<ProfilesEnabledToggle enabled={true} onChange={() => {}} />)
    );
    const switchEl = container.querySelector('[aria-label="Model profiles"]');
    expect(switchEl?.getAttribute('aria-checked')).toBe('true');
  });

  it('calls onChange when flipped, and never on its own', async () => {
    const onChange = vi.fn();
    await act(async () =>
      root.render(<ProfilesEnabledToggle enabled={false} onChange={onChange} />)
    );
    expect(onChange).not.toHaveBeenCalled();
    const switchEl = container.querySelector<HTMLElement>('[aria-label="Model profiles"]');
    await act(async () => switchEl?.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0]).toBe(true);
  });

  it('is disabled while saving', async () => {
    await act(async () =>
      root.render(<ProfilesEnabledToggle enabled={false} disabled onChange={() => {}} />)
    );
    const switchEl = container.querySelector('[aria-label="Model profiles"]');
    expect(switchEl?.getAttribute('aria-disabled')).toBe('true');
  });
});
