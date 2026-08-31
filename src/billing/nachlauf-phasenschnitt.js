// KV2-7 (tasks/kostenv2/spec-kv2-7.md, "Der Phasenschnitt-Nachlauf im Detail"): ein
// benannter, EINMALIGER Migrations-Lauf (Teil des KV2-7-Deploys, kein Dauerbetrieb),
// der einen im Fenster KV2-5..KV2-7 faelschlich gelatchten el_convai_sip-Anruf wieder
// oeffnet. Muster WOERTLICH backfill-profiles.js: reine Orchestrierung ueber den Store-
// Seam, fail-closed Skip-Taxonomie, apply=false = reiner Dry-Run (keine Mutation).
//
// Rein zustandsbasiert - KEIN Zeitfenster (die gestrichene Fassung des Plans, s.
// Spec-Begruendung): der Telnyx-SIP-Beleg IST der Zustandsbeweis dafuer, dass ein Anruf
// im Phasenschnitt gelatcht wurde, statt es zu datieren.
import { KOSTENPROFIL, kostenprofilFuerAnruf } from "./kostenarten.js";
import { REIFE, isBookableCents } from "../store/defaults.js";
import { convertProviderMicroToBucketCents } from "../store/state-ops.js";
// KV2-9: der zweite einmalige Nachlauf braucht denselben Endzustand-Blick wie der Sweep
// selbst - EINE Quelle (G5), keine zweite, hier getippte Fassung von "abgeschlossen, aber
// unvollstaendig".
import { ENDZUSTAND, abschlussFuerAnruf } from "./kosten-abschluss.js";
import { settlementProjektion } from "./kosten-projektion.js";

export const NACHLAUF_SKIP = Object.freeze({
  KEIN_EL_PROFIL: "kein_el_profil",
  NICHT_GELATCHT: "nicht_gelatcht",
  KEIN_SIP_BELEG: "kein_telnyx_sip_beleg",
  EL_BELEG_VORHANDEN: "el_beleg_vorhanden",
});

const TRAEGER_TELNYX_SIP = "telnyx_sip";
const TRAEGER_ELEVENLABS_CONVAI = "elevenlabs_convai";

// Reife-Werte, die eine el_convai_sip-Belegzeile bereits als "gesammelt" ausweisen -
// Bedingung 4 schliesst genau diese aus (belegt ODER vorlaeufig).
const EL_ZEILE_GESAMMELT = new Set([REIFE.VORLAEUFIG, REIFE.BELEGT]);

// Die vier Bedingungen aus 4.7, EIN Praedikat, rein und testbar. Prueft in der
// Reihenfolge, in der der Spec-Text sie nennt (fail-closed zuerst: fehlendes Profil vor
// jeder Beleg-Frage).
export function istImPhasenschnittGelatcht({ call, belege }) {
  if (kostenprofilFuerAnruf(call) !== KOSTENPROFIL.EL_CONVAI_SIP)
    return { treffer: false, grund: NACHLAUF_SKIP.KEIN_EL_PROFIL };
  if (call.costTruedAt === null) return { treffer: false, grund: NACHLAUF_SKIP.NICHT_GELATCHT };
  const hatSipBeleg = belege.some((zeile) => zeile.traeger === TRAEGER_TELNYX_SIP);
  if (!hatSipBeleg) return { treffer: false, grund: NACHLAUF_SKIP.KEIN_SIP_BELEG };
  const hatElBeleg = belege.some(
    (zeile) => zeile.traeger === TRAEGER_ELEVENLABS_CONVAI && EL_ZEILE_GESAMMELT.has(zeile.reife),
  );
  if (hatElBeleg) return { treffer: false, grund: NACHLAUF_SKIP.EL_BELEG_VORHANDEN };
  return { treffer: true };
}

// KV2-9: der gemeinsame Rumpf beider einmaligen Nachlaeufe (G5) - EIN Durchlauf ueber
// alle Anrufe, ein injiziertes Praedikat, bei apply GENAU EINE Mutation je Treffer. Kein
// Cent, kein Netz. Nur lesende Store-Aufrufe (load, callCostEvidence) plus die eine
// Mutation (oeffneKostenAbgleichErneut).
function laufUeberAnrufe({ store, apply, trifftZu }) {
  const state = store.load();
  const report = { apply, scanned: 0, treffer: [], skipped: [] };
  for (const call of state.calls) {
    report.scanned++;
    const belege = store.callCostEvidence(call.id);
    const { treffer, grund } = trifftZu(call, belege);
    if (!treffer) {
      report.skipped.push({ id: call.id, reason: grund });
      continue;
    }
    report.treffer.push({ id: call.id });
    if (apply) store.oeffneKostenAbgleichErneut(call.id);
  }
  return report;
}

// Idempotent: ein zweiter Lauf sieht costTruedAt bereits null (NICHT_GELATCHT).
export function oeffneGelatchteElAnrufe({ store, apply = false }) {
  return laufUeberAnrufe({ store, apply, trifftZu: (call, belege) => istImPhasenschnittGelatcht({ call, belege }) });
}

