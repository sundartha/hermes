import { fehler, ok, type Ergebnis } from "../utils/ergebnis.ts";
import { LOCALES } from "./locales.ts";

export interface Sprachwahl {
  code: string;
  texte: string;
}

const TEXTE_FALLBACK = "en";

export function sprachwahlOf(code: string): Ergebnis<Sprachwahl, Sprachwahl> {
  if (Object.hasOwn(LOCALES, code)) return ok({ code, texte: code });
  return fehler({ code, texte: TEXTE_FALLBACK });
}
