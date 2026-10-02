// Fruehschleier fuer "Verträge kündigen" (App-Shell /app#kuendigen, lib/cancel-intent.js).
// Laeuft blockierend im <head> der App-Shell, also VOR dem ersten Bild: wer auf der
// Website "Verträge kündigen" tippt, soll ohne Zwischenseite zum Login (oder, eingeloggt,
// in die Kuendigung). Die Module der Shell brauchen auf dem Handy einige Sekunden, bis
// feststeht, ob man eingeloggt ist - bis dahin zeigt die Seite nichts (Stil in
// pages/app/index.astro). BillingIsland hebt den Schleier auf, sobald der Auftrag
// entschieden ist. Faellt kein Modul, hebt die Frist unten ihn von selbst auf.
// Anker und Frist stehen auch in lib/cancel-intent.js; ein Test haelt beide gleich.
(function () {
  if (location.hash !== "#kuendigen") return;
  var root = document.documentElement;
  root.setAttribute("data-cancel-arrival", "");
  setTimeout(function () {
    root.removeAttribute("data-cancel-arrival");
  }, 8000);
})();
