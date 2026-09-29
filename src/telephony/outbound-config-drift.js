const MIN_KONTOTREFFER = 1;

// EXPORTIERT (Review-Blocker G9/C2, G5): der ANI-Riegel (outbound-gates.js#
// ani_ownership) braucht fuer seine LIVE-Nachmessung exakt dasselbe Kontoeigentums-
// Urteil wie Pruefung 3/9 - EINE Quelle statt einer zweiten, im Gate getippten
// Vergleichslogik.
export function kontoBesitzt(kontotreffer, e164) {
  if (!kontotreffer || kontotreffer.ok !== true) return "unbekannt";
  const treffer = (kontotreffer.wert || {}).treffer || [];
  const genau = treffer.filter((eintrag) => eintrag.e164 === e164 && eintrag.status === "active");
  return genau.length >= MIN_KONTOTREFFER ? "besitzt" : "verloren";
}
