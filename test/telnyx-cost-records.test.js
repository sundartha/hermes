// Telnyx-CDR-Seam am Voice-Port (PLAN-LIVE-COST-TRACING P1): parseDecimalToMicroCents/
// parseNonNegativeInteger (cost-parse.js) und telnyxVoice.getVoiceCostRecords. Rein offline
// (global.fetch gestubbt, F.I.R.S.T.), kein pglite/Server-Spawn (eigene Datei -> kein
// Test-Worker-Stall). Env VOR dem dynamischen Import gesetzt (Muster telnyx-voice.test.js).
//
// LCT-FIX-1: die frueheren Fixtures ERFANDEN das Feld leg_id. Genau deshalb war diese Suite
// gruen, waehrend live JEDER Beleg verworfen wurde (records=0, rejected={"leg_unresolved":205,
// "leg_mismatch":92}) - ein Test gegen selbst erfundene Daten prueft die eigene Annahme, nicht
// die Wirklichkeit. Die Fixtures tragen ab jetzt die GEMESSENEN Feldnamen und Wertformen
// (Quelle: tasks/lct-fix-1-spec.md Abschnitt 2, Messung 2026-07-21 ueber 297 echte Belege).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeConfigOverrides } from "./helpers.js";

const API_BASE = "https://telnyx.test";
const API_KEY = "KEYtest-secret-do-not-leak";

process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;
process.env.PROVIDER_CURRENCY = "USD";

const { parseDecimalToMicroCents, parseNonNegativeInteger } = await import(
  "../src/telephony/adapters/telnyx/cost-parse.js"
);
const { telnyxVoice } = await import("../src/telephony/adapters/telnyx/voice.js");
const { twilioVoice } = await import("../src/telephony/adapters/twilio/voice.js");
const { config } = await import("../src/config.js");

const { withBlankedConfig } = makeConfigOverrides(config);

const STARTED_AT = "2026-07-20T10:00:00Z";
const ENDED_AT = "2026-07-20T10:05:00Z";

// Reale ID-FORMEN (Werte synthetisch, Form gemessen): der Anker ist eine `v3:`-Token
// (providerLegIdOf liefert genau die), Session und Leg sind UUIDs eines ZWEITEN ID-Systems.
const CALL_CONTROL_ID = "v3:LoD0swXYmiEsyntheticAnchorForTestsOnly0000000000000";
const SESSION_ID = "285df0e6-84f2-11f0-9c1a-02420a0d0b0e";
const TELNYX_LEG_ID = "285df0e6-84f2-11f0-9c1a-02420a0d0b0f";
const CONVERSATION_ID = "conv-9f2c1b7a";
const FOREIGN_CALL_CONTROL_ID = "v3:FremderAnkerEinesAnderenTenants00000000000000000000";
const FOREIGN_SESSION_ID = "9c4b21aa-84f2-11f0-9c1a-02420a0d0c11";
const FOREIGN_LEG_ID = "9c4b21aa-84f2-11f0-9c1a-02420a0d0c12";

const OWN_IDS = Object.freeze({ anchorId: CALL_CONTROL_ID, sessionId: SESSION_ID, legUuid: TELNYX_LEG_ID });
const FOREIGN_IDS = Object.freeze({
  anchorId: FOREIGN_CALL_CONTROL_ID,
  sessionId: FOREIGN_SESSION_ID,
  legUuid: FOREIGN_LEG_ID,
});

const WINDOW = { legId: CALL_CONTROL_ID, startedAt: STARTED_AT, endedAt: ENDED_AT };

// fetch-Stub: liefert je filter[record_type] eine konfigurierte Seite. Zeichnet alle
// Aufrufe auf (URL, Header) fuer Struktur-Assertions.
function stubFetchByRecordType(pagesByType, { status = 200 } = {}) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    const u = new URL(url);
    const recordType = u.searchParams.get("filter[record_type]");
    const data = pagesByType[recordType] || [];
    return {
      ok: status < 400,
      status,
      json: async () => ({ data }),
      text: async () => JSON.stringify({ data }),
    };
  };
  return calls;
}

