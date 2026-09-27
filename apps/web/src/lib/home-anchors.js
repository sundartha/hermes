// Anker der Startseite: Unterseiten verlinken "So funktioniert's" und "Preise" auf
// die Ebenen der Startseite statt auf die ruhenden Unterseiten (Owner-Wunsch
// 2026-09-27: von /kuendigen & Co. aus landete man sonst auf den "falschen Layern").
// EINE Quelle fuer die Links (layouts/Hermes.astro, 404, Registrieren) und fuer die
// Skripte, die beim Laden auf die Ebene springen (scripts/hermes-scroll.js fuer die
// Desktop-Buehne und das Handy-Querformat, scripts/hermes-mobile.js fuer die
// Handy-Screens). Rein, ohne DOM - laeuft auch im node-Test.

// Position der Ebene: dieselbe Zahl ist der Sektions-Halt der Desktop-Buehne
// (data-goto "howto:1"/"price:2") und der Screen der Handy-Fassung (MobileHome:
// 0 Hero, 1 So funktioniert's, 2 Preise). sheet = Blatt im Handy-Querformat.
const HOW_INDEX = 1;
const PRICE_INDEX = 2;

export const HOME_ANCHORS = Object.freeze({
  "so-funktionierts": Object.freeze({ index: HOW_INDEX, sheet: "howto" }),
  preise: Object.freeze({ index: PRICE_INDEX, sheet: "price" }),
});

// Link auf eine Ebene der Startseite. Ein unbekannter Anker ist ein Programmierfehler
// und bricht den Build ab, statt einen toten Link auszuliefern.
export function homeHref(anchor) {
  if (!Object.hasOwn(HOME_ANCHORS, anchor)) {
    throw new Error(`Unbekannter Startseiten-Anker: ${anchor}`);
  }
  return `/#${anchor}`;
}

// location.hash -> Ziel (oder null, wenn der Anker keine Ebene ist). Die Anker sind
// reines ASCII, darum ohne decodeURIComponent (das bei kaputtem % werfen koennte).
export function anchorFromHash(hash) {
  const key = String(hash || "").replace(/^#/, "");
  return Object.hasOwn(HOME_ANCHORS, key) ? HOME_ANCHORS[key] : null;
}
