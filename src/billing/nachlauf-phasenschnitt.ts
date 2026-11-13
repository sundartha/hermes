import { KOSTENPROFIL, kostenprofilFuerAnruf } from "./kostenarten.js";
import { REIFE, isBookableCents } from "../begriffe/abrechnung.js";
import { convertProviderMicroToBucketCents } from "../store/state-ops.js";
import { ENDZUSTAND, abschlussFuerAnruf } from "./kosten-abschluss.ts";
import { settlementProjektion } from "./kosten-projektion.ts";
import type { AbschlussAnruf, AbschlussBeleg } from "./kosten-abschluss.ts";

interface NachlaufAnruf extends AbschlussAnruf {
  id: string;
  costTruedAt: string | null;
  estimatedCostCents: number | null;
}

interface NachlaufSpeicher {
  load(): { calls: NachlaufAnruf[] };
  callCostEvidence(callId: string): AbschlussBeleg[];
  oeffneKostenAbgleichErneut(callId: string): unknown;
}

type Pruefung = { treffer: true } | { treffer: false; grund: string };

interface NachlaufBericht {
  apply: boolean;
  scanned: number;
  treffer: { id: string }[];
  skipped: { id: string; reason: string }[];
}

export const NACHLAUF_SKIP = Object.freeze({
  KEIN_EL_PROFIL: "kein_el_profil",
  NICHT_GELATCHT: "nicht_gelatcht",
  KEIN_SIP_BELEG: "kein_telnyx_sip_beleg",
  EL_BELEG_VORHANDEN: "el_beleg_vorhanden",
});

const TRAEGER_TELNYX_SIP = "telnyx_sip";
const TRAEGER_ELEVENLABS_CONVAI = "elevenlabs_convai";

const EL_ZEILE_GESAMMELT: ReadonlySet<string | undefined> = new Set([REIFE.VORLAEUFIG, REIFE.BELEGT]);

export function istImPhasenschnittGelatcht({ call, belege }: {
  call: NachlaufAnruf;
  belege: AbschlussBeleg[];
}): Pruefung {
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

function laufUeberAnrufe({ store, apply, trifftZu }: {
  store: NachlaufSpeicher;
  apply: boolean;
  trifftZu: (call: NachlaufAnruf, belege: AbschlussBeleg[]) => Pruefung;
}): NachlaufBericht {
  const state = store.load();
  const report: NachlaufBericht = { apply, scanned: 0, treffer: [], skipped: [] };
  for (const call of state.calls) {
    report.scanned++;
    const belege = store.callCostEvidence(call.id);
    const pruefung = trifftZu(call, belege);
    if (!pruefung.treffer) {
      report.skipped.push({ id: call.id, reason: pruefung.grund });
      continue;
    }
    report.treffer.push({ id: call.id });
    if (apply) store.oeffneKostenAbgleichErneut(call.id);
  }
  return report;
}

export function oeffneGelatchteElAnrufe({ store, apply = false }: {
  store: NachlaufSpeicher;
  apply?: boolean;
}): NachlaufBericht {
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

function hatGenauEineVorlaeufigeElZeile(belege: AbschlussBeleg[]): boolean {
  const elZeilen = belege.filter((zeile) => zeile.traeger === TRAEGER_ELEVENLABS_CONVAI);
  const [erste, ...weitere] = elZeilen;
  return erste !== undefined && weitere.length === 0 && erste.reife === REIFE.VORLAEUFIG;
}

function belegsummeUnterSchaetzung({ schaetzungCents, summeMikroCents, providerToBucketRateMicro }: {
  schaetzungCents: number;
  summeMikroCents: number;
  providerToBucketRateMicro: number;
}): boolean {
  const { bucketCents } = convertProviderMicroToBucketCents({
    remMicro: 0, actualCostMicroCents: summeMikroCents, providerToBucketRateMicro,
  });
  return bucketCents < schaetzungCents;
}

export function istZwangsGesetteltImKv2_8Fenster({ call, belege, nowMs, deadlineMs, providerToBucketRateMicro }: {
  call: NachlaufAnruf;
  belege: AbschlussBeleg[];
  nowMs: number;
  deadlineMs: number;
  providerToBucketRateMicro: number;
}): Pruefung {
  if (kostenprofilFuerAnruf(call) !== KOSTENPROFIL.EL_CONVAI_SIP)
    return { treffer: false, grund: NACHLAUF_KV2_9_SKIP.KEIN_EL_PROFIL };
  if (call.costTruedAt === null) return { treffer: false, grund: NACHLAUF_KV2_9_SKIP.NICHT_GESCHLOSSEN };
  const abschluss = abschlussFuerAnruf({ call, belege, nowMs, deadlineMs, sweepTraegerErledigt: false });
  if (!abschluss.geschlossen || abschluss.endzustand !== ENDZUSTAND.UNVOLLSTAENDIG_FINAL)
    return { treffer: false, grund: NACHLAUF_KV2_9_SKIP.ANDERER_ENDZUSTAND };
  if (!hatGenauEineVorlaeufigeElZeile(belege))
    return { treffer: false, grund: NACHLAUF_KV2_9_SKIP.KEINE_VORLAEUFIGE_EL_ZEILE };
  const schaetzungCents = call.estimatedCostCents ?? Number.NaN;
  if (!isBookableCents(schaetzungCents))
    return { treffer: false, grund: NACHLAUF_KV2_9_SKIP.KEINE_SCHAETZUNG };
  const { summeMikroCents } = settlementProjektion({ call, belege });
  if (summeMikroCents === null) return { treffer: false, grund: NACHLAUF_KV2_9_SKIP.BELEGSUMME_FEHLT };
  if (!belegsummeUnterSchaetzung({ schaetzungCents, summeMikroCents, providerToBucketRateMicro }))
    return { treffer: false, grund: NACHLAUF_KV2_9_SKIP.BELEGSUMME_NICHT_UNTER_SCHAETZUNG };
  return { treffer: true };
}

export function oeffneZwangsGesettelteElAnrufe({ store, apply = false, nowMs, deadlineMs, providerToBucketRateMicro }: {
  store: NachlaufSpeicher;
  apply?: boolean;
  nowMs: number;
  deadlineMs: number;
  providerToBucketRateMicro: number;
}): NachlaufBericht {
  return laufUeberAnrufe({
    store, apply,
    trifftZu: (call, belege) => istZwangsGesetteltImKv2_8Fenster({ call, belege, nowMs, deadlineMs, providerToBucketRateMicro }),
  });
}
