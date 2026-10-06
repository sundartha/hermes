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
  assert.equal(hydrated.estimatedCostSpendMonthKey, null);
  assert.equal(hydrated.estimatedCostPeriodKey, null);
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
  });
  fs.writeFileSync(rawPath, JSON.stringify(raw, null, 2));
  const freshJsonStore = await import(`../src/store/json.js?altshape-${Date.now()}`);
  const hydrated = freshJsonStore.load().calls.find((c) => c.id === legacyId);
  assert.ok(hydrated, "Alt-Call muss geladen werden");
  assert.equal(hydrated.estimatedCostCents, null);
  assert.equal(hydrated.actualCostMicroCents, null);
  assert.equal(hydrated.costTruedAt, null);
  assert.equal(hydrated.costTruedSource, null);
  assert.equal(hydrated.costTruingAttempts, 0);
  assert.equal(hydrated.estimatedCostSpendMonthKey, null);
  assert.equal(hydrated.estimatedCostPeriodKey, null);
  assert.ok(!Number.isNaN(hydrated.costTruingAttempts + 1), "P3 rechnet +1 - darf nie NaN werden");
});

test("C1 (pg): costTruedSource + costTruingAttempts gesetzt NACH Create ueberleben einen zweiten Flush", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  await store.save();

  const mirrored = store.getCall(created.id);
  mirrored.costTruedSource = "incomplete";
  mirrored.costTruingAttempts = 3;
  assert.equal(store.getCall(created.id).costTruedSource, "incomplete", "Zwischenbeleg vor Flush 2");
  assert.equal(store.getCall(created.id).costTruingAttempts, 3, "Zwischenbeleg vor Flush 2");

  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  const hydrated = reopened.getCall(created.id);
  assert.equal(hydrated.costTruedSource, "incomplete", "Mutation nach Create muss den 2. Flush ueberleben");
  assert.equal(hydrated.costTruingAttempts, 3, "Mutation nach Create muss den 2. Flush ueberleben");
});

test("D1 (pg): migrate() zweimal auf derselben DB -> kein Throw, geschriebene Zeile bleibt unveraendert", async () => {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  created.actualCostMicroCents = 777;
  await store.save();

  await assert.doesNotReject(async () => {
    const second = makePgStore(runner);
    await second.init();
  });

  const reopened = makePgStore(runner);
  await reopened.init();
  assert.equal(reopened.getCall(created.id).actualCostMicroCents, 777, "Zeile bleibt nach doppeltem migrate() unveraendert");
});

test("E1: reconcileVoiceBudget bucht + persistiert denselben Estimate-Wert, stabil gegen spaeteren Tarifwechsel", async () => {
  const { withConfig } = makeConfigOverrides(config);
  const tenantId = BOOTSTRAP;
  const created = jsonStore.createCall(
    newCall({ tenantId, to: "+49123456", direction: "outbound" }),
  );
  const mirrored = jsonStore.load().calls.find((c) => c.id === created.id);
  mirrored.answeredAt = "2026-07-20T10:00:00.000Z";
  mirrored.endedAt = "2026-07-20T10:03:00.000Z";

  await withConfig("voiceTariffDomesticCents", 6, async () => {
    const metering = makeMetering({ store: jsonStore, config });
    const costCentsBeforeFirst = jsonStore.usageOf(tenantId).costCents;
    metering.reconcileVoiceBudget(mirrored);
    const costCentsAfterFirst = jsonStore.usageOf(tenantId).costCents;
    assert.equal(costCentsAfterFirst - costCentsBeforeFirst, 18, "3 Minuten * 6 Cent/min = 18 Cent gebucht");
    const persisted = jsonStore.getCall(created.id);
    assert.equal(persisted.estimatedCostCents, 18, "derselbe Betrag wird am Call persistiert");
    const bucket = jsonStore.usageOf(tenantId);
    assert.equal(persisted.estimatedCostSpendMonthKey, bucket.spendMonthKey, "Anker = Monatsstempel NACH der Buchung");
    assert.equal(persisted.estimatedCostPeriodKey, bucket.budgetPeriodKey, "Anker = Perioden-Stempel NACH der Buchung");

    const costCentsBeforeSecond = jsonStore.usageOf(tenantId).costCents;
    metering.reconcileVoiceBudget(mirrored);
    assert.equal(jsonStore.getCall(created.id).estimatedCostCents, 18, "set-once: Estimate bleibt 18");
    assert.equal(
      jsonStore.usageOf(tenantId).costCents,
      costCentsBeforeSecond + 18,
      "zweiter Call bucht trotzdem (kein Doppel-Estimate-Gate auf der Buchung)",
    );
  });

  await withConfig("voiceTariffDomesticCents", 25, async () => {
    const stillPersisted = jsonStore.getCall(created.id);
    assert.equal(stillPersisted.estimatedCostCents, 18, "Estimate bleibt stabil gegen spaeteren Tarifwechsel");
  });
});
