// F2 P9 (M2) - persistierter Summary-SMS-Dedup-Marker (summarySmsSentAt). Nagelt die
// Restart-Idempotenz fest: nach erfolgreichem Send markiert finishCall den Call mit
// summarySmsSentAt (ISO); der Marker ueberlebt - anders als das In-Memory-Flag
// call._finished - einen Prozess-Restart. Ein zweiter /voice/status-Callback (mit
// Restart dazwischen) findet den Marker und sendet KEINE zweite SMS (genau eine pro Call).
//
// Vier Achsen, alle offline (pglite = Postgres-in-WASM, kein Netz; sonst reine
// Funktionen) -> F.I.R.S.T.:
//   A) Persistenz: Marker round-trippt durch flush/hydrate des pg-Backends (AK1, AK3).
//   B) Guard: planSummarySms sieht den persistierten Marker -> send=false (AK2, AK3).
//   C) View: publicCall strippt den internen Marker (kein API-Leak, AK4).
//   D) Idempotenz: markSummarySmsSent gewinnt einmal, der gesetzte Marker bleibt stabil.
//
// ISOLATION: pglite NIE mit einem Server-Spawn in einer Datei (P3/P6a-Lehre) - hier nur pglite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore } from "../src/store/pg.js";
import { planSummarySms } from "../src/sms-summary.js";
import { publicCall } from "../src/store/views.js";
import { makeDefaultState, createCall, markSummarySmsSent } from "../src/store/state-ops.js";
import { NUMBER_STATUS, PROVIDER } from "../src/store/defaults.js";

const PROV = PROVIDER.TWILIO;

// Baut auf einer BESTEHENDEN pglite-Instanz einen frischen Store (re-hydriert den
// Spiegel aus der DB) -> simuliert den Prozess-Restart zwischen zwei Callbacks.
async function reopen(db) {
  const runner = { withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }) };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

// A) Persistenz (AK1, AK3): der Marker lebt am Store-Call-Record, nicht nur in der
// Laufzeit-Variable. Setzen -> flush -> NEUER Store aus derselben DB -> Marker da.
test("Marker round-trippt durch flush/hydrate (pg): summarySmsSentAt ueberlebt den Restart", async () => {
  const db = new PGlite();
  const store = await reopen(db);
  const c = store.createCall({ direction: "inbound", from: "+491701234567", to: "+4915100000001" });
  assert.equal(store.getCall(c.id).summarySmsSentAt, null, "frischer Call hat keinen Marker");

  store.markSummarySmsSent(c.id);
  await store.save();

  const reopened = await reopen(db);
  const sentAt = reopened.getCall(c.id).summarySmsSentAt;
  assert.ok(typeof sentAt === "string" && !Number.isNaN(Date.parse(sentAt)), "Marker ist eine persistierte ISO-Zeit");
});

// B) Guard (AK2, AK3): planSummarySms prueft den persistierten Marker VOR allen anderen
// Send-Bedingungen. Identischer Store, der ohne Marker sendet -> mit Marker send=false.
// Das ist die persistierte Haelfte des Doppel-Guards; call._finished deckt die
// In-Memory-Haelfte im selben Prozess ab (server.js finishCall).
test("Guard: persistierter Marker unterdrueckt die zweite SMS (send=false, kein reason)", () => {
  // Fake-Store, der genau die vier planSummarySms-Reads abbildet und sonst SENDEN wuerde.
  const store = {
    tenantPrivateNumber: () => "+491701234567",
    load: () => ({ numbers: [{ tenantId: "A", e164: "+4915100000001", status: NUMBER_STATUS.ACTIVE, provider: PROV }] }),
    tenantContext: () => ({ settings: { smsSummaryOptIn: true } }),
    dailySmsCount: () => 0,
  };
  const cfg = { sendSmsSummary: true };

  const before = planSummarySms(store, cfg, { id: "call_A", tenantId: "A", provider: PROV });
  assert.equal(before.send, true, "ohne Marker wuerde gesendet (Kontroll-Pfad)");

  // Zweiter Callback nach Restart: derselbe Call, jetzt mit persistiertem Marker.
  const after = planSummarySms(store, cfg, { id: "call_A", tenantId: "A", provider: PROV, summarySmsSentAt: new Date().toISOString() });
  assert.equal(after.send, false, "mit Marker wird NICHT erneut gesendet");
  assert.equal(after.reason, null, "normaler Dedup -> kein Ziel-Defizit, kein reason zu auditieren");
});

// C) View (AK4): der interne Marker darf den Server nie verlassen - publicCall strippt
// ihn (wie streamToken/_finished). Sonst leakte ein internes Timing-Detail in die API.
test("publicCall strippt summarySmsSentAt (kein API-Leak)", () => {
  const out = publicCall({ id: "call_A", summary: "ok", streamToken: "secret", _finished: true, summarySmsSentAt: "2026-06-23T10:00:00.000Z" });
  assert.equal(out.summarySmsSentAt, undefined, "Marker nicht in der API-View");
  assert.equal(out.streamToken, undefined, "streamToken weiterhin gestrippt");
  assert.equal(out._finished, undefined, "_finished weiterhin gestrippt");
  assert.equal(out.summary, "ok", "Nutzdaten bleiben erhalten");
});

// D) Idempotenz: der erste Aufruf setzt den Marker (changed=true), jeder weitere ist ein
// No-op (changed=false) -> der zuerst gesetzte Zeitstempel gewinnt und bleibt stabil.
test("markSummarySmsSent ist idempotent: gesetzter Marker gewinnt, kein zweites Schreiben", () => {
  const s = makeDefaultState();
  const c = createCall(s, { direction: "inbound", from: "+49170", to: "+49151" });

  const first = markSummarySmsSent(s, c.id);
  assert.equal(first.changed, true, "erstes Setzen aendert den Record");
  const stamp = first.call.summarySmsSentAt;
  assert.ok(stamp, "Marker gesetzt");

  const second = markSummarySmsSent(s, c.id);
  assert.equal(second.changed, false, "zweites Setzen ist ein No-op (kein Wrapper-save)");
  assert.equal(second.call.summarySmsSentAt, stamp, "Zeitstempel unveraendert (gesetzter gewinnt)");
});

// Fehlender Call -> kein Throw, changed=false (Muster markAnswered): ein /voice/status fuer
// einen unbekannten Call darf den Marker-Setter nicht crashen.
test("markSummarySmsSent fuer unbekannten Call: changed=false, kein Throw", () => {
  const s = makeDefaultState();
  const res = markSummarySmsSent(s, "call_does_not_exist");
  assert.equal(res.changed, false);
  assert.equal(res.call, null);
});
