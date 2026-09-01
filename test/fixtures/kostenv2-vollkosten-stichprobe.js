// ---- KV2-10: die 8 angenommenen EL-Anrufe als Vollkosten-Stichprobe der Route el_convai_sip ----
// Muster test/fixtures/elevenlabs-conversations.js: echte Messwerte mit Herkunfts-
// Kommentar, markiert "NICHT gemessen", wo modelliert - nie unmarkiert erfinden.
//
// EL-Ist: tasks/kostenv2/AUFTRAG.md B2 (metadata.cost_fiat je Anruf, in Mikro-Cent:
// 0,1042 USD = 10_420_000). Telnyx-Ist: tasks/kostenv2/befund-telnyx.md O2 - 7x
// Mobilfunk 0,0401 USD/min (call_sec -> billed_sec IMMER auf die volle Minute
// aufgerundet), 1x Festnetz 0,0231 USD/min (der 76-s-Anruf, 2 abgerechnete Minuten =
// 0,0462 USD). HINWEIS zum Plan: dessen Klammerkommentar "1x Festnetz 76-s-Anruf
// 2 x 0,0401" widerspricht seiner eigenen Quelle O2 (Festnetz-Rate 0,0231, nicht
// 0,0401) - diese Fixture folgt der MESSUNG, nicht dem Klammerkommentar.
//
// eigenCent: NICHT gemessen - Briefing/Eroeffnungssatz buchen callId:null (sie laufen
// VOR store.createCall), research_fee schreibt kein usage_event. 3 ct/anruf ist ein
// modellierter, konservativer Satz und als solcher markiert. Die Gegenprobe in
// test/kv2-10-tarifpaar.test.js stellt auf die DELTA-Wirkung ab (mit vs. ohne Eigen-Cent),
// nicht auf den Absolutwert.
import { createCall, recordCallCostEvidence, makeDefaultState } from "../../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, COST_TRUING_SOURCE, REIFE } from "../../src/store/defaults.js";
import { KOSTENART, KOSTENPROFIL } from "../../src/billing/kostenarten.js";
// MS_PER_SECOND statt einer nackten 1000 (G25) - dieselbe Quelle wie der Sweep.
import { MS_PER_SECOND } from "../../src/utils/timer.js";

export const EL_STICHPROBE = Object.freeze([
  // B2-Zeile 1 (53 s, 0,1042 USD, gebucht 30 ct) + O2: Mobilfunk, 1 abgerechnete Minute x 0,0401 USD.
  Object.freeze({ callId: "call_mt0ddduxuzgl", dauerS: 53, elMikroCents: 10_420_000, telnyxMikroCents: 4_010_000, eigenCent: 3, gebuchtCents: 30 }),
  // B2-Zeile 2 (41 s, 0,0859 USD, gebucht 30 ct) + O2: Mobilfunk, 1 Minute x 0,0401 USD.
  Object.freeze({ callId: "call_mt18soytibps", dauerS: 41, elMikroCents: 8_590_000, telnyxMikroCents: 4_010_000, eigenCent: 3, gebuchtCents: 30 }),
  // B2-Zeile 3 (44 s, 0,1175 USD, gebucht 30 ct) + O2: Mobilfunk, 1 Minute x 0,0401 USD.
  Object.freeze({ callId: "call_mt1rnbnfl2bp", dauerS: 44, elMikroCents: 11_750_000, telnyxMikroCents: 4_010_000, eigenCent: 3, gebuchtCents: 30 }),
  // B2-Zeile 4 (8 s, 0,0099 USD, gebucht 30 ct) + O2: Mobilfunk, trotzdem 1 volle Minute x 0,0401 USD.
  Object.freeze({ callId: "call_mt1s9bk9qvhb", dauerS: 8, elMikroCents: 990_000, telnyxMikroCents: 4_010_000, eigenCent: 3, gebuchtCents: 30 }),
  // B2-Zeile 5 (17 s, 0,0215 USD, gebucht 30 ct) + O2: Mobilfunk, 1 Minute x 0,0401 USD.
  Object.freeze({ callId: "call_mt1sa9vpavy0", dauerS: 17, elMikroCents: 2_150_000, telnyxMikroCents: 4_010_000, eigenCent: 3, gebuchtCents: 30 }),
  // B2-Zeile 6 (12 s, 0,0155 USD, gebucht 30 ct) + O2: Mobilfunk, 1 Minute x 0,0401 USD.
  Object.freeze({ callId: "call_mtd0acq2hq4q", dauerS: 12, elMikroCents: 1_550_000, telnyxMikroCents: 4_010_000, eigenCent: 3, gebuchtCents: 30 }),
  // B2-Zeile 7 (76 s, 0,1333 USD, gebucht 60 ct) + O2: FESTNETZ, 2 abgerechnete Minuten x 0,0231 USD.
  Object.freeze({ callId: "call_mtd0yf5wzpi6", dauerS: 76, elMikroCents: 13_330_000, telnyxMikroCents: 4_620_000, eigenCent: 3, gebuchtCents: 60 }),
  // B2-Zeile 8 (35 s, 0,0750 USD, gebucht 30 ct) + O2: Mobilfunk, 1 Minute x 0,0401 USD.
  Object.freeze({ callId: "call_mtfm5ss7g3jz", dauerS: 35, elMikroCents: 7_500_000, telnyxMikroCents: 4_010_000, eigenCent: 3, gebuchtCents: 30 }),
]);

