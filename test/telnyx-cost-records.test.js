// Telnyx-CDR-Seam am Voice-Port (PLAN-LIVE-COST-TRACING P1): parseDecimalToMicroCents/
// parseNonNegativeInteger (cost-parse.js) und telnyxVoice.getVoiceCostRecords. Rein offline
// (global.fetch gestubbt, F.I.R.S.T.), kein pglite/Server-Spawn (eigene Datei -> kein
// Test-Worker-Stall). Env VOR dem dynamischen Import gesetzt (Muster telnyx-voice.test.js).
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

const LEG_ID = "leg_abc123";
const STARTED_AT = "2026-07-20T10:00:00Z";
const ENDED_AT = "2026-07-20T10:05:00Z";
const WINDOW = { legId: LEG_ID, startedAt: STARTED_AT, endedAt: ENDED_AT };

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

function rawRecord({ recordType, cost, billedSec, currency = "USD", legId = LEG_ID }) {
  return {
    record_type: recordType,
    cost,
    currency,
    leg_id: legId,
    ...(billedSec !== undefined ? { billed_sec: billedSec } : {}),
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

// ---- (b) Gemischte record_types (real gemessene Werte) ----

const MEASURED_RECORDS = [
  { recordType: "sip-trunking", cost: "0.0802", billedSec: 120, expected: 8020000 },
  { recordType: "call-control", cost: "0.004", expected: 400000 },
  { recordType: "speech-to-text", cost: "0.0000", expected: 0 },
  { recordType: "text-to-speech", cost: "1.687E-4", expected: 16870 },
  { recordType: "recording", cost: "0.002", expected: 200000 },
  { recordType: "inference", cost: "0.001315", expected: 131500 },
  { recordType: "ai-voice-assistant", cost: "0.05", expected: 5000000 },
];

function stubMeasuredRecords() {
  const pages = {};
  for (const r of MEASURED_RECORDS) {
    pages[r.recordType] = [
      rawRecord({ recordType: r.recordType, cost: r.cost, billedSec: r.billedSec }),
    ];
  }
  return stubFetchByRecordType(pages);
}

test("getVoiceCostRecords: 7 record_types, korrekte Mikro-Cents, Summe, Waehrung, legId", async () => {
  const calls = stubMeasuredRecords();
  const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 7);
  const sum = res.records.reduce((acc, r) => acc + r.costMicroCents, 0);
  assert.equal(sum, 13768370);
  for (const r of res.records) {
    assert.equal(r.currency, "USD");
    assert.equal(r.legId, LEG_ID);
  }
  const sipTrunking = res.records.find((r) => r.recordType === "sip-trunking");
  assert.equal(sipTrunking.billedSec, 120);

  assert.equal(calls.length, 7);
  for (const c of calls) {
    assert.ok(c.url.startsWith(`${API_BASE}/v2/detail_records`));
    assert.equal(c.opts.headers.Authorization, `Bearer ${API_KEY}`);
  }
});

test("getVoiceCostRecords: Ende-zu-Ende sip-trunking cost 0.0802 -> costMicroCents 8020000", async () => {
  stubMeasuredRecords();
  const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
  const sipTrunking = res.records.find((r) => r.recordType === "sip-trunking");
  assert.equal(sipTrunking.costMicroCents, 8020000);
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
  const eurPages = { "sip-trunking": [rawRecord({ recordType: "sip-trunking", cost: "0.0802", currency: "EUR" })] };
  for (const t of ["call-control", "speech-to-text", "text-to-speech", "recording", "inference", "ai-voice-assistant"])
    eurPages[t] = [];
  stubFetchByRecordType(eurPages);
  const eurRes = await telnyxVoice.getVoiceCostRecords(WINDOW);
  assert.equal(eurRes.ok, true);
  assert.equal(eurRes.records.length, 0, "EUR-Record bei PROVIDER_CURRENCY=USD verworfen");

  const usdLowerPages = { "sip-trunking": [rawRecord({ recordType: "sip-trunking", cost: "0.0802", currency: "usd" })] };
  for (const t of ["call-control", "speech-to-text", "text-to-speech", "recording", "inference", "ai-voice-assistant"])
    usdLowerPages[t] = [];
  stubFetchByRecordType(usdLowerPages);
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
  assert.equal((await telnyxVoice.getVoiceCostRecords({ legId: LEG_ID, endedAt: ENDED_AT })).reason, "params_missing");
  assert.equal((await telnyxVoice.getVoiceCostRecords({ legId: LEG_ID, startedAt: STARTED_AT })).reason, "params_missing");
});

test("getVoiceCostRecords: fehlende Config (TELNYX_API_KEY) -> ok:false, reason config_missing", async () => {
  stubFetchByRecordType({});
  await withBlankedConfig("telnyxApiKey", async () => {
    const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "config_missing");
  });
});

test("getVoiceCostRecords: Record mit fremder Leg-ID wird verworfen", async () => {
  const pages = { "sip-trunking": [rawRecord({ recordType: "sip-trunking", cost: "0.0802", legId: "leg_other" })] };
  for (const t of ["call-control", "speech-to-text", "text-to-speech", "recording", "inference", "ai-voice-assistant"])
    pages[t] = [];
  stubFetchByRecordType(pages);
  const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 0);
});

test("getVoiceCostRecords: volle Seite -> ok:false, reason page_truncated", async () => {
  const fullPage = Array.from({ length: 250 }, () => rawRecord({ recordType: "sip-trunking", cost: "0.01" }));
  stubFetchByRecordType({ "sip-trunking": fullPage });
  const res = await telnyxVoice.getVoiceCostRecords(WINDOW);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "page_truncated");
});

// ---- (f) Twilio-Riegel ----

test("twilioVoice.getVoiceCostRecords ist NICHT implementiert (bewusst, Twilio-price deckt nur Connectivity)", () => {
  assert.equal(twilioVoice.getVoiceCostRecords, undefined);
});

// ---- (g) Kein-Aufrufer-Riegel ----

// Rein textuelle Pruefung ueber src/ (Muster telnyx-assistant-route-drift.test.js): pinnt
// das Akzeptanzkriterium "kein Produktionspfad ruft getVoiceCostRecords auf" strukturell,
// statt sich auf eine Zusicherung im Review zu verlassen.
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

test("getVoiceCostRecords hat in src/ genau zwei Fundstellen (ports.js + adapters/telnyx/voice.js) - kein Aufrufer", () => {
  const srcDir = fileURLToPath(new URL("../src", import.meta.url));
  const hits = listJsFilesRecursive(srcDir)
    .filter((f) => readFileSync(f, "utf8").includes("getVoiceCostRecords"))
    .map((f) => path.relative(srcDir, f).split(path.sep).join("/"));
  assert.deepEqual(hits.sort(), ["telephony/adapters/telnyx/voice.js", "telephony/ports.js"]);
});
