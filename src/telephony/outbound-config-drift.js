const MIN_KONTOTREFFER = 1;

export function kontoBesitzt(kontotreffer, e164) {
  if (!kontotreffer || kontotreffer.ok !== true) return "unbekannt";
  const treffer = (kontotreffer.wert || {}).treffer || [];
  const genau = treffer.filter((eintrag) => eintrag.e164 === e164 && eintrag.status === "active");
  return genau.length >= MIN_KONTOTREFFER ? "besitzt" : "verloren";
}
