import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let makePgStore, PGlite, jsonStore, BOOTSTRAP, dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-pg-json-parity-"));
  process.env.DATA_DIR = dataDir;
  await import("../src/config.js");
  ({ makePgStore } = await import("../src/store/pg.js"));
  ({ PGlite } = await import("@electric-sql/pglite"));
  jsonStore = await import("../src/store/json.js");
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

async function pgObjectiveRoundtrip(value) {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  store.getCall(created.id).objectiveAchieved = value;
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  return reopened.getCall(created.id).objectiveAchieved;
}

function jsonObjectiveRoundtrip(value) {
  const created = jsonStore.createCall(newCall());
  jsonStore.getCall(created.id).objectiveAchieved = value;
  jsonStore.save();
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  return onDisk.calls.find((c) => c.id === created.id).objectiveAchieved;
}

const OBJECTIVE_ACHIEVED_CASES = [
  ["true", true],
  ["false", false],
  ["'unclear'", "unclear"],
  ["null", null],
];

for (const [label, value] of OBJECTIVE_ACHIEVED_CASES) {
  test(`objectiveAchieved=${label}: pg-Roundtrip erhaelt Typ+Wert`, async () => {
    const got = await pgObjectiveRoundtrip(value);
    assert.equal(typeof got, typeof value);
    assert.equal(got, value);
  });

  test(`objectiveAchieved=${label}: json-Roundtrip erhaelt Typ+Wert (Disk)`, () => {
    const got = jsonObjectiveRoundtrip(value);
    assert.equal(typeof got, typeof value);
    assert.equal(got, value);
  });

  test(`objectiveAchieved=${label}: pg-Ergebnis == json-Ergebnis (Paritaet)`, async () => {
    const pgResult = await pgObjectiveRoundtrip(value);
    const jsonResult = jsonObjectiveRoundtrip(value);
    assert.deepStrictEqual(pgResult, jsonResult);
  });
}

const SHA256_HEX_LAENGE = 64;
const FIXTURE_FAKTEN = 2;
const OPENING_LINE_FIXTURE = "Ich rufe an, um einen Termin zur Bremsenprüfung zu vereinbaren.";
const LOOKUP_QUERY_FIXTURE = "opening hours Grove Street Auto Repair Portland";

async function pgOpeningLookupRoundtrip() {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall({ openingLine: OPENING_LINE_FIXTURE }));
  const seq = store.recordCallLookup(created.id, LOOKUP_QUERY_FIXTURE);
  store.finishCallLookup(created.id, seq, { ok: true, factCount: FIXTURE_FAKTEN, dauerMs: 812 });
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  const call = reopened.getCall(created.id);
  return {
    openingLine: call.openingLine,
    openingLineSha256: call.openingLineSha256,
    lookupLog: call.lookupLog,
  };
}

function jsonOpeningLookupRoundtrip() {
  const created = jsonStore.createCall(newCall({ openingLine: OPENING_LINE_FIXTURE }));
  const seq = jsonStore.recordCallLookup(created.id, LOOKUP_QUERY_FIXTURE);
  jsonStore.finishCallLookup(created.id, seq, { ok: true, factCount: FIXTURE_FAKTEN, dauerMs: 812 });
  jsonStore.save();
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const call = onDisk.calls.find((eintrag) => eintrag.id === created.id);
  return {
    openingLine: call.openingLine,
    openingLineSha256: call.openingLineSha256,
    lookupLog: call.lookupLog,
  };
}

test("openingLine/Hash/lookupLog: pg-Roundtrip erhaelt alle drei (inkl. Umlaute)", async () => {
  const got = await pgOpeningLookupRoundtrip();
  assert.equal(got.openingLine, OPENING_LINE_FIXTURE);
  assert.equal(typeof got.openingLineSha256, "string");
  assert.equal(got.openingLineSha256.length, SHA256_HEX_LAENGE);
  assert.equal(got.lookupLog.length, 1);
  assert.deepEqual(got.lookupLog[0].query, LOOKUP_QUERY_FIXTURE);
  assert.equal(got.lookupLog[0].ok, true);
  assert.equal(got.lookupLog[0].factCount, FIXTURE_FAKTEN);
});

test("openingLine/Hash/lookupLog: pg-Ergebnis == json-Ergebnis (Paritaet)", async () => {
  const pgResult = await pgOpeningLookupRoundtrip();
  const jsonResult = jsonOpeningLookupRoundtrip();
  for (const seite of [pgResult, jsonResult]) {
    assert.ok(typeof seite.lookupLog[0].askedAt === "string" && seite.lookupLog[0].askedAt);
    delete seite.lookupLog[0].askedAt;
  }
  assert.deepStrictEqual(pgResult, jsonResult);
});

const COST_PROFILE_FIXTURE = "el_convai_sip";

async function pgCostProfileRoundtrip() {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  store.recordCostProfile(created.id, COST_PROFILE_FIXTURE);
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  return reopened.getCall(created.id).costProfile;
}

function jsonCostProfileRoundtrip() {
  const created = jsonStore.createCall(newCall());
  jsonStore.recordCostProfile(created.id, COST_PROFILE_FIXTURE);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  return onDisk.calls.find((eintrag) => eintrag.id === created.id).costProfile;
}

