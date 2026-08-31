// P2 (C2, S1-3): pg/json-Paritaet fuer objectiveAchieved (Boolean-Serialisierungs-Drift).
// src/store/pg.js serialisiert objectiveAchieved (Boolean|String|null) beim Flush als
// TEXT (serializeObjective), las aber bis zu diesem Fix OHNE Rueck-Coercion
// (rowToCall) - ein Boolean wurde nach jedem pg-Neustart zur STRING. json speichert
// nativ (kein Drift) -> der Bug war im lokalen json-Dev strukturell unsichtbar. Dieser
// table-driven Rundlauf laeuft gegen BEIDE Backends, damit ein kuenftiger Typ-Drift
// laut wird statt still zu bleiben (Meta-Lehre, PLAN-FRAGILITY-REMEDIATION.md #2).
//
// Erweitern bei jeder neuen pg-Spalte mit nicht-trivialer Typabbildung (analog
// config-money-manifest.test.js): OBJECTIVE_ACHIEVED_CASES um einen Eintrag ergaenzen.
//
// DATA_DIR + config werden VOR allen store-Imports gebunden (json.FILE haengt an
// config.dataDir): darum laeuft die Verdrahtung ueber dynamische Imports in before()
// (Muster: test/assistant-context-persist-pg.test.js).
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

// pglite-Store hinter dem Runner-Vertrag (wie pg-helpers.js, hier inline wegen der
// DATA_DIR-Bindungsreihenfolge). Liefert {store, runner} fuer den Reopen.
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

// Ein voller pg-Rundlauf fuer EINEN objectiveAchieved-Wert: create -> mutate-then-save
// -> echter Reopen (frischer makePgStore auf derselben pglite-Instanz) -> Rueckgabe des
// hydrierten Werts. EINE Stelle fuer den Rundlauf (G5), von zwei Tests genutzt.
async function pgObjectiveRoundtrip(value) {
  const { store, runner } = await makePgTestStore();
  const created = store.createCall(newCall());
  store.getCall(created.id).objectiveAchieved = value;
  await store.save();
  const reopened = makePgStore(runner);
  await reopened.init();
  return reopened.getCall(created.id).objectiveAchieved;
}

// Ein voller json-Rundlauf fuer EINEN objectiveAchieved-Wert: create -> mutate-then-save
// -> echter Disk-Read (JSON.parse(fs.readFileSync)). EINE Stelle (G5), von zwei Tests
// genutzt. json ist ein Modul-Singleton (state lebt ueber die ganze Testdatei) - jeder
// Aufruf erzeugt einen frischen Call (eigene id), keine Kollision zwischen Tests.
function jsonObjectiveRoundtrip(value) {
  const created = jsonStore.createCall(newCall());
  jsonStore.getCall(created.id).objectiveAchieved = value;
  jsonStore.save();
  const onDisk = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  return onDisk.calls.find((c) => c.id === created.id).objectiveAchieved;
}

// objectiveAchieved-Werte, die claude.js fachlich setzt (Boolean true/false, der String
// "unclear" bei Mehrdeutigkeit, null wenn noch offen). Der Literal-String "true"/"false"
// ist NIE ein Fachwert (nur eine Serialisierungsform) - siehe deserializeObjective-Kommentar
// in pg.js. typeof null === "object": assert.equal(got, value) mit value=null ist fuer den
// null-Fall trivial wahr; die typeof-Assertion ist dort redundant, aber harmlos.
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
    // Waere vor dem S1-3-Fix im pg-Zweig rot gewesen: pg lieferte "true"/"false"-Strings,
    // json lieferte Booleans -> deepStrictEqual haette den Typ-Drift aufgedeckt.
    const pgResult = await pgObjectiveRoundtrip(value);
    const jsonResult = jsonObjectiveRoundtrip(value);
    assert.deepStrictEqual(pgResult, jsonResult);
  });
}

