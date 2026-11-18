import { afterEach, describe, expect, it } from 'vitest';
import { cycleFocusRegion, focusRegion } from './focus-regions';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

describe('focusRegion hidden candidates', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('skips an input in a hidden pane and focuses the visible one', () => {
    mount(`
      <div data-focus-region="main">
        <div hidden><textarea id="stale"></textarea></div>
        <div aria-hidden="true"><textarea id="aria"></textarea></div>
        <div inert><input id="inert" /></div>
        <div style="display:none"><textarea id="none"></textarea></div>
        <textarea id="live"></textarea>
      </div>`);
    expect(focusRegion('main')).toBe(true);
    expect(document.activeElement?.id).toBe('live');
  });

  it('returns false when every input is hidden', () => {
    mount(
      `<div data-focus-region="bottom"><div hidden><textarea id="stale"></textarea></div></div>`
    );
    expect(focusRegion('bottom')).toBe(false);
    expect(document.activeElement).toBe(document.body);
  });

  it('returns to the input that last had focus in the region', () => {
    mount(`
      <div data-focus-region="main"><textarea id="a"></textarea><textarea id="b"></textarea></div>
      <div data-focus-region="right" tabindex="-1"></div>`);
    document.getElementById('b')!.focus();
    expect(cycleFocusRegion(1)).toBe(true);
    expect(document.activeElement?.getAttribute('data-focus-region')).toBe('right');
    expect(focusRegion('main')).toBe(true);
    expect(document.activeElement?.id).toBe('b');
  });
});

describe('focusRegion without inputs', () => {
  it('focuses the region root, and F6 skips a region whose inputs are all hidden', () => {
    mount(`
      <div data-focus-region="main" tabindex="-1" id="main"></div>
      <div data-focus-region="bottom"><div hidden><textarea></textarea></div></div>
      <div data-focus-region="right" tabindex="-1" id="right"></div>`);
    expect(focusRegion('main')).toBe(true);
    expect(document.activeElement?.id).toBe('main');
    expect(cycleFocusRegion(1)).toBe(true);
    expect(document.activeElement?.id).toBe('right');
    document.body.innerHTML = '';
  });
});
