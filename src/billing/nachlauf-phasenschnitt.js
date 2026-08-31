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
import { REIFE } from "../store/defaults.js";

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

// Der Lauf: nur lesende Store-Aufrufe (load, callCostEvidence), plus bei apply GENAU
// EINE Mutation je Treffer (oeffneKostenAbgleichErneut). Kein Cent, keine Buchung, kein
// Netz. Idempotent: ein zweiter Lauf sieht costTruedAt bereits null (NICHT_GELATCHT).
export function oeffneGelatchteElAnrufe({ store, apply = false }) {
  const state = store.load();
  const report = { apply, scanned: 0, treffer: [], skipped: [] };
  for (const call of state.calls) {
    report.scanned++;
    const belege = store.callCostEvidence(call.id);
    const { treffer, grund } = istImPhasenschnittGelatcht({ call, belege });
    if (!treffer) {
      report.skipped.push({ id: call.id, reason: grund });
      continue;
    }
    report.treffer.push({ id: call.id });
    if (apply) store.oeffneKostenAbgleichErneut(call.id);
  }
  return report;
}
