const HOME_SECTIONS = Object.freeze(["top", "idea", "uses", "pricing", "setup", "chatgpt"]);

export const HOME_ANCHORS = Object.freeze({
  "so-funktionierts": Object.freeze({ id: "idea" }),
  preise: Object.freeze({ id: "pricing" }),
});

export function homeHref(anchor) {
  if (!Object.hasOwn(HOME_ANCHORS, anchor)) {
    throw new Error(`Unbekannter Startseiten-Anker: ${anchor}`);
  }
  return `/#${HOME_ANCHORS[anchor].id}`;
}

export function anchorFromHash(hash) {
  const key = String(hash || "").replace(/^#/, "");
  if (Object.hasOwn(HOME_ANCHORS, key)) return HOME_ANCHORS[key];
  return HOME_SECTIONS.includes(key) ? Object.freeze({ id: key }) : null;
}