// EINE Quelle der realen ID-Felder je record_type (Spec Abschnitt 2). Werte kommen als
// Parameter, damit Fremd-Session-Faelle DIESELBE Form mit anderen IDs bauen (G5).
const ID_FIELDS_BY_RECORD_TYPE = Object.freeze({
  "sip-trunking": ({ anchorId, sessionId }) => ({ call_control_id: anchorId, telnyx_session_id: sessionId }),
  // KEIN call_control_id - genau der Fall, der nur ueber die Session auffindbar ist.
  "call-control": ({ sessionId, legUuid }) => ({ telnyx_leg_id: legUuid, telnyx_session_id: sessionId }),
  recording: ({ sessionId }) => ({ telnyx_session_id: sessionId }),
  "ai-voice-assistant": ({ anchorId, sessionId, legUuid }) => ({
    call_control_id: anchorId,
    telnyx_leg_id: legUuid,
    telnyx_session_id: sessionId,
    conversation_id: CONVERSATION_ID,
  }),
  "speech-to-text": ({ sessionId, legUuid }) => ({ call_session_id: sessionId, call_leg_id: legUuid }),
  "text-to-speech": ({ sessionId, legUuid }) => ({ call_session_id: sessionId, call_leg_id: legUuid }),
  inference: () => ({ conversation_id: CONVERSATION_ID }), // KEINE Session-/Leg-Referenz
});

function realRecord(recordType, { cost, billedSec, currency = "USD", ids = OWN_IDS, extraFields = {} } = {}) {
  return {
    record_type: recordType,
    cost,
    currency,
    ...ID_FIELDS_BY_RECORD_TYPE[recordType](ids),
    ...(billedSec !== undefined ? { billed_sec: billedSec } : {}),
    ...extraFields, // weitere reale Felder: started_at, recorded_at, rate_measured_in
  };
}

// ---- (a) Parser-Tabelle, ohne Float-Zwischenschritt ----

const PARSER_CASES = [
  ["0.0122", 1220000],
  ["0", 0],
  ["1", 100000000],
  ["1.687E-4", 16870],
  ["1.687e-4", 16870],
  ["1e-3", 100000],
  ["7.0E-7", 70],
  ["0.000000004", 0],
  ["0.0000", 0],
];

for (const [input, expected] of PARSER_CASES) {
  test(`parseDecimalToMicroCents("${input}") === ${expected}`, () => {
    assert.equal(parseDecimalToMicroCents(input), expected);
  });
}

const PARSER_INVALID_CASES = [
  "abc",
  "",
  null,
  undefined,
  0.0122, // Number statt String - G26: kein Number auf Geldstrings, auch nicht implizit
  "-0.01",
  "1.0E+400",
  "1e",
  "E-4",
  "1.",
  "0.0.1",
  "+0.01", // fuehrendes Vorzeichen ist ungueltig, nie beobachtet (Design-Entscheidung P1)
];

for (const input of PARSER_INVALID_CASES) {
  test(`parseDecimalToMicroCents(${JSON.stringify(input)}) === null`, () => {
    assert.equal(parseDecimalToMicroCents(input), null);
  });
}

test("parseDecimalToMicroCents: Ganzzahl-Summe ohne Float-Fehler (0.07+0.01 === 8000000 exakt)", () => {
  // Abweichung von der Plan-Formulierung: der Plan behauptet "0.07 + 0.01 === 0.08 ist in
  // JS falsch" - das ist fuer GENAU dieses Zahlenpaar empirisch nicht der Fall (IEEE754
  // rundet hier zufaellig exakt, node -e "0.07+0.01===0.08" -> true). Die eigentliche
  // Zusicherung (Ganzzahl-Summe exakt, kein Float-Zwischenschritt) bleibt unveraendert;
  // die Kontrollannahme demonstriert die Float-Fehlerklasse stattdessen am klassischen,
  // tatsaechlich falschen Beispiel 0.1+0.2 (s. naechster Test).
  const sum = parseDecimalToMicroCents("0.07") + parseDecimalToMicroCents("0.01");
  assert.equal(sum, 8000000);
});

test("parseDecimalToMicroCents: Float-Fehlerklasse demonstriert (0.1+0.2 !== 0.3 in JS), Parser bleibt exakt", () => {
  assert.notEqual(0.1 + 0.2, 0.3, "Kontrollannahme: klassischer IEEE754-Rundungsfehler");
  const sum = parseDecimalToMicroCents("0.1") + parseDecimalToMicroCents("0.2");
  assert.equal(sum, 30000000);
});

// (a2) Einheiten-Riegel: faellt rot aus, sobald der Faktor auf 10^6 zurueckgedreht wird
// (dann 39000 statt 3900000 - der Test unterscheidet die beiden Faktoren scharf).
test("parseDecimalToMicroCents: Einheiten-Riegel 10^8 (0.039 -> 3900000, NICHT 39000)", () => {
  assert.equal(parseDecimalToMicroCents("0.039"), 3900000);
});

