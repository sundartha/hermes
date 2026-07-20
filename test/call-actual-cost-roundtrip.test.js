// LCT P2 (Ist-Kosten am Call persistieren, additiv/inert): Rundlauf-Beweis ueber BEIDE
// Backends fuer die fuenf Kosten-Felder (estimatedCostCents, actualCostMicroCents,
// costTruedAt, costTruedSource, costTruingAttempts). pglite + json IN-PROCESS, KEIN
// Server-Spawn (p6a-Regel; Muster test/assistant-context-persist-pg.test.js).
//
// DATA_DIR + config werden VOR allen store-Imports gebunden (json.FILE haengt an
// config.dataDir): darum laeuft die Verdrahtung ueber dynamische Imports in before(),
// NICHT ueber statische Imports (sonst bindet config.dataDir an das echte data/-Verzeichnis).
import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let makePgStore,
  PGlite,
  jsonStore,
  BOOTSTRAP,
  dataDir,
  makeMetering,
  config,
  makeConfigOverrides;
before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-cost-roundtrip-"));
  process.env.DATA_DIR = dataDir;
  ({ config } = await import("../src/config.js"));
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  jsonStore = await import("../src/store/json.js");
  ({ BOOTSTRAP_TENANT_ID: BOOTSTRAP } = await import("../src/store/defaults.js"));
  ({ makeMetering } = await import("../src/billing/metering.js"));
  ({ makeConfigOverrides } = await import("./helpers.js"));
});

// pglite-Store hinter dem Runner-Vertrag (Muster assistant-context-persist-pg.test.js).
// Liefert {store, runner} fuer den Reopen.
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

// ---- (a) Rundlauf 51300 ueber BEIDE Backends ----

test("A1 (pg): actualCostMicroCents=51300 ueberlebt Flush+Reopen als NUMBER (kein BIGINT-String)", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  created.actualCostMicroCents = 51300;
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  const hydrated = reopened.getCall(created.id);
  assert.equal(hydrated.actualCostMicroCents, 51300);
  assert.equal(typeof hydrated.actualCostMicroCents, "number", "BIGINT darf nicht als String hydrieren");
});

test("A2 (json): actualCostMicroCents=51300 ueberlebt load() auf frischem Modulzustand", () => {
  const created = jsonStore.createCall(newCall());
  jsonStore.load().calls.find((c) => c.id === created.id).actualCostMicroCents = 51300;
  jsonStore.save();
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const persisted = onDisk.calls.find((c) => c.id === created.id);
  assert.equal(persisted.actualCostMicroCents, 51300);
});

// ---- (b) Fehlende Felder -> null bzw. 0, kein NaN ----

test("B1 (pg): Call ohne Kosten-Felder -> null/0 nach Flush+Reopen, kein NaN", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  const hydrated = reopened.getCall(created.id);
  assert.equal(hydrated.estimatedCostCents, null);
  assert.equal(hydrated.actualCostMicroCents, null);
  assert.equal(hydrated.costTruedAt, null);
  assert.equal(hydrated.costTruedSource, null);
  assert.equal(hydrated.costTruingAttempts, 0);
  assert.ok(!Number.isNaN(hydrated.estimatedCostCents));
  assert.ok(!Number.isNaN(hydrated.actualCostMicroCents));
});

test("B2 (json Alt-Shape): ein von Hand ohne die fuenf Felder geschriebener Call hydriert nach load() zu null/0", async () => {
  const rawPath = path.join(dataDir, "store.json");
  const raw = JSON.parse(fs.readFileSync(rawPath, "utf8"));
  const legacyId = "call_legacy_altshape";
  raw.calls.push({
    id: legacyId,
    tenantId: BOOTSTRAP,
    direction: "outbound",
    from: "+49",
    to: "+49",
    status: "completed",
    startedAt: new Date().toISOString(),
    transcript: [],
    actionItemIds: [],
    // BEWUSST: keine estimatedCostCents/actualCostMicroCents/costTruedAt/
    // costTruedSource/costTruingAttempts-Felder (Alt-Bestand vor P2).
  });
  fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));
  // Modul-Cache-Reset: jsonStore.load() haelt den Zustand modul-lokal im Speicher
  // (state-Singleton) - ein frischer dynamischer Import mit Query-String zwingt einen
  // echten Re-Read von der Platte.
  const freshJsonStore = await import(`../src/store/json.js?altshape-${Date.now()}`);
  const hydrated = freshJsonStore.load().calls.find((c) => c.id === legacyId);
  assert.ok(hydrated, "Alt-Call muss geladen werden");
  assert.equal(hydrated.estimatedCostCents, null);
  assert.equal(hydrated.actualCostMicroCents, null);
  assert.equal(hydrated.costTruedAt, null);
  assert.equal(hydrated.costTruedSource, null);
  assert.equal(hydrated.costTruingAttempts, 0);
  assert.ok(!Number.isNaN(hydrated.costTruingAttempts + 1), "P3 rechnet +1 - darf nie NaN werden");
});