test("costProfile: pg-Roundtrip erhaelt den Wert", async () => {
  assert.equal(await pgCostProfileRoundtrip(), COST_PROFILE_FIXTURE);
});

test("costProfile: json-Roundtrip erhaelt den Wert (Disk)", () => {
  assert.equal(jsonCostProfileRoundtrip(), COST_PROFILE_FIXTURE);
});

test("costProfile: eine Altzeile ohne das Feld hydriert auf null (BEIDE Backends)", async () => {
  const { store } = await makePgTestStore();
  const pgCreated = store.createCall(newCall());
  assert.equal(store.getCall(pgCreated.id).costProfile, null, "pg: nie gesetzt -> null");

  const jsonCreated = jsonStore.createCall(newCall());
  assert.equal(jsonStore.getCall(jsonCreated.id).costProfile, null, "json: nie gesetzt -> null");
});

const EVIDENCE_FIXTURE = Object.freeze({
  traeger: "ai_token",
  reife: "vorlaeufig",
  betragMikroCents: 12_345,
  waehrung: "USD",
  quelle: "kv2_3_test",
  belegRef: "conv_abc123",
  versuche: 2,
  gemessenAt: "2026-08-31T10:00:00.000Z",
  abstandZumGespraechsendeS: 4,
  detail: { llm_price: 0.05, tier: "starter" },
  nachreifbar: false,
});

async function pgCostEvidenceRoundtrip() {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  store.recordCallCostEvidence({ callId: created.id, ...EVIDENCE_FIXTURE });
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  return reopened.callCostEvidence(created.id);
}

function jsonCostEvidenceRoundtrip() {
  const created = jsonStore.createCall(newCall());
  jsonStore.recordCallCostEvidence({ callId: created.id, ...EVIDENCE_FIXTURE });
  return jsonStore.callCostEvidence(created.id);
}

function ohneId(zeilen) {
  return zeilen.map(({ id: _id, ...rest }) => rest);
}

test("callCostEvidence: pg-Roundtrip erhaelt die Zeile", async () => {
  const [zeile] = await pgCostEvidenceRoundtrip();
  assert.ok(zeile, "Zeile vorhanden");
  for (const [feld, wert] of Object.entries(EVIDENCE_FIXTURE)) {
    if (feld === "detail") {
      assert.deepStrictEqual(zeile.detail, EVIDENCE_FIXTURE.detail);
      continue;
    }
    assert.equal(zeile[feld], wert, `Feld ${feld}`);
  }
});

test("callCostEvidence: json-Roundtrip erhaelt die Zeile (Disk)", () => {
  const [zeile] = jsonCostEvidenceRoundtrip();
  assert.ok(zeile, "Zeile vorhanden");
  for (const [feld, wert] of Object.entries(EVIDENCE_FIXTURE)) {
    if (feld === "detail") {
      assert.deepStrictEqual(zeile.detail, EVIDENCE_FIXTURE.detail);
      continue;
    }
    assert.equal(zeile[feld], wert, `Feld ${feld}`);
  }
});

test("callCostEvidence: pg-Ergebnis == json-Ergebnis (Shape-Paritaet)", async () => {
  const pgResult = ohneId(await pgCostEvidenceRoundtrip());
  const jsonResult = ohneId(jsonCostEvidenceRoundtrip());
  for (const seite of [pgResult, jsonResult]) {
    delete seite[0].tenantId;
    delete seite[0].callId;
  }
  assert.deepStrictEqual(pgResult, jsonResult);
});

test("callCostEvidence: NULL-Felder hydrieren auf null, nie auf undefined (BEIDE Backends)", async () => {
  const { store } = await makePgTestStore();
  const pgCreated = store.createCall(newCall());
  store.recordCallCostEvidence({ callId: pgCreated.id, traeger: "ai_token", reife: "erwartet" });
  await store.save();
  const [pgZeile] = store.callCostEvidence(pgCreated.id);
  for (const feld of [
    "betragMikroCents",
    "waehrung",
    "quelle",
    "belegRef",
    "gemessenAt",
    "abstandZumGespraechsendeS",
    "detail",
  ]) {
    assert.equal(pgZeile[feld], null, `pg: ${feld} ist null`);
  }
  assert.equal(pgZeile.nachreifbar, true, "pg: Default TRUE, nie null");

  const jsonCreated = jsonStore.createCall(newCall());
  jsonStore.recordCallCostEvidence({
    callId: jsonCreated.id,
    traeger: "ai_token",
    reife: "erwartet",
  });
  const [jsonZeile] = jsonStore.callCostEvidence(jsonCreated.id);
  for (const feld of [
    "betragMikroCents",
    "waehrung",
    "quelle",
    "belegRef",
    "gemessenAt",
    "abstandZumGespraechsendeS",
    "detail",
  ]) {
    assert.equal(jsonZeile[feld], null, `json: ${feld} ist null`);
  }
  assert.equal(jsonZeile.nachreifbar, true, "json: Default TRUE, nie null");
});

