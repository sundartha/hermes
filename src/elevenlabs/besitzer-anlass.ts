import { besitzerEroeffnung } from "../i18n/eroeffnung.js";

interface BesitzerAnlassEingabe {
  language: string;
  firstName: unknown;
  openingLine: string;
}

export function besitzerAnlassEroeffnung({ language, firstName, openingLine }: BesitzerAnlassEingabe): string {
  const begruessung = besitzerEroeffnung({ language, firstName });
  return begruessung ? `${begruessung} ${openingLine}` : "";
}
