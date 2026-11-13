import assert from "node:assert/strict";
import { test } from "node:test";

import { declineDetail, declineOf } from "../../src/billing/decline.ts";
import { belegSummeJeTraegerFuerMonat } from "../../src/billing/kosten-projektion.ts";
import { PROVISION_REASON, provisionAuditDetail } from "../../src/billing/provision-outcome.ts";
import { REIFE } from "../../src/begriffe/abrechnung.js";

const MONAT = "2026-10";
const MIKRO_A1 = 2_000_000;
const MIKRO_A2 = 3_000_000;
const MIKRO_B = 7_000_000;

test("provisionAuditDetail: Tabelle aus Ergebnis und Audit-Zeile", () => {
  const faelle = [
    [null, "provision=none"],
    [undefined, "provision=none"],
    [{}, "provision=none"],
    [{ reason: PROVISION_REASON.QUEUED }, "provision=queued"],
    [{ reason: PROVISION_REASON.ALREADY_PROVISIONED }, "provision=already_provisioned"],
    [{ reason: PROVISION_REASON.PERSIST_ERROR }, "provision=withheld:persist_error"],
  ];
  for (const [ergebnis, erwartet] of faelle) assert.equal(provisionAuditDetail(ergebnis), erwartet);
});

test("declineOf: fehlender Fehlerkoerper ergibt lauter null, nicht einen Wurf", () => {
  const leer = { code: null, declineCode: null, type: null };
  assert.deepEqual(declineOf(null), leer);
  assert.deepEqual(declineOf(undefined), leer);
  assert.deepEqual(declineOf({}), leer);
});

test("declineDetail: gesetzte Felder stehen mit Leerzeichen getrennt in einer Zeile", () => {
  const decline = declineOf({ error: { code: "card_declined", decline_code: "insufficient_funds" } });
  assert.equal(declineDetail(decline), "code=card_declined decline_code=insufficient_funds");
});

test("belegSummeJeTraegerFuerMonat: mehrere Belege eines Traegers werden summiert", () => {
  const state = {
    calls: [
      { id: "c1", costTruedAt: "2026-10-02T00:00:00Z", estimatedCostSpendMonthKey: MONAT },
      { id: "c2", costTruedAt: null, estimatedCostSpendMonthKey: MONAT },
    ],
    callCostEvidence: [
      { callId: "c1", traeger: "a", reife: REIFE.BELEGT, betragMikroCents: MIKRO_A1 },
      { callId: "c1", traeger: "a", reife: REIFE.BELEGT, betragMikroCents: MIKRO_A2 },
      { callId: "c1", traeger: "b", reife: REIFE.BELEGT, betragMikroCents: MIKRO_B },
      { callId: "c2", traeger: "a", reife: REIFE.BELEGT, betragMikroCents: MIKRO_B },
    ],
  };
  assert.deepEqual(belegSummeJeTraegerFuerMonat({ state, monthKey: MONAT }), [
    { traeger: "a", mikroCents: MIKRO_A1 + MIKRO_A2 },
    { traeger: "b", mikroCents: MIKRO_B },
  ]);
});
