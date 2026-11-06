// Anker der Startseite. Seit dem Redesign (Canvas v64) ist die Startseite eine normale
// Scroll-Seite mit Sektions-IDs. Die ehemaligen Unterseiten /so-funktionierts und
// /preise (heute Weichen, components/site/HomeRedirect.astro) fuehren auf die passende
// Sektion. Die alten Hash-Werte (#so-funktionierts, #preise) loest die Startseite
// weiter auf (scripts/home.js), damit alte Links ankommen.

// Sektionen der Startseite (id im Markup von pages/index.astro).
const HOME_SECTIONS = Object.freeze(["top", "idea", "uses", "pricing", "setup", "chatgpt"]);

// Alte Seiten-/Hash-Namen -> neue Sektion.
export const HOME_ANCHORS = Object.freeze({
  "so-funktionierts": Object.freeze({ id: "idea" }),
  preise: Object.freeze({ id: "pricing" }),
});

// Link von einer Unterseite auf eine Sektion der Startseite. Nimmt nur die alten,
// sprechenden Namen an (so-funktionierts, preise) - ein unbekannter bricht den Build ab.
export function homeHref(anchor) {
  if (!Object.hasOwn(HOME_ANCHORS, anchor)) {
    throw new Error(`Unbekannter Startseiten-Anker: ${anchor}`);
  }
  return `/#${HOME_ANCHORS[anchor].id}`;
}

// Hash -> Ziel-Sektion ({ id }) oder null. Kennt die alten Namen und die neuen IDs.
export function anchorFromHash(hash) {
  const key = String(hash || "").replace(/^#/, "");
  if (Object.hasOwn(HOME_ANCHORS, key)) return HOME_ANCHORS[key];
  return HOME_SECTIONS.includes(key) ? Object.freeze({ id: key }) : null;
}