// GQ-H1-a: dropLastAgentTranscript LIEFERT einen Befund - beide Backends, gleiche Antwort.
// Live am Testanruf call_mshb9v7btbsp aufgefallen: die Entfernung lief, aber die
// discarded_answer-Zeile fehlte, weil beide Wrapper dem fire-and-forget-Muster von
// addTranscript folgten und undefined lieferten. Der Shim verzweigt auf den Rueckgabewert.
// Die Repro-Tests haben es nicht gefangen, weil ihr fakeStore ein Boolean liefert - der
// Fake konnte mehr als der echte Store. Deshalb die Zusicherung hier, an BEIDEN echten
// Backends und an der Stelle, an der Paritaet ohnehin das Thema ist.
async function pgDropBefunde() {
  const { store } = await makePgTestStore();
  const created = store.createCall(newCall());
  const leer = store.dropLastAgentTranscript(created.id);
  store.addTranscript(created.id, "caller", "Fragment");
  const nachCaller = store.dropLastAgentTranscript(created.id);
  store.addTranscript(created.id, "agent", "nie gesprochen");
  const nachAgent = store.dropLastAgentTranscript(created.id);
  return [leer, nachCaller, nachAgent];
}

function jsonDropBefunde() {
  const created = jsonStore.createCall(newCall());
  const leer = jsonStore.dropLastAgentTranscript(created.id);
  jsonStore.addTranscript(created.id, "caller", "Fragment");
  const nachCaller = jsonStore.dropLastAgentTranscript(created.id);
  jsonStore.addTranscript(created.id, "agent", "nie gesprochen");
  const nachAgent = jsonStore.dropLastAgentTranscript(created.id);
  return [leer, nachCaller, nachAgent];
}

test("dropLastAgentTranscript: pg meldet false/false/true (leer, caller-Ende, agent-Ende)", async () => {
  assert.deepEqual(await pgDropBefunde(), [false, false, true]);
});

test("dropLastAgentTranscript: json meldet false/false/true", () => {
  assert.deepEqual(jsonDropBefunde(), [false, false, true]);
});

test("dropLastAgentTranscript: pg-Befunde == json-Befunde (Paritaet)", async () => {
  assert.deepEqual(await pgDropBefunde(), jsonDropBefunde());
});

// ---- Thema A+B (2026-08-19): die drei neuen Call-Spalten ueberleben BEIDE Backends ----
// Review-Befund R3: jedes bisherige additiv-nullable Call-Feld hat einen Persistenz-
// Test; opening_line/opening_line_sha256/lookup_log bekamen keinen. Der Rundlauf hier
// prueft je Backend: create (openingLine via createCall, Hash im Store berechnet) ->
// lookupLog via recordCallLookup/finishCallLookup -> echter Reopen bzw. Disk-Read ->
// Werte identisch. Ohne die pg-Zeilen (Spalte/INSERT/UPDATE-SET/rowToCall) spraeche der
// Boot-Re-Arm eines aktiven EL-Calls den Rueckfall statt der festgelegten Zeile, und
// der Recherche-Deckel zaehlte nach jedem Restart von vorn.
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
  // askedAt entsteht je Lauf neu - fuer die Paritaet zaehlt die FORM, nicht die Uhrzeit.
  for (const seite of [pgResult, jsonResult]) {
    assert.ok(typeof seite.lookupLog[0].askedAt === "string" && seite.lookupLog[0].askedAt);
    delete seite.lookupLog[0].askedAt;
  }
  assert.deepStrictEqual(pgResult, jsonResult);
});

// ---- KV2-2: cost_profile (das an der Engine-Weiche gesetzte Kostenprofil) -------------
// Neuer Spaltentyp (additiv nullable, Muster sipCallId): create -> recordCostProfile ->
// save -> echter Reopen/Disk-Read -> Wert unveraendert. Eine Altzeile ohne das Feld
// hydriert auf null, nie auf undefined (4.6: das ist das Legacy-Signal fuer "vor der
// Kette entstanden").
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

// ---- KV2-3: call_cost_evidence (das Kosten-Buch) --------------------------------------
// Voller Rundlauf ueber ALLE Felder inkl. detail und einem Nicht-Default-versuche-Wert -
// create -> recordCallCostEvidence -> save -> echter Reopen/Disk-Read -> callCostEvidence.
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

// Entfernt die lauf-eigene id (Muster askedAt oben), damit der Shape-Vergleich nicht an
// zwei unterschiedlich generierten IDs scheitert.
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
  // tenantId/callId unterscheiden sich (unabhaengige createCall-Aufrufe je Backend) -
  // aus dem Vergleich genommen, der Rest (Typabbildung BIGINT/INT/JSONB/NULL) muss
  // identisch sein.
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
});

