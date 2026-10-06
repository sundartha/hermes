import { KOSTENPROFIL, kostenprofilFuerAnruf } from "./kostenarten.js";
import { REIFE, isBookableCents } from "../store/defaults.js";
import { convertProviderMicroToBucketCents } from "../store/state-ops.js";
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

const EL_ZEILE_GESAMMELT = new Set([REIFE.VORLAEUFIG, REIFE.BELEGT]);

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

export function oeffneGelatchteElAnrufe({ store, apply = false }) {
  return laufUeberAnrufe({ store, apply, trifftZu: (call, belege) => istImPhasenschnittGelatcht({ call, belege }) });
}

export const NACHLAUF_KV2_9_SKIP = Object.freeze({
  KEIN_EL_PROFIL: "kein_el_profil",
  NICHT_GESCHLOSSEN: "nicht_geschlossen",
  ANDERER_ENDZUSTAND: "endzustand_nicht_unvollstaendig_final",
  KEINE_VORLAEUFIGE_EL_ZEILE: "keine_genau_eine_vorlaeufige_el_zeile",
  KEINE_SCHAETZUNG: "keine_buchbare_schaetzung",
  BELEGSUMME_FEHLT: "keine_summierbare_belegsumme",
  BELEGSUMME_NICHT_UNTER_SCHAETZUNG: "belegsumme_nicht_unter_schaetzung",
});

function hatGenauEineVorlaeufigeElZeile(belege) {
  const elZeilen = belege.filter((zeile) => zeile.traeger === TRAEGER_ELEVENLABS_CONVAI);
  return elZeilen.length === 1 && elZeilen[0].reife === REIFE.VORLAEUFIG;
}

function belegsummeUnterSchaetzung({ call, summeMikroCents, providerToBucketRateMicro }) {
  const { bucketCents } = convertProviderMicroToBucketCents({
    remMicro: 0, actualCostMicroCents: summeMikroCents, providerToBucketRateMicro,
  });
  return bucketCents < call.estimatedCostCents;
}

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
