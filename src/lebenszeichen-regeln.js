const UNBEKANNTE_FEHLERART = "unbekannt";

export function fehlerart(fehler) {
  const code = fehler?.cause?.code ?? fehler?.code;
  return typeof code === "string" ? code : String(fehler?.name ?? UNBEKANNTE_FEHLERART);
}

export function verzugUeberGrenze({ taktVerzugMs, hoechstVerzugMs, grenzeMs }) {
  return taktVerzugMs > grenzeMs || hoechstVerzugMs > grenzeMs;
}
