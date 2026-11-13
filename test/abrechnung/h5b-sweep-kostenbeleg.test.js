import { test } from "node:test";
import assert from "node:assert/strict";
import { schreibeSweepKostenbeleg, sumMicroCents, SIP_TRUNKING_RECORD_TYPE, SWEEP_BELEG_ABLEHNUNG } from "../../src/billing/sweep-kostenbeleg.ts";
import { KOSTENPROFIL, KOSTENART } from "../../src/billing/kostenarten.js";

const SIP_ANRUF = { id: "call_h5b", costProfile: KOSTENPROFIL.EL_CONVAI_SIP, sipCallId: "otb_h5b" };
const MESSUNG = { source: "detail_records", billedSecTotal: 40, actualCostMicroCents: 3_000_000 };

function schreibe({ records, schreibFehler }) {
  const belege = [];
  const zeilen = { warn: [], error: [] };
  const store = {
    recordCallCostEvidence(eintrag) {
      if (schreibFehler !== undefined) throw schreibFehler;
      belege.push(eintrag);
    },
  };
  const alt = { warn: console.warn, error: console.error };
  console.warn = (...t) => zeilen.warn.push(t.join(" "));
  console.error = (...t) => zeilen.error.push(t.join(" "));
  try {
    schreibeSweepKostenbeleg({ store, call: SIP_ANRUF, measured: MESSUNG, records });
  } finally {
    console.warn = alt.warn;
    console.error = alt.error;
  }
  return { belege, zeilen };
}

test("h5b SIP-Beleg summiert nur Zeiten ganzer positiver Sekunden", () => {
  const { belege } = schreibe({
    records: [
      { recordType: SIP_TRUNKING_RECORD_TYPE, costMicroCents: 2_000_000, billedSec: 30 },
      { recordType: SIP_TRUNKING_RECORD_TYPE, costMicroCents: 1_000_000, billedSec: -5 },
      { recordType: SIP_TRUNKING_RECORD_TYPE, costMicroCents: 500_000 },
      { recordType: SIP_TRUNKING_RECORD_TYPE, costMicroCents: 500_000, billedSec: 1.5 },
    ],
  });
  assert.equal(belege.length, 1);
  assert.equal(belege[0].traeger, KOSTENART.TELNYX_SIP);
  assert.equal(belege[0].betragMikroCents, 4_000_000);
  assert.deepEqual(belege[0].detail, { billed_sec: 30 });
});

test("h5b SIP-Satz ohne Betrag: kein Beleg, Ablehnungsgrund im Log", () => {
  const { belege, zeilen } = schreibe({ records: [{ recordType: SIP_TRUNKING_RECORD_TYPE, billedSec: 30 }] });
  assert.equal(belege.length, 0);
  assert.equal(zeilen.warn.length, 1);
  assert.match(zeilen.warn[0], new RegExp(`grund=${SWEEP_BELEG_ABLEHNUNG.KEIN_BELEG}`));
});

test("h5b sumMicroCents: ein Satz ohne Betrag macht die Summe unbrauchbar", () => {
  assert.equal(sumMicroCents([{ costMicroCents: 1_000_000 }, {}]), null);
  assert.equal(sumMicroCents([{ costMicroCents: 1_000_000 }, { costMicroCents: 2_000_000 }]), 3_000_000);
});

const SCHREIBFEHLER = [
  ["Error", new Error("kaputt"), "Belegschreibung fehlgeschlagen (call=call_h5b): kaputt"],
  ["Text", "nur ein Text", "Belegschreibung fehlgeschlagen (call=call_h5b): nur ein Text"],
  ["null", null, "Belegschreibung fehlgeschlagen (call=call_h5b): null"],
];

for (const [name, fehler, erwartet] of SCHREIBFEHLER) {
  test(`h5b Schreibfehler (${name}) wird geloggt und nicht geworfen`, () => {
    const { zeilen } = schreibe({
      records: [{ recordType: SIP_TRUNKING_RECORD_TYPE, costMicroCents: 1_000_000, billedSec: 30 }],
      schreibFehler: fehler,
    });
    assert.equal(zeilen.error.length, 1);
    assert.ok(zeilen.error[0].endsWith(erwartet), zeilen.error[0]);
  });
}