// ---- KV2-9: der zweite einmalige Nachlauf ----------------------------------------------
//
// Oeffnet einen el_convai_sip-Anruf wieder, den KV2-8 zwangs-gesettelt hat (Endzustand
// unvollstaendig_final, per Frist geschlossen), OBWOHL seine EL-Belegzeile noch
// 'vorlaeufig' war UND seine Belegsumme unter der Schaetzung liegt (Bedingung 5: der
// Riegel gegen die doppelte Buchung). Nach dem Oeffnen kann die Reifung (el-reifung.js)
// den echten Betrag nachziehen und der naechste Sweep ihn korrekt settlen.
export const NACHLAUF_KV2_9_SKIP = Object.freeze({
  KEIN_EL_PROFIL: "kein_el_profil",
  NICHT_GESCHLOSSEN: "nicht_geschlossen",
  ANDERER_ENDZUSTAND: "endzustand_nicht_unvollstaendig_final",
  KEINE_VORLAEUFIGE_EL_ZEILE: "keine_genau_eine_vorlaeufige_el_zeile",
  KEINE_SCHAETZUNG: "keine_buchbare_schaetzung",
  BELEGSUMME_FEHLT: "keine_summierbare_belegsumme",
  BELEGSUMME_NICHT_UNTER_SCHAETZUNG: "belegsumme_nicht_unter_schaetzung",
});

// Genau EINE 'vorlaeufig'-EL-Zeile, keine 'belegt'-Zeile desselben Traegers (Bedingung 4,
// die Gegenrichtung zu istImPhasenschnittGelatcht oben - deren Bedingung 4 verlangt das
// FEHLEN einer solchen Zeile). Die beiden Mengen sind damit disjunkt.
function hatGenauEineVorlaeufigeElZeile(belege) {
  const elZeilen = belege.filter((zeile) => zeile.traeger === TRAEGER_ELEVENLABS_CONVAI);
  return elZeilen.length === 1 && elZeilen[0].reife === REIFE.VORLAEUFIG;
}

// Bedingung 5, die Geldrechnung. DER Riegel gegen die doppelte Buchung. Verglichen wird
// in der Einheit, in der gebucht wird - ueber die EINE Umrechnung des Repos
// (convertProviderMicroToBucketCents, state-ops.js), nie ueber eine hier getippte
// Zweitformel (G5/D5).
// remMicro: 0 ist eine bewusste, BEWEISBAR konservative Eingabe und keine erfundene
// Messung. Der echte Sub-Cent-Rest kann das Ergebnis um hoechstens einen Cent ANHEBEN;
// mit 0 rechnen heisst also, hoechstens einen Anruf zusaetzlich zu treffen, dessen
// echter Delta GENAU 0 war - und ein Delta von 0 beruehrt laut Regel 4 in
// bookCostCorrectionCents KEINE Achse. Ein Anruf, bei dem etwas gebucht wurde, kann
// dadurch nie hereinrutschen.
function belegsummeUnterSchaetzung({ call, summeMikroCents, providerToBucketRateMicro }) {
  const { bucketCents } = convertProviderMicroToBucketCents({
    remMicro: 0, actualCostMicroCents: summeMikroCents, providerToBucketRateMicro,
  });
  return bucketCents < call.estimatedCostCents;
}

// Die fuenf Bedingungen aus dem Zusatzauftrag, in der Reihenfolge, in der sie geprueft
// werden (fail-closed zuerst). Bedingung 3 wird NICHT neu formuliert, sondern ueber
// abschlussFuerAnruf (kosten-abschluss.js) beantwortet - EINE Quelle: der Abbruchweg
// liefert dort beleg_strukturell_unbeschaffbar, eine bereits belegt-Zeile vollstaendig,
// eine Altzeile ohne costProfile profil_fehlt - alle drei fallen hier durch.
export function istZwangsGesetteltImKv2_8Fenster({ call, belege, nowMs, deadlineMs, providerToBucketRateMicro }) {
  if (kostenprofilFuerAnruf(call) !== KOSTENPROFIL.EL_CONVAI_SIP)
    return { treffer: false, grund: NACHLAUF_KV2_9_SKIP.KEIN_EL_PROFIL };
  if (call.costTruedAt === null) return { treffer: false, grund: NACHLAUF_KV2_9_SKIP.NICHT_GESCHLOSSEN };
  const abschluss = abschlussFuerAnruf({ call, belege, nowMs, deadlineMs, sweepTraegerErledigt: false });
  if (abschluss.endzustand !== ENDZUSTAND.UNVOLLSTAENDIG_FINAL)
    return { treffer: false, grund: NACHLAUF_KV2_9_SKIP.ANDERER_ENDZUSTAND };
  if (!hatGenauEineVorlaeufigeElZeile(belege))
    return { treffer: false, grund: NACHLAUF_KV2_9_SKIP.KEINE_VORLAEUFIGE_EL_ZEILE };
  if (!isBookableCents(call.estimatedCostCents))
    return { treffer: false, grund: NACHLAUF_KV2_9_SKIP.KEINE_SCHAETZUNG };
  const { summeMikroCents } = settlementProjektion({ call, belege });
  if (summeMikroCents === null) return { treffer: false, grund: NACHLAUF_KV2_9_SKIP.BELEGSUMME_FEHLT };
  if (!belegsummeUnterSchaetzung({ call, summeMikroCents, providerToBucketRateMicro }))
    return { treffer: false, grund: NACHLAUF_KV2_9_SKIP.BELEGSUMME_NICHT_UNTER_SCHAETZUNG };
  return { treffer: true };
}

export function oeffneZwangsGesettelteElAnrufe({ store, apply = false, nowMs, deadlineMs, providerToBucketRateMicro }) {
  return laufUeberAnrufe({
    store, apply,
    trifftZu: (call, belege) => istZwangsGesetteltImKv2_8Fenster({ call, belege, nowMs, deadlineMs, providerToBucketRateMicro }),
  });
}
