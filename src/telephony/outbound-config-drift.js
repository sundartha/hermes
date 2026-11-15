const MIN_KONTOTREFFER = 1;

export function kontoBesitzt(kontotreffer, e164) {
  if (kontotreffer?.ok !== true) return "unbekannt";
  const liste = kontotreffer.wert?.treffer;
  const treffer = Array.isArray(liste) ? liste : [];
  const genau = treffer.filter((eintrag) => eintrag.e164 === e164 && eintrag.status === "active");
  return genau.length >= MIN_KONTOTREFFER ? "besitzt" : "verloren";
}
