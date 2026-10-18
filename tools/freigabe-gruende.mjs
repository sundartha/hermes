import { zweckBlock } from "./auftrag/zweck.mjs";

export const FREIGABE_GRUENDE = {
  PRUEFUNGSDATEIEN: "github/freigabe-pruefungsdateien",
  LOCKERER: "github/freigabe-lockerer",
  OHNE_FEHLALARM: "github/freigabe-ohne-fehlalarm",
  NEUE_PAKETE: "github/freigabe-neue-pakete",
  ENTFERNTE_PAKETE: "github/freigabe-entfernte-pakete",
  SKRIPTE: "github/freigabe-skripte",
  PAKETFELDER: "github/freigabe-paketfelder",
  WERKZEUGTEXTE: "github/freigabe-werkzeugtexte",
  JUNGE_VERSION: "github/freigabe-junge-version",
  ALTER_UNBEKANNT: "github/freigabe-alter-unbekannt",
  WARTESCHLANGE: "github/freigabe-warteschlange",
};

export function grund(zweck, text) {
  return { zweck, text };
}

export function zweckZeilen(gruende) {
  return [...new Set(gruende.map(({ zweck }) => zweck))].flatMap(zweckBlock);
}
