/**
 * Window focus regions for keyboard-only navigation (F6 / Shift+F6). Each region's root element
 * carries `data-focus-region`; a region that is not mounted (closed drawer, collapsed sidebar,
 * another task) or not laid out is skipped.
 */
export const FOCUS_REGIONS = ['sidebar', 'main', 'bottom', 'right'] as const;
export type FocusRegion = (typeof FOCUS_REGIONS)[number];

export const FOCUS_REGION_ATTR = 'data-focus-region';

export function focusRegionAttr(region: FocusRegion) {
  return { [FOCUS_REGION_ATTR]: region } as const;
}

/** The region after `current` in `visible` order, wrapping. Unknown or no current starts the loop. */
export function nextFocusRegion(
  visible: readonly FocusRegion[],
  current: FocusRegion | null,
  direction: 1 | -1
): FocusRegion | null {
  if (visible.length === 0) return null;
  const index = current ? visible.indexOf(current) : -1;
  if (index === -1) return direction === 1 ? visible[0]! : visible[visible.length - 1]!;
  return visible[(index + direction + visible.length) % visible.length]!;
}

function regionElement(region: FocusRegion, root: ParentNode): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>(`[${FOCUS_REGION_ATTR}="${region}"]`);
  for (const el of candidates) if (el.getClientRects().length > 0) return el;
  return null;
}

export function visibleFocusRegions(root: ParentNode = document): FocusRegion[] {
  return FOCUS_REGIONS.filter((region) => regionElement(region, root) !== null);
}

export function currentFocusRegion(doc: Document = document): FocusRegion | null {
  const owner = doc.activeElement?.closest(`[${FOCUS_REGION_ATTR}]`);
  const value = owner?.getAttribute(FOCUS_REGION_ATTR);
  return FOCUS_REGIONS.find((region) => region === value) ?? null;
}

const INPUT_SELECTOR = 'textarea, [contenteditable="true"], input';

/** The input that had focus when its region was last left, so F6 returns to it. */
const lastFocusedInput = new WeakMap<HTMLElement, HTMLElement>();

/** Laid out and not under a hidden, aria-hidden or inert ancestor (an inactive tab or pane). */
function isFocusable(el: HTMLElement): boolean {
  return el.getClientRects().length > 0 && !el.closest('[hidden], [aria-hidden="true"], [inert]');
}

function preferredInput(region: HTMLElement, doc: Document): HTMLElement | null {
  const active = doc.activeElement;
  if (active instanceof HTMLElement && region.contains(active) && active.matches(INPUT_SELECTOR)) {
    if (isFocusable(active)) return active;
  }
  const last = lastFocusedInput.get(region);
  if (last && region.contains(last) && isFocusable(last)) return last;
  for (const input of region.querySelectorAll<HTMLElement>(INPUT_SELECTOR)) {
    if (isFocusable(input)) return input;
  }
  return null;
}

/**
 * Focuses a region. Main and bottom prefer a visible text input (chat composer, editor, terminal)
 * so typing works at once, and return false when every input is hidden; a region with no input,
 * like the others, focuses its root, from which Tab and the arrow keys continue.
 */
export function focusRegion(region: FocusRegion, root: Document = document): boolean {
  const el = regionElement(region, root);
  if (!el) return false;
  let target: HTMLElement = el;
  if (region === 'main' || region === 'bottom') {
    const input = preferredInput(el, root);
    // Inputs exist but none is visible (inactive tab or pane): nothing to type into, so report it.
    if (!input && el.querySelector(INPUT_SELECTOR)) return false;
    if (input) target = input;
  }
  target.focus({ preventScroll: true });
  return true;
}

export function cycleFocusRegion(direction: 1 | -1, root: Document = document): boolean {
  const current = currentFocusRegion(root);
  const active = root.activeElement;
  if (current && active instanceof HTMLElement && active.matches(INPUT_SELECTOR)) {
    const el = regionElement(current, root);
    if (el) lastFocusedInput.set(el, active);
  }
  // A region with nothing focusable (focusRegion false) is skipped, not a dead end.
  const visible = visibleFocusRegions(root);
  let from = current;
  for (let tries = visible.length; tries > 0; tries--) {
    const next = nextFocusRegion(visible, from, direction);
    if (!next) return false;
    if (focusRegion(next, root)) return true;
    from = next;
  }
  return false;
}
