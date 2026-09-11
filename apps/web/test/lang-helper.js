// Simuliert die Sprachwahl fuer getLang() (lib/i18n.js), OHNE setLang() zu rufen --
// setLang() greift auf `document` zu (document.documentElement.lang, dispatchEvent),
// das es in node:test nicht gibt. getLang() liest NUR localStorage.getItem, darum
// reicht ein minimaler Stub. Restauriert globalThis.localStorage danach (auch wenn es
// vorher gar nicht existierte -- Node hat von Haus aus keinen globalThis.localStorage).
// GP-P3: aus render.test.js herausgezogen, weil api.test.js sie jetzt ebenfalls braucht -
// EINE Quelle statt zweier Kopien (G5/S2).
export function withLang(lang, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, "localStorage");
  const original = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => lang };
  try {
    fn();
  } finally {
    if (had) globalThis.localStorage = original;
    else delete globalThis.localStorage;
  }
}
