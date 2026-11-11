import { EDGE_PX, swipeStartsOnPage, swipeTarget } from "../lib/section-nav.js";

const SWIPE_PAGES = "(max-width: 760px) and (min-height: 560px) and (pointer: coarse)";
const ZOOMED_SCALE = 1.01;
const SWIPING_CLASS = "swiping";
const SWIPE_SETTLE_MS = 700;

function zoomedIn() {
  return Boolean(window.visualViewport && window.visualViewport.scale > ZOOMED_SCALE);
}

function fullHeight() {
  const probe = document.createElement("div");
  probe.className = "page-probe";
  document.body.append(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Math.max(height, window.innerHeight);
}

function swipeGeometry(pageStarts) {
  const view = fullHeight();
  return { starts: pageStarts(), from: window.scrollY, view, max: document.documentElement.scrollHeight - view };
}

export function wireSwipePages({ pageStarts, menuOpen, reduceMotion }) {
  if (!window.matchMedia) return;
  const pages = window.matchMedia(SWIPE_PAGES);
  const root = document.documentElement;
  let swipe = null;
  let wanted = null;
  let settleTimer = 0;
  const release = () => {
    swipe = null;
    wanted = null;
    clearTimeout(settleTimer);
    root.classList.remove(SWIPING_CLASS);
  };
  const begin = (event) => {
    const interrupted = wanted !== null;
    release();
    if (interrupted || event.touches.length !== 1 || !pages.matches) return;
    if (menuOpen() || zoomedIn()) return;
    const geometry = swipeGeometry(pageStarts);
    if (!swipeStartsOnPage(geometry)) return;
    const [finger] = event.touches;
    swipe = { ...geometry, fingerX: finger.clientX, fingerY: finger.clientY };
    root.classList.add(SWIPING_CLASS);
  };
  const finish = (event) => {
    if (!swipe || event.touches.length) return;
    const [finger] = event.changedTouches;
    const moved = swipe.fingerY - finger.clientY;
    const sideways = Math.abs(swipe.fingerX - finger.clientX) > Math.abs(moved);
    const scrollTop = window.scrollY;
    const top = swipeTarget({ ...swipe, moved, scrollTop }) ?? swipe.from;
    const outside = scrollTop < 0 || scrollTop > swipe.max;
    if (sideways || outside || Math.abs(top - scrollTop) <= EDGE_PX) {
      release();
      return;
    }
    swipe = null;
    wanted = top;
    settleTimer = setTimeout(release, SWIPE_SETTLE_MS);
    window.scrollTo({ top, behavior: reduceMotion() ? "auto" : "smooth" });
  };
  const arrived = () => {
    if (wanted !== null && Math.abs(window.scrollY - wanted) <= EDGE_PX) release();
  };
  window.addEventListener("touchstart", begin, { passive: true });
  window.addEventListener("touchend", finish, { passive: true });
  window.addEventListener("touchcancel", release, { passive: true });
  window.addEventListener("scrollend", arrived);
}
