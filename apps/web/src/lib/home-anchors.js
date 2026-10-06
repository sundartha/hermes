const HOW_INDEX = 1;
const PRICE_INDEX = 2;

export const HOME_ANCHORS = Object.freeze({
  "so-funktionierts": Object.freeze({ index: HOW_INDEX, sheet: "howto" }),
  preise: Object.freeze({ index: PRICE_INDEX, sheet: "price" }),
});

export function homeHref(anchor) {
  if (!Object.hasOwn(HOME_ANCHORS, anchor)) {
    throw new Error(`Unbekannter Startseiten-Anker: ${anchor}`);
  }
  return `/#${anchor}`;
}

export function anchorFromHash(hash) {
  const key = String(hash || "").replace(/^#/, "");
  return Object.hasOwn(HOME_ANCHORS, key) ? HOME_ANCHORS[key] : null;
}
