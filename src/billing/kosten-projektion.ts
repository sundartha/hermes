import { costEvidenceSumMicroCents, summierbareBelegzeilen } from "../store/cost-evidence.js";
import { isProviderMicroCents } from "../begriffe/abrechnung.js";
import { istBekanntesKostenprofil, kostenprofilFuerAnruf, pflichtTraegerFuerProfil } from "./kostenarten.js";
import { offeneTraeger } from "./kosten-abschluss.ts";
import type { AbschlussAnruf, AbschlussBeleg } from "./kosten-abschluss.ts";

const summierbareZeilen: (zeilen: unknown[]) => unknown[] = summierbareBelegzeilen;
const belegSumme: (zeilen: unknown[]) => number = costEvidenceSumMicroCents;

interface Belegzeile {
  callId: string;
  traeger: string;
}

interface Anruf {
  id: string;
  costTruedAt: unknown;
  estimatedCostSpendMonthKey: unknown;
}

interface Projektion {
  profil: unknown;
  pflichtTraeger: unknown[];
  fehlend: unknown[];
  summeMikroCents: unknown;
  vollBelegt: boolean;
}

export function istVollBelegt({
  profil,
  pflichtTraeger,
  fehlend,
}: {
  profil: unknown;
  pflichtTraeger: unknown[];
  fehlend: unknown[];
}): boolean {
  return istBekanntesKostenprofil(profil) && pflichtTraeger.length > 0 && fehlend.length === 0;
}

export function settlementProjektion({ call, belege }: {
  call: AbschlussAnruf | null | undefined;
  belege: AbschlussBeleg[];
}): Projektion {
  const profil: unknown = kostenprofilFuerAnruf(call);
  const pflichtTraeger: unknown[] = pflichtTraegerFuerProfil(profil);
  const fehlend: unknown[] = offeneTraeger({ call, belege });
  const summe = belegSumme(belege);
  const summierbar = summierbareZeilen(belege).length > 0 && isProviderMicroCents(summe);
  return {
    profil,
    pflichtTraeger,
    fehlend,
    summeMikroCents: summierbar ? summe : null,
    vollBelegt: istVollBelegt({ profil, pflichtTraeger, fehlend }),
  };
}

export function belegSummeJeTraegerFuerMonat({
  state,
  monthKey,
}: {
  state: { calls?: Anruf[]; callCostEvidence?: Belegzeile[] } | null | undefined;
  monthKey: string;
}): { traeger: string; mikroCents: number }[] {
  const calls = Array.isArray(state?.calls) ? state.calls : [];
  const zeilen = Array.isArray(state?.callCostEvidence) ? state.callCostEvidence : [];
  const callIds = new Set(
    calls
      .filter((call) => call.costTruedAt !== null && call.estimatedCostSpendMonthKey === monthKey)
      .map((call) => call.id),
  );
  const jeTraeger = new Map<string, Belegzeile[]>();
  for (const zeile of zeilen) {
    if (!callIds.has(zeile.callId)) continue;
    const gruppe = jeTraeger.get(zeile.traeger);
    if (gruppe) gruppe.push(zeile);
    else jeTraeger.set(zeile.traeger, [zeile]);
  }
  return [...jeTraeger.entries()]
    .map(([traeger, gruppe]) => ({ traeger, mikroCents: belegSumme(gruppe) }))
    .sort((links, rechts) => links.traeger.localeCompare(rechts.traeger));
}

export function summeUeberTraeger(traegerSummen: { traeger: string; mikroCents: number }[], auswahl: readonly string[]): number | null {
  const passend = traegerSummen.filter((eintrag) => auswahl.includes(eintrag.traeger));
  if (passend.length === 0) return null;
  return passend.reduce((summe, eintrag) => summe + eintrag.mikroCents, 0);
}
