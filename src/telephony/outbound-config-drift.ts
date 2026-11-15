const MIN_KONTOTREFFER = 1;

interface Kontotreffer {
  ok?: boolean;
  wert?: { treffer?: KontoEintrag[] };
}

interface KontoEintrag {
  e164?: string;
  status?: string;
}

export function kontoBesitzt(kontotreffer: Kontotreffer | null | undefined, e164: string): "unbekannt" | "besitzt" | "verloren" {
  if (kontotreffer?.ok !== true) return "unbekannt";
  const liste = kontotreffer.wert?.treffer;
  const treffer = Array.isArray(liste) ? liste : [];
  const genau = treffer.filter((eintrag) => eintrag.e164 === e164 && eintrag.status === "active");
  return genau.length >= MIN_KONTOTREFFER ? "besitzt" : "verloren";
}
