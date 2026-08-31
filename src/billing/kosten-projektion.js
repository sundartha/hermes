// KV2-8 (tasks/kostenv2/spec-kv2-8.md): die Projektion des Kosten-Buchs auf das
// Settlement. ZWEI Fragen, zwei Funktionen - "was steht an Belegen da" und "ist das
// gegen das PROFIL-SOLL vollstaendig". Reines Regelwerk: kein Store, kein Netz-IO,
// kein console, kein await.
//
// IMPORT-RICHTUNG strikt einseitig (Muster kosten-deckung.js/kosten-abschluss.js):
// cost-truing.js und cost-cross-check.js importieren AUS dieser Datei, NIE umgekehrt -
// sonst ein Zyklus. Diese Datei kennt nur store/cost-evidence.js, store/defaults.js,
// billing/kostenarten.js und billing/kosten-abschluss.js.
//
// WARUM HIER KEINE EIGENE SUMMENFORMEL STEHT (G5): die Summenregel ist bereits EINE
// Quelle - costEvidenceSumMicroCents (store/cost-evidence.js, KV2-3), deren eigener
// Kommentar sie ausdruecklich fuer diese Phase reserviert. Eine zweite, hier getippte
// Fassung waere genau die Doppelung, gegen die diese Kette gebaut ist.
import { costEvidenceSumMicroCents, summierbareBelegzeilen } from "../store/cost-evidence.js";
import { isProviderMicroCents } from "../store/defaults.js";
import { istBekanntesKostenprofil, kostenprofilFuerAnruf, pflichtTraegerFuerProfil } from "./kostenarten.js";
import { offeneTraeger } from "./kosten-abschluss.js";

// DER Allquantor-Riegel (Abnahme (b), Zielbild 4): ueber der LEEREN Pflichtmenge ist
// "jeder Pflicht-Traeger ist belegt" allquantifiziert WAHR - ein Praedikat, das ueber
// Geldrueckgabe entscheidet, darf das nie werden. Eigene, exportierte Funktion, damit
// genau diese Regel testbar ist und nicht in einer Komposition verschwindet.
export function istVollBelegt({ profil, pflichtTraeger, fehlend }) {
  return istBekanntesKostenprofil(profil) && pflichtTraeger.length > 0 && fehlend.length === 0;
}

// Die Settlement-Eingabe EINES Anrufs, rein aus Anruf + Belegzeilen.
//   summeMikroCents: Summe ueber reife=belegt|vorlaeufig (costEvidenceSumMicroCents),
//     oder NULL, wenn KEINE summierbare Zeile existiert. NULL heisst "nicht gemessen"
//     und NIE 0 (Matrix 4.6) - eine 0 waere eine erfundene Messung. Zusaetzlich NULL,
//     wenn die Summe den sicheren Ganzzahlbereich verlaesst (Abnahme (g): der Aufrufer
//     garantiert applyCostCorrectionCents einen Betrag >= 0).
//   vollBelegt: Beleg-IST gegen PROFIL-SOLL (Zielbild 4), nicht gegen das, was
//     zufaellig eingetroffen ist.
// isBookableCents(call.estimatedCostCents) steht BEWUSST NICHT hier: das ist eine
// Eigenschaft des ANRUFS, nicht des Belegs, und bleibt in sweepDarfKorrigieren
// (Spec (i): der Riegel lebt weiter und ist NICHT in die Belegreife gewandert).
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

// KV2-8, Traeger-Trennung der Monats-Gegenprobe (Abnahme (f)). Ist-Kosten JE TRAEGER
// eines BUCHUNGSMONATS, aus dem Kosten-Buch. Monatsanker ist estimatedCostSpendMonthKey -
// DERSELBE Anker, unter dem bookCents gebucht hat (unveraendert gegenueber
// actualCostMicroCentsForMonth); costTruedAt !== null heisst "ein Abgleich fand statt".
// Gruppiert erst, summiert dann mit DERSELBEN Summenregel (G5). Liefert eine nach
// Traeger sortierte Liste (deterministische Form, Muster state-ops#callCostEvidence).
//
// WARUM HIER UND NICHT IN state-ops.js: Praezedenz kosten-deckung.js#kostenBuchBericht -
// reine Queries ueber state.calls/state.callCostEvidence liegen in dieser Kette in
// src/billing/. Nebeneffekt: der gepinnte Lint-Bestand von state-ops.js bleibt unberuehrt.
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

// Summe ueber eine AUSWAHL von Traegern einer Traeger-Bilanz. NULL, wenn KEIN Traeger der
// Auswahl im Buch steht - "kein Kostenbuch" ist nicht dasselbe wie "0 Kosten" (G26/PM-4),
// und der einzige Leser (cost-cross-check.js) bildet aus dieser Zahl eine Differenz.
export function summeUeberTraeger(traegerSummen, auswahl) {
  const passend = traegerSummen.filter((eintrag) => auswahl.includes(eintrag.traeger));
  if (passend.length === 0) return null;
  return passend.reduce((summe, eintrag) => summe + eintrag.mikroCents, 0);
}
