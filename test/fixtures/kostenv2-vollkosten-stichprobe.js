import { createCall, recordCallCostEvidence, makeDefaultState } from "../../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID, COST_TRUING_SOURCE, REIFE } from "../../src/store/defaults.js";
import { KOSTENART, KOSTENPROFIL } from "../../src/billing/kostenarten.js";
import { MS_PER_SECOND } from "../../src/utils/timer.js";

export const EL_STICHPROBE = Object.freeze([
  Object.freeze({ callId: "call_mt0ddduxuzgl", dauerS: 53, elMikroCents: 10_420_000, telnyxMikroCents: 4_010_000, eigenCent: 3, gebuchtCents: 30 }),
  Object.freeze({ callId: "call_mt18soytibps", dauerS: 41, elMikroCents: 8_590_000, telnyxMikroCents: 4_010_000, eigenCent: 3, gebuchtCents: 30 }),
  Object.freeze({ callId: "call_mt1rnbnfl2bp", dauerS: 44, elMikroCents: 11_750_000, telnyxMikroCents: 4_010_000, eigenCent: 3, gebuchtCents: 30 }),
  Object.freeze({ callId: "call_mt1s9bk9qvhb", dauerS: 8, elMikroCents: 990_000, telnyxMikroCents: 4_010_000, eigenCent: 3, gebuchtCents: 30 }),
  Object.freeze({ callId: "call_mt1sa9vpavy0", dauerS: 17, elMikroCents: 2_150_000, telnyxMikroCents: 4_010_000, eigenCent: 3, gebuchtCents: 30 }),
  Object.freeze({ callId: "call_mtd0acq2hq4q", dauerS: 12, elMikroCents: 1_550_000, telnyxMikroCents: 4_010_000, eigenCent: 3, gebuchtCents: 30 }),
  Object.freeze({ callId: "call_mtd0yf5wzpi6", dauerS: 76, elMikroCents: 13_330_000, telnyxMikroCents: 4_620_000, eigenCent: 3, gebuchtCents: 60 }),
  Object.freeze({ callId: "call_mtfm5ss7g3jz", dauerS: 35, elMikroCents: 7_500_000, telnyxMikroCents: 4_010_000, eigenCent: 3, gebuchtCents: 30 }),
]);

export function eigenCentQuelleJeAnruf(fixture = EL_STICHPROBE) {
  return new Map(fixture.map((zeile) => [zeile.callId, zeile.eigenCent]));
}

const FIXTURE_QUELLE = "kv2_10_fixture";

export const STICHPROBEN_ENDE_MS = Date.parse("2026-08-30T12:00:00Z");

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
