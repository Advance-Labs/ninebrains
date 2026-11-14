/**
 * The move between the homepage and /compare/ (cross-document view transitions; styles in
 * transition.css). Loaded synchronously in <head> on both pages, so its listeners exist before
 * the first frame a transition captures.
 *
 * Only the content moves. The header and the background are the same on both pages and stay put;
 * `main` and `footer` get transition names here, per direction, so they never morph between the
 * two pages' very different boxes: the outgoing page's leave as `nb-out`, the arriving page's come
 * in as `nb-in`.
 *
 * The arriving page also records `nbSurgeAt`. Both background renderers (stage.js on the homepage,
 * flow.js on /compare/) read it in their draw loops and make the eclipse flare and throw dust as
 * the text sweeps out of it.
 */
(() => {
  const name = (suffix) => {
    const set = (el, n) => el && (el.style.viewTransitionName = n);
    set(document.querySelector('main'), suffix && `nb-${suffix}`);
    set(document.querySelector('body > footer'), suffix && `nb-foot-${suffix}`);
  };

  addEventListener('pageswap', (e) => {
    if (e.viewTransition) name('out');
  });

  addEventListener('pagereveal', (e) => {
    if (!e.viewTransition) return;
    document.documentElement.classList.add('vt-arrive');
    globalThis.nbSurgeAt = performance.now();
    name('in');
    e.viewTransition.finished.finally(() => name(''));
  });

  // Coming back with the back button restores the old page with its names still set.
  addEventListener('pageshow', (e) => {
    if (e.persisted) name('');
  });
})();
