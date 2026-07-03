// F9 (A6, T3) - Bucht-Idempotenz-Marker (billedAt). Zwei Achsen, beide offline
// (F.I.R.S.T.: fast/repeatable), pglite = Postgres-in-WASM (kein Netz):
//   A) reine State-Op-Idempotenz: markBilled setzt genau einmal, jeder Folgeaufruf ist No-op.
//   B) Persistenz/Hydrierung: billedAt ueberlebt flush -> NEUER Store aus derselben pglite-
//      DB (Prozess-Restart-Simulation) - das ist der prozessuebergreifende Idempotenz-Weg,
//      den finishcall-billing-once.test.js (Spawn) end-to-end ueber die echte Route deckt.
//
// ISOLATION: pglite NIE mit einem Server-Spawn in einer Datei (P3/P6a-Lehre) - hier nur pglite.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { makePgStore, BOOTSTRAP_TENANT_ID } from "../src/store/pg.js";
import { makeDefaultState, createCall, markBilled } from "../src/store/state-ops.js";

// Baut auf einer BESTEHENDEN pglite-Instanz einen frischen Store (re-hydriert den Spiegel
// aus der DB) -> simuliert den Prozess-Restart zwischen Abrechnung und Retry (Muster
// f2-p9-dedup-persist.test.js).
async function reopen(db) {
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return store;
}

const outboundCall = () => ({
  direction: "outbound",
  from: "+491700000000",
  to: "+491701111111",
  tenantId: BOOTSTRAP_TENANT_ID,
});

// A) Reine State-Op-Idempotenz: erster Aufruf setzt (changed=true), jeder weitere ist ein
// No-op (changed=false) -> der zuerst gesetzte Zeitstempel bleibt stabil (kein Doppel-Schreiben).
test("markBilled ist idempotent: gesetzter Marker gewinnt, kein zweites Schreiben", () => {
  const s = makeDefaultState();
  const c = createCall(s, outboundCall());
  assert.equal(c.billedAt, null, "frischer Call ist ungebucht");

  const first = markBilled(s, c.id);
  assert.equal(first.changed, true, "erstes Buchen aendert den Record");
  const stamp = first.call.billedAt;
  assert.ok(
    typeof stamp === "string" && !Number.isNaN(Date.parse(stamp)),
    "Marker ist eine ISO-Zeit",
  );

  const second = markBilled(s, c.id);
  assert.equal(second.changed, false, "zweites Buchen ist ein No-op (kein Wrapper-save)");
  assert.equal(second.call.billedAt, stamp, "Zeitstempel unveraendert (gesetzter gewinnt)");
});

// Fehlender Call -> kein Throw, changed=false (Muster markSummarySmsSent): ein verspaeteter
// Retry fuer einen inzwischen unbekannten Call darf den Marker-Setter nicht crashen.
test("markBilled fuer unbekannten Call: changed=false, kein Throw", () => {
  const s = makeDefaultState();
  const res = markBilled(s, "call_does_not_exist");
  assert.equal(res.changed, false);
  assert.equal(res.call, null);
});

// B) Persistenz (pg): der Marker lebt am Store-Call-Record, nicht nur in der Laufzeit-
// Variable. Buchen -> flush -> NEUER Store aus derselben DB -> Marker da (der EINE
// prozessuebergreifende Idempotenz-Weg, da call._finished im pg-Backend nie persistiert).
test("billedAt round-trippt durch flush/hydrate (pg): ueberlebt den Restart", async () => {
  const db = new PGlite();
  const store = await reopen(db);
  const c = store.createCall(outboundCall());
  assert.equal(store.getCall(c.id).billedAt, null, "frischer Call ist ungebucht");

  store.markBilled(c.id);
  await store.save();

  const reopened = await reopen(db);
  const billedAt = reopened.getCall(c.id).billedAt;
  assert.ok(
    typeof billedAt === "string" && !Number.isNaN(Date.parse(billedAt)),
    "Bucht-Marker ist eine persistierte ISO-Zeit",
  );
});