// ---- (c) Mutation nach Create ueberlebt den zweiten Flush (ON CONFLICT DO UPDATE SET) ----

test("C1 (pg): costTruedSource + costTruingAttempts gesetzt NACH Create ueberleben einen zweiten Flush", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  await store.save();

  const mirrored = store.getCall(created.id);
  mirrored.costTruedSource = "incomplete";
  mirrored.costTruingAttempts = 3;
  // Zwischenbeleg: die Mutation steht VOR Flush 2 bereits im Spiegel (sonst testet
  // dieser Fall nur die Spalten-Existenz, nicht den UPDATE-SET-Drift).
  assert.equal(store.getCall(created.id).costTruedSource, "incomplete", "Zwischenbeleg vor Flush 2");
  assert.equal(store.getCall(created.id).costTruingAttempts, 3, "Zwischenbeleg vor Flush 2");

  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  const hydrated = reopened.getCall(created.id);
  assert.equal(hydrated.costTruedSource, "incomplete", "Mutation nach Create muss den 2. Flush ueberleben");
  assert.equal(hydrated.costTruingAttempts, 3, "Mutation nach Create muss den 2. Flush ueberleben");
});

// ---- (d) migrate() zweimal auf derselben pglite-DB (Idempotenz) ----

test("D1 (pg): migrate() zweimal auf derselben DB -> kein Throw, geschriebene Zeile bleibt unveraendert", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  created.actualCostMicroCents = 777;
  await store.save();

  // Zweiter init() auf demselben Runner faehrt migrate() (ALTER TABLE ADD COLUMN IF NOT
  // EXISTS) ein zweites Mal auf derselben DB.
  await assert.doesNotReject(async () => {
    const second = makePgStore(runner);
    await second.init();
  });

  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(reopened.getCall(created.id).actualCostMicroCents, 777, "Zeile bleibt nach doppeltem migrate() unveraendert");
});

// ---- (e) Estimate == gebuchter Betrag, stabil gegen Tarifwechsel (E2/E3/E4) ----

test("E1: reconcileOutboundVoiceBudget bucht + persistiert denselben Estimate-Wert, stabil gegen spaeteren Tarifwechsel", async () => {
  const { withConfig } = makeConfigOverrides(config);
  const tenantId = BOOTSTRAP;
  const created = jsonStore.createCall(
    newCall({ tenantId, to: "+49123456", direction: "outbound" }),
  );
  const mirrored = jsonStore.load().calls.find((c) => c.id === created.id);
  mirrored.answeredAt = "2026-07-20T10:00:00.000Z";
  mirrored.endedAt = "2026-07-20T10:03:00.000Z"; // 3 Minuten

  await withConfig("voiceTariffDomesticCents", 6, async () => {
    const metering = makeMetering({ store: jsonStore, config });
    const costCentsBeforeFirst = jsonStore.usageOf(tenantId).costCents;
    metering.reconcileOutboundVoiceBudget(mirrored);
    const costCentsAfterFirst = jsonStore.usageOf(tenantId).costCents;
    assert.equal(costCentsAfterFirst - costCentsBeforeFirst, 18, "3 Minuten * 6 Cent/min = 18 Cent gebucht");
    const persisted = jsonStore.getCall(created.id);
    assert.equal(persisted.estimatedCostCents, 18, "derselbe Betrag wird am Call persistiert");

    // Set-once (E3): ein zweiter Aufruf auf demselben Call darf den Estimate NICHT
    // erneut buchen/ueberschreiben.
    const costCentsBeforeSecond = jsonStore.usageOf(tenantId).costCents;
    metering.reconcileOutboundVoiceBudget(mirrored);
    assert.equal(jsonStore.getCall(created.id).estimatedCostCents, 18, "set-once: Estimate bleibt 18");
    assert.equal(
      jsonStore.usageOf(tenantId).costCents,
      costCentsBeforeSecond + 18,
      "zweiter Call bucht trotzdem (kein Doppel-Estimate-Gate auf der Buchung)",
    );
  });

  // Tarifwechsel NACH der Buchung: der persistierte Estimate darf sich NICHT aendern
  // (Kapitel 4 des Plans - sonst rekonstruiert P4 gegen den falschen Tarif).
  await withConfig("voiceTariffDomesticCents", 25, async () => {
    const stillPersisted = jsonStore.getCall(created.id);
    assert.equal(stillPersisted.estimatedCostCents, 18, "Estimate bleibt stabil gegen spaeteren Tarifwechsel");
  });
});
