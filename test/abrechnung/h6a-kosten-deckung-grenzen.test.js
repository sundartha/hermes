import assert from "node:assert/strict";
import { test } from "node:test";

import { kostenBuchBericht, KOSTEN_BEFUND } from "../../src/billing/kosten-deckung.ts";
import { KOSTENPROFIL, KOSTENART } from "../../src/billing/kostenarten.js";
import { REIFE } from "../../src/begriffe/abrechnung.js";

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const JETZT = Date.parse("2026-11-13T12:00:00.000Z");
const TELNYX = KOSTENART.TELNYX_CALL_RECORDS;
const ABRECHNUNG = {
  costTruingDelayMinutes: 5,
  costTruingSweepIntervalMs: MS_PER_MINUTE,
  costSettleDeadlineHours: 24,
  kostenHeartbeatFensterH: 6,
  costTruingMinCoveragePercent: 80,
};
const vorMin = (minuten) => new Date(JETZT - minuten * MS_PER_MINUTE).toISOString();
const anruf = (id, minutenher) => ({ id, costProfile: KOSTENPROFIL.TELNYX_BUDGET, endedAt: vorMin(minutenher) });
const beleg = (callId, reife) => ({ callId, traeger: TELNYX, reife });
const bericht = (state, deckungFensterMs) =>
  kostenBuchBericht({ state, billing: ABRECHNUNG, nowMs: JETZT, deckungFensterMs });

test("h6a Grenze: Deckung genau auf der Schwelle ist kein Befund, knapp darunter schon", () => {
  const calls = ["a1", "a2", "a3", "a4", "a5"].map((id) => anruf(id, 30));
  const belegtBis = (zahl) =>
    calls.map((call, nr) => beleg(call.id, nr < zahl ? REIFE.BELEGT : REIFE.ERWARTET));
  const genau = bericht({ calls, callCostEvidence: belegtBis(4) }, 3 * MS_PER_HOUR);
  assert.equal(genau.deckung[0].prozent, 80);
  assert.deepEqual(genau.befunde, []);
  const darunter = bericht({ calls, callCostEvidence: belegtBis(3) }, 3 * MS_PER_HOUR);
  assert.equal(darunter.deckung[0].prozent, 60);
  assert.deepEqual(
    darunter.befunde.map((befund) => befund.code),
    [`${KOSTEN_BEFUND.DECKUNG_UNTER_SCHWELLE}:${TELNYX}`],
  );
});

test("h6a Grenze: Anruf mit Beleg und abgelaufener Frist bleibt ein Kandidat und wird nicht als unbeschaffbar gezaehlt", () => {
  const calls = [anruf("alt", 25 * 60)];
  const ergebnis = bericht({ calls, callCostEvidence: [beleg("alt", REIFE.ERWARTET)] }, 48 * MS_PER_HOUR);
  assert.deepEqual(ergebnis.deckung, [
    { traeger: TELNYX, kandidaten: 1, belegt: 0, offen: 1, unbeschaffbar: 0, prozent: 0 },
  ]);
});
