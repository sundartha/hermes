// W4: Logik des Hero-Scroll-Scrubs, BEWUSST aus der Insel ausgelagert. Zwei
// Gruende: (1) die reine Schritt-Berechnung (heroScrubStep) ist so ohne DOM
// testbar (P11/T-Serie); (2) ein Insel-<script> MIT Import wird von Astro als
// EXTERNES, same-origin Modul gebundelt statt inline eingebettet — ein inline-
// <script> waere unter der strikten Produktions-CSP (default-src 'self', KEIN
// script-src 'unsafe-inline') blockiert und die Animation liefe nie (Leitplanke
// CSP). Die DOM-/Scroll-Verdrahtung lebt in initHeroScrub.

// Scroll-Position -> Schritt-Index (0..stepCount-1). REINE Funktion: scrollY 0
// -> Schritt 0; am Ende der Scrub-Strecke (rangeVh * viewportHeight) -> letzter
// Schritt. Fail-closed gegen viewportHeight<=0 / stepCount<=1 / negativen
// scrollY -> 0 (kein NaN, kein Ausreisser-Index).
export function heroScrubStep(scrollY, viewportHeight, stepCount, rangeVh) {
  if (!(stepCount > 1)) return 0;
  const range = viewportHeight * rangeVh;
  if (!(range > 0)) return 0;
  const y = scrollY > 0 ? scrollY : 0;
  const progress = Math.min(1, y / range);
  return Math.min(stepCount - 1, Math.floor(progress * stepCount));
}

// Verdrahtet den Scroll-Scrub an den Hero: setzt data-step + Caption je Schritt,
// lauscht nur im Viewport (IntersectionObserver) und rAF-gedrosselt. Der Aufrufer
// prueft VORHER prefers-reduced-motion / Save-Data (dann gar nicht aufrufen ->
// statisches Poster bleibt). `win` ist injizierbar (DIP) -> testbar mit Fakes.
export function initHeroScrub({ root, caption, captions, rangeVh, win = window }) {
  if (!root || !caption || !Array.isArray(captions) || captions.length < 2) return;
  root.classList.add("is-scrubbing");
  let step = -1;
  let ticking = false;

  function setStep(next) {
    if (next === step) return;
    step = next;
    root.dataset.step = String(next);
    caption.textContent = captions[next] || captions[captions.length - 1];
  }

  function update() {
    ticking = false;
    setStep(heroScrubStep(win.scrollY, win.innerHeight, captions.length, rangeVh));
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    win.requestAnimationFrame(update);
  }

  const observer = new win.IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      win.addEventListener("scroll", onScroll, { passive: true });
      update();
    } else {
      win.removeEventListener("scroll", onScroll);
    }
  });
  observer.observe(root);
  setStep(0);
}