// (a3) Notations-Riegel: eigener Test fuer die korrigierte Plan-Fassung (wissenschaftliche
// Notation ist Normalbetrieb, keine fruehere Fassung durfte sie verwerfen).
test("parseDecimalToMicroCents: wissenschaftliche Notation ist gueltig (1.687E-4 === 16870)", () => {
  assert.equal(parseDecimalToMicroCents("1.687E-4"), 16870);
});

// ---- parseNonNegativeInteger ----

test("parseNonNegativeInteger: gueltige Ganzzahlen (string und number)", () => {
  assert.equal(parseNonNegativeInteger("120"), 120);
  assert.equal(parseNonNegativeInteger(120), 120);
  assert.equal(parseNonNegativeInteger("0"), 0);
});

test("parseNonNegativeInteger: ungueltige Werte -> null", () => {
  for (const input of ["-1", "1.5", "abc", "", null, undefined, -1, 1.5, "1e3"]) {
    assert.equal(parseNonNegativeInteger(input), null, `Eingabe ${JSON.stringify(input)}`);
  }
});

// ---- (b) Reale Belegformen: zweistufige Zuordnung (Anker + Session) ----

// Live gesetzt als COST_TRUING_REQUIRED_RECORD_TYPES - erst ueber die Session erfuellbar,
// denn call-control traegt keinen Anker.
const REQUIRED_RECORD_TYPES = Object.freeze(["sip-trunking", "call-control"]);

// Ein realer Beleg je record_type (Kosten und Zusatzfelder aus der Messung 2026-07-21).
const REAL_RECORDS = [
  { recordType: "sip-trunking", cost: "0.0401", billedSec: 60, extraFields: { started_at: "2026-07-20T10:01:00Z" } },
  { recordType: "call-control", cost: "0.001" },
  { recordType: "speech-to-text", cost: "0.0000" },
  { recordType: "text-to-speech", cost: "1.687E-4" },
  { recordType: "recording", cost: "0.002" },
  { recordType: "ai-voice-assistant", cost: "0.05", billedSec: 60, extraFields: { rate_measured_in: "ai_voice_assistant_minutes" } },
  { recordType: "inference", cost: "0.001315" }, // unzuordenbar - bewusste Grenze
];

function stubRealRecords({ ids = OWN_IDS } = {}) {
  const pages = {};
  for (const r of REAL_RECORDS)
    pages[r.recordType] = [
      realRecord(r.recordType, { cost: r.cost, billedSec: r.billedSec, extraFields: r.extraFields, ids }),
    ];
  return stubFetchByRecordType(pages);
}

// Belege, die in der gemessenen Wirklichkeit KEINEN Anker tragen und daher ausschliesslich
// ueber die aufgespannte Session gefunden werden koennen (Spec Abschnitt 2).
const SESSION_ONLY_RECORD_TYPES = Object.freeze([
  "call-control", "recording", "speech-to-text", "text-to-speech",
]);

test("getVoiceCostRecords: reale Belegformen - der Anker spannt die Session auf, die Belege OHNE Anker kommen mit", async () => {
  stubRealRecords();
  const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
  assert.equal(res.ok, true);
  // ROT VOR DEM FIX: die alte leg_id/call_leg_id-Zuordnung findet in diesen realen Formen
  // KEINEN einzigen Beleg -> records.length === 0.
  assert.equal(res.records.length, 6, "6 von 7 Typen zuordenbar (inference traegt keine Session)");
  const sum = res.records.reduce((acc, r) => acc + r.costMicroCents, 0);
  assert.equal(sum, 9326870); // 4010000 + 100000 + 0 + 16870 + 200000 + 5000000
  const found = new Set(res.records.map((r) => r.recordType));
  for (const sessionOnly of SESSION_ONLY_RECORD_TYPES)
    assert.ok(found.has(sessionOnly), `${sessionOnly} traegt keinen Anker und muss ueber die Session kommen`);
  for (const required of REQUIRED_RECORD_TYPES)
    assert.ok(found.has(required), `Pflicht-Typ ${required} fehlt - die Pflicht-Menge waere nicht erfuellbar`);
  assert.ok(!found.has("inference"));
  for (const r of res.records) {
    assert.equal(r.currency, "USD");
    assert.equal(r.legId, CALL_CONTROL_ID, "legId bleibt der uebergebene Anker (Korrelationsschluessel)");
  }
  assert.equal(res.records.find((r) => r.recordType === "sip-trunking").billedSec, 60);
});

test("getVoiceCostRecords: fragt alle sieben record_types mit Bearer-Key ab", async () => {
  const calls = stubRealRecords();
  await telnyxVoice.getVoiceCostRecords(WINDOW);
  assert.equal(calls.length, 7);
  for (const c of calls) {
    assert.ok(c.url.startsWith(`${API_BASE}/v2/detail_records`));
    assert.equal(c.opts.headers.Authorization, `Bearer ${API_KEY}`);
  }
});

