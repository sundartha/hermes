// Startseite, klassisches Head-Script (synchron, vor dem ersten Bild).
// Die Produktions-CSP verbietet Inline-Scripts, darum als eigene Datei.
// - html.js-rv: erst mit JS werden Texte fuer die einmalige Einblendung versteckt
//   (styles/home.css .js-rv .rv). Ohne JS bleibt alles sichtbar.
// - Gespeicherte Sprache frueh setzen, damit die zweisprachigen Katalogwerte
//   ([data-lang-only]) gleich richtig stehen. Den Rest tauscht scripts/home.js.
// - Rueckfall: laeuft scripts/home.js nicht (Fehler, blockiert), nimmt das load-
//   Ereignis die Klasse wieder weg, damit kein Text unsichtbar bleibt.
(function () {
  var root = document.documentElement;
  root.classList.add("js-rv");
  try {
    if (window.localStorage.getItem("hermes.lang.v2") === "de") root.lang = "de";
  } catch (e) {
    // Speicher gesperrt: Englisch bleibt.
  }
  window.addEventListener("load", function () {
    if (!root.classList.contains("rv-ready")) root.classList.remove("js-rv");
  });
})();
