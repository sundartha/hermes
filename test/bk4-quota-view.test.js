// BK4 - Minuten-Kontingent-Ableitung (reiner Unit-Test, kein Server/pglite, F.I.R.S.T.).
// Deterministisch ueber ein FIXES Fenster: Periode endet 2026-07-15, Start abgeleitet
// 2026-06-15 (Ende minus 1 Monat). occurredAt der Events wird gesetzt (kein Date.now),
// damit in-/out-of-window stabil sind. Prueft quotaView (Plan-Katalog + Ledger) und den
// Raw-Reader voiceMinutesUsedSince.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  makeDefaultState,
  recordUsageEvent,
  voiceMinutesUsedSince,
} from "../src/store/state-ops.js";
import { quotaView } from "../src/billing/meter.js";
import { USAGE_EVENT_KIND } from "../src/store/defaults.js";

// Fixes Fenster (zeit-frei): currentPeriodEnd = Unix-Sekunden zu 2026-07-15T00:00Z.
// periodStartIso leitet daraus 2026-06-15T00:00Z ab.
const MS_PER_SECOND = 1000;
const PERIOD_END_SEC = Date.UTC(2026, 6, 15) / MS_PER_SECOND; // 2026-07-15T00:00:00Z
const IN_WINDOW = "2026-06-20T10:00:00.000Z";
const OUT_OF_WINDOW = "2026-05-01T10:00:00.000Z";
const TENANT_A = "t_a";
const TENANT_B = "t_b";

// Seedet EIN Voice-Event mit deterministischem occurredAt (ueberschreibt den Recorder-
// Zeitstempel) und optionalem Flush-Flag. Liefert das Event.
function seedVoice(s, { tenantId = TENANT_A, quantity, occurredAt = IN_WINDOW, sent = false }) {
  const e = recordUsageEvent(s, {
    tenantId,
    kind: USAGE_EVENT_KIND.VOICE_MINUTE,
    quantity,
    costCents: 0,
  });
  e.occurredAt = occurredAt;
  e.stripeMeterSent = sent;
  return e;
}

// Seedet ein Event eines beliebigen kind (fuer die kind-Isolation).
function seedKind(s, { tenantId = TENANT_A, kind, quantity, occurredAt = IN_WINDOW }) {
  const e = recordUsageEvent(s, { tenantId, kind, quantity, costCents: 0 });
  e.occurredAt = occurredAt;
  return e;
}

const quotaA = (s, planSlug = "starter", currentPeriodEnd = PERIOD_END_SEC) =>
  quotaView(s, { tenantId: TENANT_A, planSlug, currentPeriodEnd });

test("(1) frischer starter ohne Events -> volles Kontingent", () => {
  const s = makeDefaultState();
  assert.deepEqual(quotaA(s), { includedMinutes: 30, usedMinutes: 0, remainingMinutes: 30 });
});

test("(2) Teilverbrauch summiert die Minuten im Fenster", () => {
  const s = makeDefaultState();
  seedVoice(s, { quantity: 5 });
  seedVoice(s, { quantity: 8 });
  assert.deepEqual(quotaA(s), { includedMinutes: 30, usedMinutes: 13, remainingMinutes: 17 });
});

test("(3) Ueberverbrauch klemmt remaining auf 0 (nie negativ)", () => {
  const s = makeDefaultState();
  seedVoice(s, { quantity: 20 });
  seedVoice(s, { quantity: 15 });
  assert.deepEqual(quotaA(s), { includedMinutes: 30, usedMinutes: 35, remainingMinutes: 0 });
});

test("(4) Out-of-window-Events zaehlen nicht (Periode greift)", () => {
  const s = makeDefaultState();
  seedVoice(s, { quantity: 10, occurredAt: IN_WINDOW });
  seedVoice(s, { quantity: 99, occurredAt: OUT_OF_WINDOW });
  assert.equal(quotaA(s).usedMinutes, 10);
});

test("(5) Tenant-Isolation: fremder Verbrauch beeinflusst das eigene Kontingent nicht", () => {
  const s = makeDefaultState();
  seedVoice(s, { tenantId: TENANT_B, quantity: 50 });
  assert.deepEqual(quotaA(s), { includedMinutes: 30, usedMinutes: 0, remainingMinutes: 30 });
});

test("(6) kind-Isolation: nur voice_minute zaehlt", () => {
  const s = makeDefaultState();
  seedKind(s, { kind: USAGE_EVENT_KIND.AI_TOKEN, quantity: 100 });
  seedKind(s, { kind: USAGE_EVENT_KIND.SMS, quantity: 7 });
  seedKind(s, { kind: USAGE_EVENT_KIND.NUMBER_MONTH, quantity: 1 });
  assert.equal(quotaA(s).usedMinutes, 0);
});

test("(7) bereits geflushte Events (stripeMeterSent) zaehlen weiter (Flush != Periode)", () => {
  const s = makeDefaultState();
  seedVoice(s, { quantity: 12, sent: true });
  assert.equal(quotaA(s).usedMinutes, 12);
});

test("(8) unbekannter/fehlender Plan -> null (Leerzustand)", () => {
  const s = makeDefaultState();
  assert.equal(
    quotaView(s, { tenantId: TENANT_A, planSlug: "gold", currentPeriodEnd: PERIOD_END_SEC }),
    null,
  );
  assert.equal(
    quotaView(s, { tenantId: TENANT_A, planSlug: null, currentPeriodEnd: PERIOD_END_SEC }),
    null,
  );
});

test("(9) fehlendes currentPeriodEnd -> used 0, volles Kontingent (transient)", () => {
  const s = makeDefaultState();
  seedVoice(s, { quantity: 9 });
  assert.deepEqual(quotaA(s, "starter", null), {
    includedMinutes: 30,
    usedMinutes: 0,
    remainingMinutes: 30,
  });
});

test("(10) business -> includedMinutes 120", () => {
  const s = makeDefaultState();
  assert.equal(quotaA(s, "business").includedMinutes, 120);
});

test("(11) voiceMinutesUsedSince summiert ab sinceIso (Raw-Reader)", () => {
  const s = makeDefaultState();
  seedVoice(s, { quantity: 4, occurredAt: IN_WINDOW });
  seedVoice(s, { quantity: 6, occurredAt: OUT_OF_WINDOW });
  assert.equal(voiceMinutesUsedSince(s, TENANT_A, "2026-06-01T00:00:00.000Z"), 4);
});
