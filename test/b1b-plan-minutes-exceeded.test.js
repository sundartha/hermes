// B1b - Minuten-Kontingent-Gate-Praedikat planMinutesExceeded (reiner Unit-Test,
// Geschwister-Muster zu bk4-quota-view.test.js: makeDefaultState, fixes Fenster,
// deterministisches occurredAt, kein Date.now). Plus EIN pglite-Fassaden-Durchreich-
// Test (Muster store-pg-tenant-budget.test.js) - der pg-Wrapper hydriert ueber
// requireState(). F.I.R.S.T.: kein Netz, keine externe DB.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeDefaultState, recordUsageEvent, planMinutesExceeded } from "../src/store/state-ops.js";
import { USAGE_EVENT_KIND } from "../src/store/defaults.js";
import { makePgTestStore } from "./pg-helpers.js";
import * as ops from "../src/store/state-ops.js";

const PERIOD_START = "2026-06-15T00:00:00.000Z";
const IN_WINDOW = "2026-06-20T10:00:00.000Z";
const OUT_OF_WINDOW = "2026-05-01T10:00:00.000Z";
const TENANT_A = "t_a";
const TENANT_B = "t_b";

// Seedet EIN Voice-Event mit deterministischem occurredAt (ueberschreibt den Recorder-
// Zeitstempel). Liefert das Event.
function seedVoice(s, { tenantId = TENANT_A, quantity, occurredAt = IN_WINDOW }) {
  const e = recordUsageEvent(s, { tenantId, kind: USAGE_EVENT_KIND.VOICE_MINUTE, quantity, costCents: 0 });
  e.occurredAt = occurredAt;
  return e;
}

// Seedet ein Event eines beliebigen kind (fuer die Achsen-Isolation).
function seedKind(s, { tenantId = TENANT_A, kind, quantity, occurredAt = IN_WINDOW }) {
  const e = recordUsageEvent(s, { tenantId, kind, quantity, costCents: 0 });
  e.occurredAt = occurredAt;
  return e;
}

const opt = (includedMinutes, periodStartIso = PERIOD_START) => ({ includedMinutes, periodStartIso });

test("(1) used >= included -> true (Schwelle exakt: 30/30)", () => {
  const s = makeDefaultState();
  seedVoice(s, { quantity: 30 });
  assert.equal(planMinutesExceeded(s, TENANT_A, opt(30)), true);
});

test("(2) used < included -> false", () => {
  const s = makeDefaultState();
  seedVoice(s, { quantity: 29 });
  assert.equal(planMinutesExceeded(s, TENANT_A, opt(30)), false);
});

test("(3) leerer Ledger + gueltiger Anker -> false (nie exceeded)", () => {
  const s = makeDefaultState();
  assert.equal(planMinutesExceeded(s, TENANT_A, opt(30)), false);
});

test("(4) Out-of-window-Events zaehlen nicht (Reset-Fenster)", () => {
  const s = makeDefaultState();
  seedVoice(s, { quantity: 99, occurredAt: OUT_OF_WINDOW });
  assert.equal(planMinutesExceeded(s, TENANT_A, opt(30)), false);
});

test("(5) Tenant-Isolation: fremder Verbrauch laesst A unberuehrt", () => {
  const s = makeDefaultState();
  seedVoice(s, { tenantId: TENANT_B, quantity: 50 });
  assert.equal(planMinutesExceeded(s, TENANT_A, opt(30)), false);
});

test("(6) fail-closed: fehlender Anker -> true, auch bei leerem Ledger", () => {
  const s = makeDefaultState();
  // Explizite Objekte (NICHT der opt-Helper): dessen Default periodStartIso=PERIOD_START
  // greift bei undefined und wuerde die "kein Anker"-Variante verfaelschen.
  assert.equal(planMinutesExceeded(s, TENANT_A, { includedMinutes: 30, periodStartIso: "" }), true);
  assert.equal(planMinutesExceeded(s, TENANT_A, { includedMinutes: 30, periodStartIso: null }), true);
  assert.equal(planMinutesExceeded(s, TENANT_A, { includedMinutes: 30 }), true);
});

test("(7) fail-closed: fehlendes includedMinutes -> true", () => {
  const s = makeDefaultState();
  assert.equal(planMinutesExceeded(s, TENANT_A, opt(undefined)), true);
  assert.equal(planMinutesExceeded(s, TENANT_A, opt(null)), true);
  assert.equal(planMinutesExceeded(s, TENANT_A, opt(NaN)), true);
});

test("(8) fail-closed: kein Optionsobjekt -> true (Default-{} greift)", () => {
  const s = makeDefaultState();
  assert.equal(planMinutesExceeded(s, TENANT_A), true);
});

test("(9) EUR-Unabhaengigkeit: nur VOICE_MINUTE zaehlt (kein Doppelzaehlen)", () => {
  const s = makeDefaultState();
  seedKind(s, { kind: USAGE_EVENT_KIND.AI_TOKEN, quantity: 1000 });
  seedKind(s, { kind: USAGE_EVENT_KIND.SMS, quantity: 50 });
  assert.equal(planMinutesExceeded(s, TENANT_A, opt(30)), false);
});

test("(10) pglite-Fassade: Durchreich + fail-closed ueber den pg-Wrapper", async () => {
  const { store } = await makePgTestStore();
  const s = store.load();
  const e = ops.recordUsageEvent(s, {
    tenantId: TENANT_A,
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity: 30,
    costCents: 0,
  });
  e.occurredAt = IN_WINDOW;
  assert.equal(store.planMinutesExceeded(TENANT_A, opt(30)), true);
  assert.equal(store.planMinutesExceeded(TENANT_A, opt(31)), false);
  assert.equal(store.planMinutesExceeded(TENANT_A, opt(30, "")), true);
});