// Die Eigen-Cent-Quelle aus der Fixture (callId -> Cent) - genau die Form, die
// tarifpaarReport/vollkostenStichprobenJeRoute als eigenCentJeAnruf entgegennimmt.
export function eigenCentQuelleJeAnruf(fixture = EL_STICHPROBE) {
  return new Map(fixture.map((zeile) => [zeile.callId, zeile.eigenCent]));
}

// Der pauschale (nicht beleg-ref-taugliche) Quellen-String der Fixture-Zeilen; Formregel
// QUELLE_MUSTER (a-z Beginn, a-z0-9_) in store/cost-evidence.js.
const FIXTURE_QUELLE = "kv2_10_fixture";

// Fester Gespraechs-Ende-Anker (deterministisch, kein Date.now() in der Fixture).
const STICHPROBEN_ENDE_MS = Date.parse("2026-08-30T12:00:00Z");

// Baut aus der Stichprobe einen echten State-Spiegel: createCall-Shape je Anruf plus
// ZWEI callCostEvidence-Zeilen (elevenlabs_convai, telnyx_sip), beide reife=belegt,
// costProfile=el_convai_sip, costTruedSource=kostenbuch_vollbeleg (gesettelt UND
// beweisend), answeredAt/endedAt aus dauerS. Geteilt zwischen dem Rein-Test
// (test/kv2-10-tarifpaar.test.js) und dem Sweep-Kanal-Test (G5: EINE Fixture-Bauerin).
// Die Anruf-IDs werden auf die Fixture-IDs gepinnt, damit eigenCentQuelleJeAnruf()
// darauf passt - createCall zieht sich sonst eine Zufalls-ID.
export function elVollkostenState(state = makeDefaultState()) {
  for (const zeile of EL_STICHPROBE) {
    const call = createCall(state, {
      direction: "outbound",
      from: "+4930111222333",
      to: "+4930111222333",
      tenantId: BOOTSTRAP_TENANT_ID,
      provider: "telnyx",
    });
    call.id = zeile.callId;
    call.status = "completed";
    call.costProfile = KOSTENPROFIL.EL_CONVAI_SIP;
    call.costTruedSource = COST_TRUING_SOURCE.KOSTENBUCH_VOLLBELEG;
    call.endedAt = new Date(STICHPROBEN_ENDE_MS).toISOString();
    call.answeredAt = new Date(STICHPROBEN_ENDE_MS - zeile.dauerS * MS_PER_SECOND).toISOString();
    call.costTruedAt = call.endedAt;
    // B2-Spalte "gebucht": die damalige Schaetzung am Call (30 ct je Anruf, 60 ct fuer den
    // 76-s-Anruf). Der Tarifpaar-Waechter liest sie nicht - sie haelt den State-Spiegel
    // fuer den Sweep-Kanal-Test realistisch (coverageBreakdown stuft einen Call ohne
    // buchbare Schaetzung als ohne_schaetzung ein und die Deckungsquote faelle auf 0 %).
    call.estimatedCostCents = zeile.gebuchtCents;
    for (const [traeger, betragMikroCents] of [
      [KOSTENART.ELEVENLABS_CONVAI, zeile.elMikroCents],
      [KOSTENART.TELNYX_SIP, zeile.telnyxMikroCents],
    ]) {
      recordCallCostEvidence(state, {
        callId: call.id,
        traeger,
        reife: REIFE.BELEGT,
        betragMikroCents,
        waehrung: "USD",
        quelle: FIXTURE_QUELLE,
        belegRef: zeile.callId,
      });
    }
  }
  return state;
}