test("getVoiceCostRecords: Ende-zu-Ende sip-trunking cost 0.0401 -> costMicroCents 4010000", async () => {
  stubRealRecords();
  const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
  const sipTrunking = res.records.find((r) => r.recordType === "sip-trunking");
  assert.equal(sipTrunking.costMicroCents, 4010000);
});

// ---- (c) HTTP 500 und Timeout ----

test("getVoiceCostRecords: HTTP 500 -> ok:false, records undefined, kein Wurf", async () => {
  stubFetchByRecordType({}, { status: 500 });
  await assert.doesNotReject(async () => {
    const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
    assert.equal(res.ok, false);
    assert.equal(res.records, undefined);
    // ok:false ist NICHT die leere Menge - "0 Records gefunden" waere ok:true mit [].
    assert.notEqual(res.records?.length, 0);
  });
});

test("getVoiceCostRecords: rejectendes fetch (Netzfehler/Timeout) -> ok:false, kein Wurf", async () => {
  global.fetch = async () => {
    throw new Error("network timeout");
  };
  await assert.doesNotReject(async () => {
    const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
    assert.equal(res.ok, false);
    assert.equal(res.records, undefined);
    assert.notEqual(res.records?.length, 0);
  });
});

// ---- (d) Fremdwaehrung ----

test("getVoiceCostRecords: fremde Waehrung wird verworfen, gleiche Waehrung kleingeschrieben akzeptiert", async () => {
  // Der EUR-Beleg traegt den Anker und waere zuordenbar - er faellt trotzdem weg. Das pinnt
  // die Reihenfolge Waehrung-vor-Zuordnung in toCostRecord.
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401", currency: "EUR" })],
  });
  const eurRes = await telnyxVoice.getVoiceCostRecords(WINDOW);
  assert.equal(eurRes.ok, true);
  assert.equal(eurRes.records.length, 0, "EUR-Record bei PROVIDER_CURRENCY=USD verworfen");

  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401", currency: "usd" })],
  });
  const usdRes = await telnyxVoice.getVoiceCostRecords(WINDOW);
  assert.equal(usdRes.ok, true);
  assert.equal(usdRes.records.length, 1, "Kleingeschriebenes 'usd' case-insensitiv akzeptiert");
});

// ---- (e) Grenzfaelle des Seams ----

test("getVoiceCostRecords: fehlender legId -> ok:false, reason params_missing", async () => {
  stubFetchByRecordType({});
  const res = await telnyxVoice.getVoiceCostRecords({ startedAt: STARTED_AT, endedAt: ENDED_AT });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "params_missing");
});

test("getVoiceCostRecords: fehlender startedAt/endedAt -> ok:false, reason params_missing", async () => {
  stubFetchByRecordType({});
  assert.equal(
    (await telnyxVoice.getVoiceCostRecords({ legId: CALL_CONTROL_ID, endedAt: ENDED_AT })).reason,
    "params_missing",
  );
  assert.equal(
    (await telnyxVoice.getVoiceCostRecords({ legId: CALL_CONTROL_ID, startedAt: STARTED_AT })).reason,
    "params_missing",
  );
});

test("getVoiceCostRecords: fehlende Config (TELNYX_API_KEY) -> ok:false, reason config_missing", async () => {
  stubFetchByRecordType({});
  await withBlankedConfig("telnyxApiKey", async () => {
    const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "config_missing");
  });
});

test("getVoiceCostRecords: kein Anker in der Antwort -> LEERE Liste, ok:true, kein Wurf (fail-closed)", async () => {
  stubRealRecords({ ids: FOREIGN_IDS });
  await assert.doesNotReject(async () => {
    const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
    assert.equal(res.ok, true);
    assert.deepEqual(res.records, [], "ohne Anker wird NICHTS akzeptiert - kein lockererer Fallback");
  });
});

// KEINE gemessene Form (real traegt sip-trunking immer beide Felder), sondern ein Provider-
// Drift-Grenzfall: faellt das Session-Feld weg, bleibt der Anker Identitaetsgleichheit auf
// UNSERER eigenen, global eindeutigen ID - verwerfen waere Datenverlust ohne Sicherheits-
// gewinn. Ohne diesen Test bliebe der direkte Anker-Zweig ungepinnt (alle anderen Fixtures
// tragen zusaetzlich die passende Session und wuerden ihn nicht bemerken).
test("getVoiceCostRecords: Beleg MIT Anker aber OHNE Session-Referenz wird akzeptiert", async () => {
  const anchorOnly = realRecord("sip-trunking", { cost: "0.0401" });
  delete anchorOnly.telnyx_session_id;
  stubFetchByRecordType({ "sip-trunking": [anchorOnly] });
  const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 1, "Identitaetsgleichheit auf call_control_id genuegt");
  assert.equal(res.records[0].legId, CALL_CONTROL_ID);
});

