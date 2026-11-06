export const EDGE_PX = 2;
export const PAGE_SHARE = 0.85;
export const FIT_SLACK_PX = 40;

const KEY_DIRECTIONS = Object.freeze({
  PageDown: 1,
  PageUp: -1,
  ArrowDown: 1,
  ArrowUp: -1,
});

export function keyDirection(key, shiftKey) {
  if (key === " " || key === "Spacebar") return shiftKey ? -1 : 1;
  return KEY_DIRECTIONS[key] ?? 0;
}

function clampTop(top, max) {
  return Math.min(Math.max(Math.round(top), 0), Math.max(max, 0));
}

function nextStart(page) {
  return page.starts.find((start) => start > page.scrollTop + EDGE_PX);
}

function downTarget(page) {
  const sectionEnd = nextStart(page) ?? page.max + page.view;
  const below = sectionEnd - (page.scrollTop + page.view);
  if (below > FIT_SLACK_PX) return page.scrollTop + Math.min(below, page.view * PAGE_SHARE);
  return nextStart(page) ?? page.max;
}

function upTarget(page) {
  const { starts, scrollTop, view } = page;
  const current = starts.filter((start) => start <= scrollTop + EDGE_PX).at(-1) ?? 0;
  if (scrollTop - current > EDGE_PX) return Math.max(current, scrollTop - view * PAGE_SHARE);
  const previous = starts.filter((start) => start < scrollTop - EDGE_PX).at(-1);
  return previous ?? 0;
}

export function sectionTarget({ starts, scrollTop, view, max, direction }) {
  if (!direction || view <= 0) return null;
  const page = { starts: [...starts].sort((first, second) => first - second), scrollTop, view, max };
  const raw = direction > 0 ? downTarget(page) : upTarget(page);
  const target = clampTop(raw, max);
  return Math.abs(target - scrollTop) <= EDGE_PX ? null : target;
}
