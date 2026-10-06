import { costEvidenceSumMicroCents, summierbareBelegzeilen } from "../store/cost-evidence.js";
import { isProviderMicroCents } from "../store/defaults.js";
import { istBekanntesKostenprofil, kostenprofilFuerAnruf, pflichtTraegerFuerProfil } from "./kostenarten.js";
import { offeneTraeger } from "./kosten-abschluss.js";

export function istVollBelegt({ profil, pflichtTraeger, fehlend }) {
  return istBekanntesKostenprofil(profil) && pflichtTraeger.length > 0 && fehlend.length === 0;
}

export function settlementProjektion({ call, belege }) {
  const profil = kostenprofilFuerAnruf(call);
  const pflichtTraeger = pflichtTraegerFuerProfil(profil);
  const fehlend = offeneTraeger({ call, belege });
  const summe = costEvidenceSumMicroCents(belege);
  const summierbar = summierbareBelegzeilen(belege).length > 0 && isProviderMicroCents(summe);
  return {
    profil,
    pflichtTraeger,
    fehlend,
    summeMikroCents: summierbar ? summe : null,
    vollBelegt: istVollBelegt({ profil, pflichtTraeger, fehlend }),
  };
}

export function belegSummeJeTraegerFuerMonat({ state, monthKey }) {
  const calls = Array.isArray(state?.calls) ? state.calls : [];
  const zeilen = Array.isArray(state?.callCostEvidence) ? state.callCostEvidence : [];
  const callIds = new Set(
    calls
      .filter((call) => call.costTruedAt !== null && call.estimatedCostSpendMonthKey === monthKey)
      .map((call) => call.id),
  );
  const jeTraeger = new Map();
  for (const zeile of zeilen) {
    if (!callIds.has(zeile.callId)) continue;
    if (!jeTraeger.has(zeile.traeger)) jeTraeger.set(zeile.traeger, []);
    jeTraeger.get(zeile.traeger).push(zeile);
  }
  return [...jeTraeger.entries()]
    .map(([traeger, gruppe]) => ({ traeger, mikroCents: costEvidenceSumMicroCents(gruppe) }))
    .sort((links, rechts) => links.traeger.localeCompare(rechts.traeger));
}

export function summeUeberTraeger(traegerSummen, auswahl) {
  const passend = traegerSummen.filter((eintrag) => auswahl.includes(eintrag.traeger));
  if (passend.length === 0) return null;
  return passend.reduce((summe, eintrag) => summe + eintrag.mikroCents, 0);
}
