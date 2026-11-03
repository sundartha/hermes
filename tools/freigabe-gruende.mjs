import { zweckBlock } from "./auftrag/zweck.mjs";

export const FREIGABE_GRUENDE = {
  PRUEFUNGSDATEIEN: "github/freigabe-pruefungsdateien",
  ROTPROBE: "github/freigabe-rotprobe",
  NEUE_PAKETE: "github/freigabe-neue-pakete",
  ENTFERNTE_PAKETE: "github/freigabe-entfernte-pakete",
  SKRIPTE: "github/freigabe-skripte",
  PAKETFELDER: "github/freigabe-paketfelder",
  WERKZEUGTEXTE: "github/freigabe-werkzeugtexte",
  WARTESCHLANGE: "github/freigabe-warteschlange",
};

export function grund(zweck, text) {
  return { zweck, text };
}

export function zweckZeilen(gruende) {
  return [...new Set(gruende.map(({ zweck }) => zweck))].flatMap(zweckBlock);
}
