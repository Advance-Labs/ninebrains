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

/**
 * Focuses a region. Main and bottom prefer their text input (chat composer, editor, terminal) so
 * typing works at once; the others focus their root, from which Tab and the arrow keys continue.
 */
export function focusRegion(region: FocusRegion, root: Document = document): boolean {
  const el = regionElement(region, root);
  if (!el) return false;
  const preferred =
    region === 'main' || region === 'bottom'
      ? el.querySelector<HTMLElement>('textarea, [contenteditable="true"], input')
      : null;
  (preferred ?? el).focus({ preventScroll: true });
  return true;
}

export function cycleFocusRegion(direction: 1 | -1, root: Document = document): boolean {
  const next = nextFocusRegion(visibleFocusRegions(root), currentFocusRegion(root), direction);
  return next ? focusRegion(next, root) : false;
}
