// AL-P1 (Latenz-/Abbruch-Achse): Persistenz-Round-Trip von telnyxConversationId
// (Latenz-Achse) und callerTurns (Abbruch-Achse) in BEIDEN Backends. Kern-Risiko (Lehre
// I8): ohne Spalte + flush-ON-CONFLICT-DO-UPDATE-SET UND rowToCall-Hydrierung gingen die
// Werte beim Restart verloren - und der naechste Flush wuerde sie ueberschreiben.
// Muster test/assistant-context-persist-pg.test.js (pglite + json in-process, dynamische
// Imports NACH DATA_DIR-Bindung) UND test/store-json-migrate-shapes.test.js (cache-
// buster-Reimport von json.js fuer den Legacy-Migrationsfall).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDataDir } from "./helpers.js";

let makePgStore, PGlite, jsonStore, views, config, BOOTSTRAP, dataDir;
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-al-p1-store-"));
  process.env.DATA_DIR = dataDir;
  ({ config } = await import("../src/config.js"));
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  jsonStore = await import("../src/store/json.js");
  views = await import("../src/store/views.js");
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../src/store/defaults.js"));
});

async function makePgTestStore() {
  const db = new PGlite();
  const runner = {
    withClient: (fn) => fn({ query: (t, p) => db.query(t, p), exec: (sql) => db.exec(sql) }),
  };
  const store = makePgStore(runner);
  await store.init();
  return { store, runner };
}

const newCall = (over = {}) => ({
  direction: "outbound",
  from: "+49",
  to: "+49",
  tenantId: BOOTSTRAP,
  ...over,
});

test("AL-P1-1: callerTurns round-trippt ueber Re-Hydrierung (Spalte + flush + rowToCall)", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  store.countCallerTurn(created.id);
  store.countCallerTurn(created.id);
  store.countCallerTurn(created.id);
  assert.equal(store.getCall(created.id).callerTurns, 3, "im Spiegel sofort sichtbar");
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(
    reopened.getCall(created.id).callerTurns,
    3,
    "callerTurns ueberlebt den Reopen (Spalte + ON CONFLICT DO UPDATE SET + rowToCall)",
  );
});

test("AL-P1-2: telnyxConversationId round-trippt (Altbestand-Spalte)", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  // Der Schreibweg (recordTelnyxConversationId) ist mit IE6-S1 entfernt - die Spalte
  // selbst bleibt Altbestand (Daten, NICHT-Scope). Wert direkt am Spiegel gesetzt.
  store.getCall(created.id).telnyxConversationId = "conv-first";
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(
    reopened.getCall(created.id).telnyxConversationId,
    "conv-first",
    "telnyxConversationId ueberlebt den Reopen",
  );
});

let migrateSeq = 0;
// Muster store-json-migrate-shapes.test.js: config.server.dataDir mutieren + json.js mit
// Cache-Buster neu importieren, damit dieser Testfall ein EIGENES store.json ohne die
// neuen Felder lesen kann (das im before() gebundene json.js haelt sein FILE/state bereits
// auf dataDir fest).
async function loadLegacyStore(raw) {
  const dir = tempDataDir(raw);
  config.server.dataDir = dir;
  const mod = await import(`../src/store/json.js?al-p1-store-fields=${migrateSeq++}`);
  return mod.load();
}

test("AL-P1-3: Bestands-Call ohne die Felder -> null/0, nie undefined (idempotente json-Migration)", async () => {
  const raw = {
    tenants: [{ id: BOOTSTRAP, status: "active" }],
    calls: [{ id: "call_legacy", tenantId: BOOTSTRAP, direction: "outbound", transcript: [], actionItemIds: [] }],
  };
  const state = await loadLegacyStore(raw);
  const call = state.calls.find((c) => c.id === "call_legacy");
  assert.equal(call.telnyxConversationId, null, "fehlendes Feld -> null, nie undefined");
  assert.equal(call.callerTurns, 0, "fehlendes Feld -> 0, nie undefined/NaN");
});

test("AL-P1-3b: Migration ist idempotent - bereits gesetzte Werte (auch 0) bleiben unangetastet", async () => {
  const raw = {
    tenants: [{ id: BOOTSTRAP, status: "active" }],
    calls: [
      {
        id: "call_seeded",
        tenantId: BOOTSTRAP,
        direction: "outbound",
        transcript: [],
        actionItemIds: [],
        telnyxConversationId: "conv-seeded",
        callerTurns: 0,
      },
    ],
  };
  const state = await loadLegacyStore(raw);
  const call = state.calls.find((c) => c.id === "call_seeded");
  assert.equal(call.telnyxConversationId, "conv-seeded", "gesetzter Wert bleibt unveraendert");
  assert.equal(call.callerTurns, 0, "gesetzte 0 bleibt 0 (??= ueberschreibt keine 0)");
});

test("AL-P1-4: json-Backend persistiert beide Felder auf Platte (echter Disk-Roundtrip)", () => {
  const created = jsonStore.createCall(newCall());
  jsonStore.getCall(created.id).telnyxConversationId = "conv-json";
  jsonStore.countCallerTurn(created.id);
  jsonStore.countCallerTurn(created.id);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const persisted = onDisk.calls.find((c) => c.id === created.id);
  assert.equal(persisted.telnyxConversationId, "conv-json", "UUID ueberlebt JSON.stringify/parse");
  assert.equal(persisted.callerTurns, 2, "Zaehler ueberlebt JSON.stringify/parse");
});

test("AL-P1-5: publicCall strippt telnyxConversationId und callerTurns", () => {
  const stripped = views.publicCall({
    id: "call_x",
    telnyxConversationId: "conv-should-not-leak",
    callerTurns: 5,
    status: "active",
  });
  assert.equal(stripped.telnyxConversationId, undefined, "telnyxConversationId darf die API nicht verlassen");
  assert.equal(stripped.callerTurns, undefined, "callerTurns darf die API nicht verlassen");
  assert.equal(stripped.status, "active", "unbeteiligte Felder bleiben erhalten");
});
