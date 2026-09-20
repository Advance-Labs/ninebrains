/**
 * Page orchestration: run the intro if it is welcome, then reveal the content as it scrolls.
 *
 * The content never depends on the intro finishing. If WebGL is missing, the user asked for
 * reduced motion, or anything throws, the page is simply there.
 */
import { runIntro } from './intro.js';

const canvas = document.getElementById('intro');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Reveals everything currently on screen, and watches for the rest. */
function watchReveals() {
  const items = [...document.querySelectorAll('[data-reveal]')];
  const showAll = () => {
    for (const item of items) item.classList.add('in');
  };
  if (reduced || !('IntersectionObserver' in window)) {
    showAll();
    return;
  }
  // Only now does the page take the content away to animate it back in.
  document.body.classList.add('reveals');
  // Failsafe: whatever happens to the observer, nothing stays hidden for long.
  setTimeout(showAll, 4000);
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const delay = Number(entry.target.dataset.delay ?? 0) * 90;
        setTimeout(() => entry.target.classList.add('in'), delay);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
  );
  for (const item of items) observer.observe(item);
}

function ready() {
  document.body.classList.add('ready');
  watchReveals();
}

function main() {
  if (reduced || !window.WebGLRenderingContext) {
    document.body.classList.add('no-intro');
    ready();
    return;
  }
  try {
    const skip = runIntro({ canvas, onDone: ready });
    // Any deliberate input means "I have seen it".
    for (const event of ['pointerdown', 'keydown', 'wheel', 'touchstart']) {
      window.addEventListener(event, () => skip(), { once: true, passive: true });
    }
  } catch {
    document.body.classList.add('no-intro');
    ready();
  }
}

main();
