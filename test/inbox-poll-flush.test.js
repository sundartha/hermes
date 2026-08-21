// INBOX-P2 (R-3), Ebene A: die Route ISOLIERT (Attrappen-Store, Muster
// test/api-read-parity.test.js) - beweist den Vertrag "der Handler ruft store.save()
// nie selbst" und die Optionen-Durchreichung (limit/includeSeen).
//
// Ebene B (echtes json-Backend, save()-Zaehler - die eigentliche R-3-Abnahme) lebt
// BEWUSST in einer eigenen Datei (test/inbox-poll-flush-disk.test.js), NICHT hier:
// dieses File importiert src/routes/api-inbox.js statisch, und dessen Kette
// (api-inbox.js -> wiring/internal-only.js -> routes/_tenant.js) importiert
// src/config.js TRANSITIV am Datei-Kopf - also BEVOR irgendein before()-Hook
// DATA_DIR setzen koennte. src/store/json.js bindet FILE aber genau einmal, beim
// ERSTEN Import von config.js, an config.server.dataDir (Bestandspraezedenz
// test/store-integrity.test.js). In EINER gemeinsamen Datei haette Ebene B damit
// gegen das ECHTE, ungeseedete data/store.json des Projekts geschrieben statt gegen
// ein Temp-Verzeichnis - genau die Verletzung, die die Testkonvention ("data/store.json
// wird nie angefasst") verbietet. Empirisch bestaetigt (Dry-Run waehrend der
// Entwicklung dieser Etappe: data/store.json trug danach doppelte call_flush_1-
// Eintraege). Die Trennung in zwei Dateien ist der Fix, keine Kosmetik.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { makeInboxRoutes, INBOX_MAX_ENTRIES } from "../src/routes/api-inbox.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const TENANT = BOOTSTRAP_TENANT_ID;
const A5_POLL_COUNT = 3; // include_seen=true, ohne Body, include_seen="true" (String)

function makeMockStore(result) {
  const saves = [];
  const pollCalls = [];
  return {
    saves,
    pollCalls,
    save: () => saves.push(1),
    takeInboxEntries: (tenantId, options) => {
      pollCalls.push({ tenantId, options });
      return result;
    },
  };
}

function makeAllowTenant() {
  return { requireTenant: () => TENANT };
}

function makeRejectTenant() {
  return {
    requireTenant: (req, res) => {
      res.status(HTTP_FORBIDDEN).json({ error: "tenant" });
      return null;
    },
  };
}

async function mount(store, tenant) {
  const audits = [];
  const app = express();
  app.use(express.json());
  app.use(makeInboxRoutes({ store, audit: (...args) => audits.push(args), tenant }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, audits, stop: () => new Promise((resolve) => server.close(resolve)) };
}

test("INBOX-P2 A1: Leer-Poll ruft store.save() nicht auf", async () => {
  const store = makeMockStore({ entries: [], remaining: 0, marked: 0 });
  const srv = await mount(store, makeAllowTenant());
  try {
    const res = await fetch(`${srv.base}/api/inbox/poll`, { method: "POST" });
    assert.equal(res.status, HTTP_OK);
    assert.equal(store.saves.length, 0);
  } finally {
    await srv.stop();
  }
});

test("INBOX-P2 A2: Poll mit Eintrag (marked:1) ruft store.save() TROTZDEM nicht auf (kein Doppel-Flush)", async () => {
  const store = makeMockStore({
    entries: [{ call_id: "call_x" }],
    remaining: 0,
    marked: 1,
  });
  const srv = await mount(store, makeAllowTenant());
  try {
    const res = await fetch(`${srv.base}/api/inbox/poll`, { method: "POST" });
    assert.equal(res.status, HTTP_OK);
    assert.equal(store.saves.length, 0);
  } finally {
    await srv.stop();
  }
});

test("INBOX-P2 A3: Audit-Form ist ausschliesslich Zaehler", async () => {
  const store = makeMockStore({ entries: [{ call_id: "call_x" }], remaining: 2, marked: 1 });
  const srv = await mount(store, makeAllowTenant());
  try {
    await fetch(`${srv.base}/api/inbox/poll`, { method: "POST" });
    assert.equal(srv.audits.length, 1);
    const [action, , detail] = srv.audits[0];
    assert.equal(action, "inbox_poll");
    assert.match(detail, /^neu=\d+ rest=\d+$/);
    assert.ok(!/\d{6,}/.test(detail), "Audit-Detail darf keine E.164-artige Ziffernfolge tragen");
  } finally {
    await srv.stop();
  }
});

test("INBOX-P2 A4: requireTenant-Ablehnung -> 403, takeInboxEntries wird NIE gerufen", async () => {
  const store = makeMockStore({ entries: [], remaining: 0, marked: 0 });
  const srv = await mount(store, makeRejectTenant());
  try {
    const res = await fetch(`${srv.base}/api/inbox/poll`, { method: "POST" });
    assert.equal(res.status, HTTP_FORBIDDEN);
    assert.equal(store.pollCalls.length, 0);
  } finally {
    await srv.stop();
  }
});

test("INBOX-P2 A5: include_seen wird fail-closed durchgereicht", async () => {
  const store = makeMockStore({ entries: [], remaining: 0, marked: 0 });
  const srv = await mount(store, makeAllowTenant());
  try {
    await fetch(`${srv.base}/api/inbox/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ include_seen: true }),
    });
    await fetch(`${srv.base}/api/inbox/poll`, { method: "POST" });
    await fetch(`${srv.base}/api/inbox/poll`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ include_seen: "true" }),
    });
    assert.equal(store.pollCalls.length, A5_POLL_COUNT);
    assert.deepEqual(store.pollCalls[0].options, { limit: INBOX_MAX_ENTRIES, includeSeen: true });
    assert.deepEqual(store.pollCalls[1].options, { limit: INBOX_MAX_ENTRIES, includeSeen: false });
    assert.deepEqual(store.pollCalls[2].options, { limit: INBOX_MAX_ENTRIES, includeSeen: false });
  } finally {
    await srv.stop();
  }
});