test("getVoiceCostRecords: Belege einer FREMDEN Session kommen NIE mit (Tenant-Trennung)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401" })],
    "call-control": [
      realRecord("call-control", { cost: "0.001" }),
      realRecord("call-control", { cost: "9.99", ids: FOREIGN_IDS }),
    ],
  });
  const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 2, "nur die zwei eigenen Belege");
  const sum = res.records.reduce((acc, r) => acc + r.costMicroCents, 0);
  assert.equal(sum, 4110000); // 4010000 + 100000, der fremde Beleg (999000000) fehlt
  assert.ok(
    !res.records.some((r) => r.costMicroCents === 999000000),
    "ein fremder Beleg waere eine Fehlbuchung auf einen fremden Tenant",
  );
});

test("getVoiceCostRecords: `inference` bleibt unzuordenbar (nur conversation_id) - bewusste Grenze", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401" })],
    inference: [realRecord("inference", { cost: "0.001315" })],
  });
  const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 1);
  assert.equal(res.records[0].recordType, "sip-trunking");
});

test("getVoiceCostRecords: Beleg ausserhalb des Zeitfensters wird verworfen (recorded_at)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [
      realRecord("sip-trunking", { cost: "0.0401", extraFields: { recorded_at: "2026-07-20T09:00:00Z" } }),
    ],
  });
  const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 0, "Zeitfenster bleibt die zweite Linie neben der Zuordnung");
});

test("getVoiceCostRecords: volle Seite -> ok:false, reason page_truncated", async () => {
  const fullPage = Array.from({ length: 250 }, () => realRecord("sip-trunking", { cost: "0.01" }));
  stubFetchByRecordType({ "sip-trunking": fullPage });
  const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "page_truncated");
});

// ---- (f) Twilio-Riegel ----

test("twilioVoice.getVoiceCostRecords ist NICHT implementiert (bewusst, Twilio-price deckt nur Connectivity)", () => {
  assert.equal(twilioVoice.getVoiceCostRecords, undefined);
});

// ---- (g) Aufrufer-Riegel ----

// Rein textuelle Pruefung ueber src/ (Muster telnyx-assistant-route-drift.test.js). Bis P2
// pinnte dieser Test "kein Aufrufer" - P3 (Kosten-Abgleich im Beobachtungsmodus,
// billing/cost-truing.js) fuehrt den ERSTEN und EINZIGEN vorgesehenen Aufrufer ein (ueber
// den voiceControl-Port, kein direkter Adapter-Import). Der Riegel bleibt wertvoll, nur
// umgekehrt: er pinnt jetzt, DASS der Aufrufer NUR dort (+ server.js, reiner Kommentar-
// Treffer aus der Verdrahtung) steht und NICHT in einem Geld-/Gate-Pfad, den P3
// ausdruecklich unangetastet laesst (metering.js, call-finish.js, outbound-gates.js).
function listJsFilesRecursive(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJsFilesRecursive(full));
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

// Geld-/Gate-Pfade, die P3 ausdruecklich NICHT anfasst (PLAN-LIVE-COST-TRACING.md P3,
// Abschnitt "Bewusst NICHT angefasst"). Ein Treffer hier waere ein echter Scope-Bruch.
const FORBIDDEN_CALLER_FILES = Object.freeze([
  "billing/metering.js",
  "telephony/call-finish.js",
  "telephony/outbound-gates.js",
]);

test("getVoiceCostRecords: Aufrufer NUR in cost-truing.js (LCT P3) - NIE in einem Geld-/Gate-Pfad", () => {
  const srcDir = fileURLToPath(new URL("../src", import.meta.url));
  const hits = listJsFilesRecursive(srcDir)
    .filter((f) => readFileSync(f, "utf8").includes("getVoiceCostRecords"))
    .map((f) => path.relative(srcDir, f).split(path.sep).join("/"));
  const forbidden = hits.filter((f) => FORBIDDEN_CALLER_FILES.includes(f));
  assert.deepEqual(forbidden, [], "P3 (Beobachtungsmodus) darf keinen dieser Geld-/Gate-Pfade beruehren");
  assert.deepEqual(hits.sort(), [
    "billing/cost-truing.js",
    "server.js",
    "telephony/adapters/telnyx/voice.js",
    "telephony/ports.js",
  ]);
});
