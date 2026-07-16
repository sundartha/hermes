// P0b - Charakterisierungs-Test fuer POST /api/action-items/:id/toggle (PLAN-SERVER-SLIM,
// Pre-Mortem h): der Endpunkt hatte KEINEN HTTP-Test -> sein Move nach routes/api-tenant-write.js
// (P8) waere nicht byte-beweisbar. Dieser Test PINNT das IST-Verhalten gegen den UNVERAENDERTEN
// src/server.js (reine Test-Phase: server.js bleibt byte-identisch). Spawn (node:test), offline.
// helpers.js bleibt unangetastet - harte Phasen-Abgrenzung.
import test from "node:test";
import assert from "node:assert/strict";
import { startServer, seedState } from "./helpers.js";

// POST /api/action-items/:id/toggle. Kein Body noetig (id kommt aus der URL), 127.0.0.1
// ist isTrustedLocalCaller-exempt -> kein Auth-Header. Liefert die rohe fetch-Response.
const toggle = (srv, id) =>
  fetch(`${srv.localUrl}/api/action-items/${id}/toggle`, { method: "POST" });

// Kanonische Item-Form (wie addActionItem in state-ops.js): genau diese sechs Felder
// bilden den 200-Body -> EINE Quelle (G5), aus der beide Assertions abgeleitet werden.
// done:false gewaehlt, damit runRetention (RETENTION_DAYS=0, keepActionItem = !done || ...)
// das Item am Boot garantiert behaelt.
const ITEM = Object.freeze({
  id: "ai_test1",
  callId: "call_test1",
  text: "Rueckruf vereinbaren",
  type: "todo",
  done: false,
  createdAt: "2026-07-16T10:00:00.000Z",
});

// (A) Fehlende/unbekannte id -> 404 mit exaktem Body.
test("fehlende id: POST /api/action-items/:id/toggle -> 404 {error:'not found'}", async () => {
  const srv = await startServer(); // Default-Store: actionItems=[]
  try {
    const res = await toggle(srv, "ai_missing");
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "not found" });
  } finally {
    await srv.stop();
  }
});

// (B) Vorhandenes Item -> 200 mit gekipptem done; store.save persistiert; echtes Toggle
// (zweiter Aufruf kippt zurueck, kein "mark done"). Der 200-Body-Shape ist damit fuer den
// P8-Move gepinnt.
test("vorhandenes Item: POST toggle -> 200 mit getoggeltem Item, persistiert, kippt zurueck", async () => {
  const srv = await startServer({ seed: seedState({ actionItems: [{ ...ITEM }] }) });
  try {
    const res = await toggle(srv, ITEM.id);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ...ITEM, done: true }); // Shape + gekipptes done

    const stored = srv.readStore().actionItems.find((a) => a.id === ITEM.id);
    assert.equal(stored.done, true, "store.save-Seiteneffekt: neuer done-Wert auf Platte");

    const res2 = await toggle(srv, ITEM.id);
    assert.equal(res2.status, 200);
    assert.deepEqual(await res2.json(), { ...ITEM, done: false }); // echtes Toggle zurueck
  } finally {
    await srv.stop();
  }
});
