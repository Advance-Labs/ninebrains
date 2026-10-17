import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function createPty(sessionId: string) {
  const { FrontendPty } = await import('@core/features/terminals/api/browser/pty/pty');
  return new FrontendPty(sessionId, undefined, undefined, undefined, {
    connect: () => () => {},
  });
}

function createVisibleContainer(): HTMLDivElement {
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed',
    top: '0px',
    left: '0px',
    width: '900px',
    height: '500px',
  });
  document.body.appendChild(container);
  return container;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

const webglSupported = !!document.createElement('canvas').getContext('webgl2');

/** Counts draw calls on the addon's WebGL context. It also adds 2D canvases (the link layer). */
function countDraws(root: HTMLElement): { readonly count: number } {
  const gl = [...root.querySelectorAll('canvas')]
    .map((canvas) => canvas.getContext('webgl2'))
    .find((context) => context !== null)!;
  const state = { count: 0 };
  for (const name of [
    'drawArrays',
    'drawElements',
    'drawArraysInstanced',
    'drawElementsInstanced',
  ] as const) {
    const original = gl[name].bind(gl) as (...args: unknown[]) => void;
    (gl as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
      state.count += 1;
      original(...args);
    };
  }
  return state;
}

describe.skipIf(!webglSupported)('terminal WebGL renderer (#146)', () => {
  beforeEach(() => {
    vi.stubGlobal('electronAPI', {
      eventOn: vi.fn(() => () => {}),
      eventSend: vi.fn(),
      invoke: vi.fn(() => Promise.resolve({ success: true, data: null })),
    });
  });

  afterEach(async () => {
    const { disposeAllPtys } = await import('@core/features/terminals/api/browser/pty/pty');
    disposeAllPtys();
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
  });

  it('holds a WebGL canvas only while mounted', async () => {
    const pty = await createPty('webgl-mount');
    const container = createVisibleContainer();

    pty.mount(container, { cols: 80, rows: 24 });
    expect(pty.ownedContainer.querySelector('canvas')).not.toBeNull();

    pty.unmount();
    expect(pty.ownedContainer.querySelector('canvas')).toBeNull();
  });

  it('never holds more than one context while cycling many terminals', async () => {
    const container = createVisibleContainer();
    const ptys = await Promise.all(
      Array.from({ length: 20 }, (_, i) => createPty(`webgl-cycle-${i}`))
    );
    for (const pty of ptys) {
      pty.mount(container, { cols: 80, rows: 24 });
      await nextFrame();
      pty.unmount();
    }
    expect(document.querySelectorAll('canvas').length).toBe(0);

    const last = ptys[ptys.length - 1]!;
    last.mount(container, { cols: 80, rows: 24 });
    expect(last.ownedContainer.querySelector('canvas')).not.toBeNull();
  });

  it('repaints in the same task as a resize, so no blank frame reaches the screen', async () => {
    const pty = await createPty('webgl-resize');
    const container = createVisibleContainer();
    pty.mount(container, { cols: 80, rows: 24 });
    await new Promise<void>((resolve) =>
      pty.terminal.write('hello from the gpu\r\n'.repeat(10), resolve)
    );
    await nextFrame();
    await nextFrame();
    const draws = countDraws(pty.ownedContainer);

    // Resizing clears the canvas; without a synchronous render nothing is drawn until the
    // next animation frame, and the empty frame painted in between is the flicker.
    pty.terminal.resize(100, 30);
    expect(draws.count).toBeGreaterThan(0);
  });
});
