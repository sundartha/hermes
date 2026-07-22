// Telnyx-CDR-Seam am Voice-Port (PLAN-LIVE-COST-TRACING P1): parseDecimalToMicroCents/
// parseNonNegativeInteger (cost-parse.js) und telnyxVoice.fetchCostRecordPool/
// assignCostRecords (KE-P2: der frueher einteilige Port ist zweigeteilt, s. fetchAndAssign
// unten). Rein offline (global.fetch gestubbt, F.I.R.S.T.), kein pglite/Server-Spawn (eigene
// Datei -> kein Test-Worker-Stall). Env VOR dem dynamischen Import gesetzt (Muster
// telnyx-voice.test.js).
//
// LCT-FIX-1: die frueheren Fixtures ERFANDEN das Feld leg_id. Genau deshalb war diese Suite
// gruen, waehrend live JEDER Beleg verworfen wurde (records=0, rejected={"leg_unresolved":205,
// "leg_mismatch":92}) - ein Test gegen selbst erfundene Daten prueft die eigene Annahme, nicht
// die Wirklichkeit. Die Fixtures tragen ab jetzt die Feldnamen und Wertformen aus der
// Live-Messung 2026-07-21 (297 echte Belege).
//
// REICHWEITE DIESER TESTS - ehrlich benannt, damit der Vorfall sich nicht wiederholt: der
// Rohauszug jener Messung liegt NICHT im Repo. Belegt ist damit nur, welche Felder die
// Belege fuehren; die Annahme, dass `telnyx_session_id` und `call_session_id` denselben,
// CALL-LOKALEN Wert bezeichnen, spielen diese Fixtures nach - sie beweisen sie NICHT. Was
// die Tests hier wirklich pinnen, ist die fail-closed-Richtung: was NICHT in der vom Anker
// aufgespannten Session liegt, kommt nie mit. Die laufende Beobachtung der Session-Invariante
// (Log-Zeile mit den je Zuordnungsweg getrennten Zaehlern `via_…`) ist in
// tasks/lct-DEPLOY-CHECKLIST.md beschrieben - das Format ist hier gepinnt, damit sie nicht
// still an einer geaenderten Log-Zeile zerbricht.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureConsole, makeConfigOverrides } from "./helpers.js";
// KE-P6 (Aenderung 1): boot-guard.js hat NULL Imports (kein Config-/Spawn-Risiko) - statisch
// importierbar wie helpers.js, ohne die env-vor-dynamischem-Import-Reihenfolge zu verletzen.
import { costTruingBookingFindings, COST_TRUING_BOOKING_FINDING } from "../src/boot-guard.js";

const API_BASE = "https://telnyx.test";
const API_KEY = "KEYtest-secret-do-not-leak";

process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;
process.env.PROVIDER_CURRENCY = "USD";

const { parseDecimalToMicroCents, parseNonNegativeInteger } = await import(
  "../src/telephony/adapters/telnyx/cost-parse.js"
);
const {
  telnyxVoice,
  COST_RECORD_TYPES,
  UNASSIGNABLE_COST_RECORD_TYPES,
  ASSIGNABLE_COST_RECORD_TYPES,
  COST_RECORD_TIME_FIELDS,
  DETAIL_RECORDS_LIMIT_PER_MINUTE,
  DETAIL_RECORDS_RESERVE_PER_MINUTE,
  DETAIL_RECORDS_BUDGET_PER_MINUTE,
} = await import("../src/telephony/adapters/telnyx/voice.js");
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

// KOEDER (A2, KE-P2-Aequivalenztest): telnyx_leg_id/call_leg_id tragen an ALLEN Belegen -
// eigenen wie fremden - DENSELBEN Wert. Benutzte der Code sie als Zuordnungsquelle, bekaeme
// JEDER Call JEDEN Beleg inklusive des fremden, und beide Summen unten waeren falsch. Genau
// dieser Feldname hat live 297 von 297 Belegen verworfen (LCT-FIX-1).
const BAIT_LEG_ID = "0bad0bad-0bad-11f1-0bad-0bad0bad0bad0";
// Zweiter Anruf desselben Sweeps (Plan F4: gemessenes Paar mit 20,4 s Ueberlappung) - der
// geteilte Pool (KE-P2) darf die beiden Anker nicht miteinander vermischen.
const SECOND_CALL_CONTROL_ID = "v3:ZweiterAnkerDesselbenSweeps0000000000000000000000";
const SECOND_SESSION_ID = "3f7ac1b2-84f2-11f0-9c1a-02420a0d0b10";
const CALL_A_IDS = Object.freeze({ anchorId: CALL_CONTROL_ID, sessionId: SESSION_ID, legUuid: BAIT_LEG_ID });
const CALL_B_IDS = Object.freeze({ anchorId: SECOND_CALL_CONTROL_ID, sessionId: SECOND_SESSION_ID, legUuid: BAIT_LEG_ID });
const FOREIGN_POOL_IDS = Object.freeze({ anchorId: FOREIGN_CALL_CONTROL_ID, sessionId: FOREIGN_SESSION_ID, legUuid: BAIT_LEG_ID });

const WINDOW = { legId: CALL_CONTROL_ID, startedAt: STARTED_AT, endedAt: ENDED_AT };

const { createMinuteWindowThrottle } = await import(
  "../src/telephony/adapters/telnyx/rate-limit.js"
);
const { jumpClock: createJumpClock } = await import("./fake-clock.js");

// KE-P4: die produktive Drossel haengt an der ECHTEN Uhr und einem ECHTEN Timer. Jeder
// Abruf im Test injiziert deshalb eine Drossel mit SPRUNG-Uhr - sonst bliebe der 31. Abruf
// einer realen Minute bis zur naechsten vollen Minute stehen und die Suite haenge an der
// Wanduhr (F.I.R.S.T.: Fast/Repeatable). Injiziert wird die ECHTE Fabrik, kein
// Attrappen-Objekt: ein Stub, der nie drosselt, koennte die Drossel nicht beweisen.
const BUDGET_PER_MINUTE = 30; // gemessene 40 minus bewusster Reserve 10
const THROTTLE_START_AT = "2026-07-21T16:18:30.000Z"; // gemessener Burst-Zeitpunkt (Plan F1)

// Sprung-Uhr mit dem in dieser Datei gemessenen Burst-Zeitpunkt als Default (Koerper in
// test/fake-clock.js, geteilt mit test/telnyx-cost-throttle.test.js, G5).
const jumpClock = (startIso = THROTTLE_START_AT) => createJumpClock(startIso);
const testThrottle = (clock = jumpClock()) =>
  createMinuteWindowThrottle({ budget: BUDGET_PER_MINUTE, now: clock.now, sleep: clock.sleep });

// EIN Weg in den Belegabruf im Test - mit injizierter Drossel.
const fetchPool = (params = {}) =>
  telnyxVoice.fetchCostRecordPool({ ...params, throttle: testThrottle() });

// KE-P2: der Port ist zweigeteilt. Diese Helferin spiegelt die PRODUKTIVE Verdrahtung aus
// billing/cost-truing.js - EIN Pool-Abruf, danach die SYNCHRONE Zuordnung je Call. Die
// Bestandsfaelle pruefen damit unveraendert dieselbe Kette ueber den neuen Schnitt.
async function fetchAndAssign(params = WINDOW) {
  const pool = await fetchPool();
  if (!pool.ok) return pool;
  return telnyxVoice.assignCostRecords(pool, params);
}

// Antwortkoerper EINER Listen-Seite in der GEMESSENEN Form (Messung 2026-07-21):
// {data:[...]} plus - bei einer paginierten Menge - {meta:{total_results, total_pages,
// page_size}}. Ein blosses Array bleibt die meta-lose Seite (alle Bestands-Fixtures,
// byte-identisch); {records, meta} baut die paginierte Form. EINE Stelle (G5), damit die
// Antwortform nicht je Fixture neu erfunden wird - genau daran ist die Kette zweimal
// gestorben.
function listPageBody(page) {
  return Array.isArray(page) ? { data: page } : { data: page.records, meta: page.meta };
}

// KE-P3: mehrseitige Antwort je Typ. pagesByType[type] ist eine LISTE von Seiten (Index 0 =
// page[number]=1). Eine nicht konfigurierte Seite ist LEER - die gemessene Form des Endes
// (kurze Seite). EINE Stelle fuer die Antwortform (listPageBody). Zeichnet alle Aufrufe auf
// (URL, Header) fuer Struktur-Assertions.
// KE-P4: optionale Uhr zeichnet den ZEITPUNKT jeder Anfrage auf (atMs) - die Drossel-Tests
// pruefen darueber, wie viele Anfragen in welches simulierte Minutenfenster fielen.
function stubFetchPages(pagesByType, clock = null) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts, atMs: clock ? clock.now() : null });
    const u = new URL(url);
    const pages = pagesByType[u.searchParams.get("filter[record_type]")] || [];
    const index = Number(u.searchParams.get("page[number]") || FIRST_PAGE) - 1;
    const body = listPageBody(pages[index] || []);
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return calls;
}

// Bestandsform: EINE Seite je Typ, alle Folgeseiten leer. Alle aelteren Fixtures bleiben
// dadurch byte-identisch.
function stubFetchByRecordType(pagesByType) {
  return stubFetchPages(
    Object.fromEntries(Object.entries(pagesByType).map(([type, page]) => [type, [page]])),
  );
}

const FIRST_PAGE = 1;
const pageNumbersFor = (calls, recordType) =>
  calls
    .map((c) => new URL(c.url).searchParams)
    .filter((p) => p.get("filter[record_type]") === recordType)
    .map((p) => Number(p.get("page[number]")));

// fetch-Stub fuer den FEHLERPFAD (KE-P0): jede Anfrage scheitert mit demselben HTTP-Status
// und Telnyx-Fehler-Envelope. assertTelnyxOk liest im !ok-Zweig res.text() (nicht json()) -
// beide Formen liefern denselben Body (Faithful Response-Double). Getrennt vom Erfolgs-Stub,
// dessen einzige Aufgabe "eine Seite je record_type" ist; ein status-Schalter dort waere ein
// zweiter Weg fuer denselben Zweck.
// KE-P4: optionale Header - Headers ist case-insensitiv wie im echten fetch; ein NICHT
// gesetzter Header liefert null, genau der gemessene Fall "Telnyx nennt kein Retry-After".
function stubFetchFailure({ status, body, headers: responseHeaders = {} }) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: false,
      status,
      headers: new Headers(responseHeaders),
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return calls;
}

// Die gemessenen ID-Felder je record_type (Messung 2026-07-21). Werte kommen als Parameter,
// damit Fremd-Session-Faelle DIESELBE Form mit anderen IDs bauen (G5). Die Schluessel-MENGE
// ist KEINE zweite Quelle des Enums: sie ist an COST_RECORD_TYPES gekoppelt (Test weiter
// unten) - ohne die Kopplung koennte ein neuer Produktions-Typ hier fehlen und der
// Deckungstest bliebe gruen, waehrend der Boot-Guard den Typ nicht kennt.
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
    // Zusatzfelder je Testfall. GEMESSEN sind started_at (nur sip-trunking) und
    // rate_measured_in; die Zeitstempel-Kandidaten des Fensterfilters (recorded_at/
    // created_at) sind GERATENE Feldnamen und werden nur dort injiziert, wo der Test
    // genau diesen Codepfad meint.
    ...extraFields,
  };
}

// Das ZWEITE BEIN eines Anrufs (Plan F3/PM-11, KE-P2-Aequivalenztest): dieselbe Session,
// der Anker gehoert dem ersten Bein. Genau dieser Beleg traegt den ABGERECHNETEN Betrag -
// wer je Typ nur den ersten Treffer nimmt, verliert 0,0401 USD und erstattet real
// ausgegebenes Geld zurueck. Nur fuer Typen mit Anker-Feld relevant (sip-trunking); bei
// call-control (nie Anker) ist das Loeschen ein No-op.
function secondLegRecord(recordType, opts) {
  const record = realRecord(recordType, opts);
  delete record.call_control_id;
  return record;
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

// Realistischer Kandidat fuer COST_TRUING_REQUIRED_RECORD_TYPES (live noch leer, der Wert
// ist eine Owner-Entscheidung vor dem Deploy) - erst ueber die Session erfuellbar, denn
// call-control traegt keinen Anker.
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
// ueber die aufgespannte Session gefunden werden koennen. ABGELEITET aus der Feld-Tabelle
// (S2): welcher Typ keinen Anker fuehrt, steht dort bereits - eine zweite, von Hand
// gepflegte Liste koennte davon abdriften und die Zusicherung still verfallen lassen
// (bekaeme ein Typ in der Tabelle spaeter einen Anker, bliebe die Assertion gruen und
// pruefte ab da nichts mehr). Ohne Anker UND ohne Session waere der Typ gar nicht
// zuordenbar - das ist die andere Menge (UNASSIGNABLE_COST_RECORD_TYPES).
// Erwartete Kardinalitaeten AUS den Produktions-Konstanten, nicht als nackte Zahlen (G25/S2):
// ein Typ mehr im Enum aendert beide Erwartungen automatisch mit.
const ASSIGNABLE_RECORD_COUNT = COST_RECORD_TYPES.length - UNASSIGNABLE_COST_RECORD_TYPES.length;

const SESSION_ONLY_RECORD_TYPES = Object.freeze(
  Object.keys(ID_FIELDS_BY_RECORD_TYPE).filter(
    (t) => !ID_FIELDS_BY_RECORD_TYPE[t](OWN_IDS).call_control_id
      && !UNASSIGNABLE_COST_RECORD_TYPES.includes(t),
  ),
);

test("Belegabruf: reale Belegformen - der Anker spannt die Session auf, die Belege OHNE Anker kommen mit", async () => {
  stubRealRecords();
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.ok, true);
  // ROT VOR DEM FIX: die alte leg_id/call_leg_id-Zuordnung findet in diesen realen Formen
  // KEINEN einzigen Beleg -> records.length === 0.
  assert.equal(
    res.records.length,
    ASSIGNABLE_RECORD_COUNT,
    "alle Typen ausser den unzuordenbaren kommen mit (inference traegt keine Session)",
  );
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

test("Belegabruf: fragt jeden record_type aus ASSIGNABLE_COST_RECORD_TYPES mit Bearer-Key ab", async () => {
  const calls = stubRealRecords();
  await fetchAndAssign(WINDOW);
  assert.equal(calls.length, ASSIGNABLE_COST_RECORD_TYPES.length);
  for (const c of calls) {
    assert.ok(c.url.startsWith(`${API_BASE}/v2/detail_records`));
    assert.equal(c.opts.headers.Authorization, `Bearer ${API_KEY}`);
  }
});

test("Belegabruf: Ende-zu-Ende sip-trunking cost 0.0401 -> costMicroCents 4010000", async () => {
  stubRealRecords();
  const res = await fetchAndAssign(WINDOW);
  const sipTrunking = res.records.find((r) => r.recordType === "sip-trunking");
  assert.equal(sipTrunking.costMicroCents, 4010000);
});

// ---- (b2) KE-P2: die wichtigste Zusage der Kette - assignCostRecords ordnet aus einem
// GETEILTEN Pool genau wie der Bestandspfad zu ----

// 9 Belege, Reihenfolge bewusst: Null-Zwilling VOR dem abgerechneten Beleg, fremder Beleg
// ZUERST. secondLegRecord loescht den Anker (das zweite Bein derselben Session traegt ihn
// laut Messung nicht); call-control-Belege tragen laut Feld-Tabelle nie einen Anker.
function twoAnchorPool() {
  return [
    realRecord("sip-trunking", { cost: "0.0", billedSec: 0, ids: CALL_A_IDS }), // Null-Zwilling A
    secondLegRecord("sip-trunking", { cost: "0.0401", billedSec: 60, ids: CALL_A_IDS }), // abgerechnet A
    realRecord("sip-trunking", { cost: "0.0", billedSec: 0, ids: CALL_B_IDS }), // Null-Zwilling B
    secondLegRecord("sip-trunking", { cost: "0.0502", billedSec: 60, ids: CALL_B_IDS }), // abgerechnet B
    realRecord("call-control", { cost: "9.99", billedSec: 60, ids: FOREIGN_POOL_IDS }), // Fehlbuchungs-Falle
    realRecord("call-control", { cost: "0.002", billedSec: 60, ids: CALL_A_IDS }),
    realRecord("call-control", { cost: "0.0", billedSec: 0, ids: CALL_A_IDS }), // Null-Zwilling A
    realRecord("call-control", { cost: "0.003", billedSec: 60, ids: CALL_B_IDS }),
    realRecord("call-control", { cost: "0.0", billedSec: 0, ids: CALL_B_IDS }), // Null-Zwilling B
  ];
}

const sumMicroCents = (res) => res.records.reduce((acc, r) => acc + r.costMicroCents, 0);

test("assignCostRecords: geteilter Pool - zwei Anker, kein Anker-Beleg gleicht dem anderen, fremde Session bei keinem", async () => {
  const pool9 = twoAnchorPool();
  const byType = (recordType) => pool9.filter((r) => r.record_type === recordType);
  const calls = stubFetchByRecordType({ "sip-trunking": byType("sip-trunking"), "call-control": byType("call-control") });

  const pool = await fetchPool();
  assert.equal(calls.length, ASSIGNABLE_COST_RECORD_TYPES.length, "EIN Pool-Abruf, unabhaengig davon, dass er fuer BEIDE Calls zustaendig ist");
  assert.equal(pool.ok, true);
  assert.equal(pool.complete, true);
  assert.equal(pool.raw.length, 9);

  const a = telnyxVoice.assignCostRecords(pool, { legId: CALL_CONTROL_ID, startedAt: STARTED_AT, endedAt: ENDED_AT });
  const b = telnyxVoice.assignCostRecords(pool, { legId: SECOND_CALL_CONTROL_ID, startedAt: STARTED_AT, endedAt: ENDED_AT });

  assert.equal(a.records.length, 4);
  assert.equal(b.records.length, 4);
  assert.equal(sumMicroCents(a), 4_210_000, "0 + 4010000 + 200000 + 0");
  assert.equal(sumMicroCents(b), 5_320_000, "0 + 5020000 + 300000 + 0");
  assert.ok(a.records.some((r) => r.costMicroCents === 4_010_000), "der abgerechnete sip-trunking-Beleg haengt am Session-Weg");
  assert.equal(a.records.filter((r) => r.costMicroCents === 0).length, 2, "beide Null-Zwillinge sind mitgezaehlt");
  assert.ok(!a.records.some((r) => r.costMicroCents === 999_000_000), "fremde Session kommt bei A nicht mit");
  assert.ok(!b.records.some((r) => r.costMicroCents === 999_000_000), "fremde Session kommt bei B nicht mit");
  assert.ok(!a.records.some((r) => r.costMicroCents === 5_020_000), "keine Quervermischung: B-Beleg landet nicht bei A");

  // Zuordnung ist REIN: derselbe Pool, dieselbe Antwort - unabhaengig von der Reihenfolge.
  assert.deepEqual(
    telnyxVoice.assignCostRecords(pool, { legId: CALL_CONTROL_ID, startedAt: STARTED_AT, endedAt: ENDED_AT }),
    a,
  );
});

test("assignCostRecords: ohne brauchbaren Pool -> ok:false (pool_missing), nie eine leere Messung", () => {
  const res = telnyxVoice.assignCostRecords({ ok: false, reason: "provider_error" }, WINDOW);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "pool_missing");
  assert.equal(res.records, undefined);
  assert.doesNotThrow(() => telnyxVoice.assignCostRecords(undefined, WINDOW));
});

// ---- (c) HTTP 500 und Timeout ----

test("Belegabruf: HTTP 500 -> ok:false, records undefined, kein Wurf", async () => {
  stubFetchFailure({ status: 500, body: {} });
  await assert.doesNotReject(async () => {
    const res = await fetchAndAssign(WINDOW);
    assert.equal(res.ok, false);
    assert.equal(res.records, undefined);
    // ok:false ist NICHT die leere Menge - "0 Records gefunden" waere ok:true mit [].
    assert.notEqual(res.records?.length, 0);
  });
});

test("Belegabruf: rejectendes fetch (Netzfehler/Timeout) -> ok:false, kein Wurf", async () => {
  global.fetch = async () => {
    throw new Error("network timeout");
  };
  await assert.doesNotReject(async () => {
    const res = await fetchAndAssign(WINDOW);
    assert.equal(res.ok, false);
    assert.equal(res.records, undefined);
    assert.notEqual(res.records?.length, 0);
  });
});

// ---- (c2) KE-P0: der Fehlerpfad ist sichtbar (Status + Telnyx-Code, PII-frei) ----

// GEMESSENE Antwort des Belegabrufs bei ueberschrittenem Minutenkontingent (Plan F1):
// HTTP 429 mit Telnyx-Code 10011. Der Envelope traegt bewusst GIFT in `detail` (Key-Form,
// Rufnummer, Session-ID) - das ist hier das Gegenstueck zur Koeder-Pflicht: Felder, die der
// Code NICHT verwenden darf. Faende sich eines davon in der Log-Zeile, waere der Leak-Test
// rot; ein Test, der nur wegen des Koeders gruen liefe, gibt es hier nicht, weil die Zeile
// exakt verglichen wird.
const RATE_LIMIT_STATUS = 429;
const RATE_LIMIT_CODE = "10011";
const LEAK_NUMBER = "+4915112345678";
const POISONED_DETAIL = `Bearer ${API_KEY} from=${LEAK_NUMBER} session=${SESSION_ID}`;
const RATE_LIMIT_BODY = {
  secret_key: API_KEY, // top-level-Gift: darf ebenfalls nirgends auftauchen
  errors: [{ code: RATE_LIMIT_CODE, title: "Too many requests", detail: POISONED_DETAIL }],
};
// Der Abruf bricht beim ERSTEN scheiternden Typ ab (kein Teil-Erfolg) -> genau EINE Zeile,
// und zwar fuer den ersten ABGEFRAGTEN Typ (KE-P3: ASSIGNABLE_COST_RECORD_TYPES, nicht mehr
// COST_RECORD_TYPES) - heute wie morgen "sip-trunking", aber ehrlich hergeleitet statt an
// der ungefilterten Liste (keine zweite Quelle der Reihenfolge).
const FIRST_RECORD_TYPE = ASSIGNABLE_COST_RECORD_TYPES[0];

const failureLines = (lines) => lines.filter((l) => l.includes("getVoiceCostRecords fehler"));

// KE-P4: ein 429 wird GENAU EINMAL wiederholt (nach dem Reset ist das Fenster frei). Die
// Fehler-Zeile erscheint deshalb je Versuch - zweimal, nie mehr. Mehr waere eine Schleife
// gegen ein Kontingent.
const ATTEMPTS_PER_RATE_LIMITED_PAGE = 2;

test("Belegabruf: 429 loggt Provider-Status und Telnyx-Code (Fehlerpfad sichtbar)", async () => {
  stubFetchFailure({ status: RATE_LIMIT_STATUS, body: RATE_LIMIT_BODY });
  const lines = await captureConsole(() => fetchAndAssign(WINDOW));
  const expected = `[telnyx/voice] getVoiceCostRecords fehler typ=${FIRST_RECORD_TYPE} `
    + `status=${RATE_LIMIT_STATUS} code=${RATE_LIMIT_CODE}`;
  assert.deepEqual(
    failureLines(lines),
    Array.from({ length: ATTEMPTS_PER_RATE_LIMITED_PAGE }, () => expected),
  );
});

// Die Zeile ist eine Betriebs-Sonde: sie landet dauerhaft im Render-Log. Regel 4/5 -
// Fragmente werden ueber ein LABEL gemeldet, nie ueber ihren Wert (sonst leakte die
// Fehlermeldung des Tests genau das, was sie verbietet).
const FORBIDDEN_IN_FAILURE_LINE = Object.freeze([
  ["API-Key", API_KEY],
  ["Bearer-Praefix", "Bearer"],
  ["Rufnummer", LEAK_NUMBER],
  ["Session-ID", SESSION_ID],
  ["Anker (call_control_id)", CALL_CONTROL_ID],
  ["Leg-UUID", TELNYX_LEG_ID],
  ["Telnyx-detail", "quota"],
]);

test("Belegabruf: die Fehler-Zeile leakt weder Key noch Rufnummer noch Session-/Leg-ID", async () => {
  stubFetchFailure({ status: RATE_LIMIT_STATUS, body: RATE_LIMIT_BODY });
  const lines = await captureConsole(() => fetchAndAssign(WINDOW));
  const [line] = failureLines(lines);
  assert.ok(line, "Fehler-Zeile fehlt");
  for (const [label, fragment] of FORBIDDEN_IN_FAILURE_LINE)
    assert.ok(!line.includes(fragment), `${label} darf nicht in der Fehler-Zeile stehen`);
});

test("Belegabruf: Netzfehler ohne HTTP-Antwort -> Zeile erscheint mit neutralem Platzhalter", async () => {
  global.fetch = async () => {
    throw new Error("network timeout");
  };
  const lines = await captureConsole(() => fetchAndAssign(WINDOW));
  assert.deepEqual(failureLines(lines), [
    `[telnyx/voice] getVoiceCostRecords fehler typ=${FIRST_RECORD_TYPE} status=none code=none`,
  ]);
});

test("Belegabruf: 429 laesst Rueckgabe und Kontrollfluss unveraendert (ok:false, provider_error)", async () => {
  stubFetchFailure({ status: RATE_LIMIT_STATUS, body: RATE_LIMIT_BODY });
  const res = await captureConsole(() => fetchAndAssign(WINDOW)).then(
    () => fetchAndAssign(WINDOW),
  );
  assert.equal(res.ok, false);
  assert.equal(res.reason, "provider_error");
  assert.equal(res.records, undefined, "ok:false ist NIE die leere Menge");
});

// ---- (d) Fremdwaehrung ----

test("Belegabruf: fremde Waehrung wird verworfen, gleiche Waehrung kleingeschrieben akzeptiert", async () => {
  // Der EUR-Beleg traegt den Anker und waere zuordenbar - er faellt trotzdem weg. Das pinnt
  // die Reihenfolge Waehrung-vor-Zuordnung in toCostRecord.
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401", currency: "EUR" })],
  });
  const eurRes = await fetchAndAssign(WINDOW);
  assert.equal(eurRes.ok, true);
  assert.equal(eurRes.records.length, 0, "EUR-Record bei PROVIDER_CURRENCY=USD verworfen");

  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401", currency: "usd" })],
  });
  const usdRes = await fetchAndAssign(WINDOW);
  assert.equal(usdRes.ok, true);
  assert.equal(usdRes.records.length, 1, "Kleingeschriebenes 'usd' case-insensitiv akzeptiert");
});

// ---- (e) Grenzfaelle des Seams ----

test("Belegabruf: fehlender legId -> ok:false, reason params_missing", async () => {
  stubFetchByRecordType({});
  const res = await fetchAndAssign({ startedAt: STARTED_AT, endedAt: ENDED_AT });
  assert.equal(res.ok, false);
  assert.equal(res.reason, "params_missing");
});

test("Belegabruf: fehlender startedAt/endedAt -> ok:false, reason params_missing", async () => {
  stubFetchByRecordType({});
  assert.equal(
    (await fetchAndAssign({ legId: CALL_CONTROL_ID, endedAt: ENDED_AT })).reason,
    "params_missing",
  );
  assert.equal(
    (await fetchAndAssign({ legId: CALL_CONTROL_ID, startedAt: STARTED_AT })).reason,
    "params_missing",
  );
});

test("Belegabruf: fehlende Config (TELNYX_API_KEY) -> ok:false, reason config_missing", async () => {
  stubFetchByRecordType({});
  await withBlankedConfig("telnyxApiKey", async () => {
    const res = await fetchAndAssign(WINDOW);
    assert.equal(res.ok, false);
    assert.equal(res.reason, "config_missing");
  });
});

test("Belegabruf: kein Anker in der Antwort -> LEERE Liste, ok:true, kein Wurf (fail-closed)", async () => {
  stubRealRecords({ ids: FOREIGN_IDS });
  await assert.doesNotReject(async () => {
    const res = await fetchAndAssign(WINDOW);
    assert.equal(res.ok, true);
    assert.deepEqual(res.records, [], "ohne Anker wird NICHTS akzeptiert - kein lockererer Fallback");
  });
});

// KEINE gemessene Form (real traegt sip-trunking immer beide Felder), sondern ein Provider-
// Drift-Grenzfall: faellt das Session-Feld weg, bleibt der Anker Identitaetsgleichheit auf
// UNSERER eigenen, global eindeutigen ID - verwerfen waere Datenverlust ohne Sicherheits-
// gewinn. Ohne diesen Test bliebe der direkte Anker-Zweig ungepinnt (alle anderen Fixtures
// tragen zusaetzlich die passende Session und wuerden ihn nicht bemerken).
test("Belegabruf: Beleg MIT Anker aber OHNE Session-Referenz wird akzeptiert", async () => {
  const anchorOnly = realRecord("sip-trunking", { cost: "0.0401" });
  delete anchorOnly.telnyx_session_id;
  stubFetchByRecordType({ "sip-trunking": [anchorOnly] });
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 1, "Identitaetsgleichheit auf call_control_id genuegt");
  assert.equal(res.records[0].legId, CALL_CONTROL_ID);
});

test("Belegabruf: Belege einer FREMDEN Session kommen NIE mit (Tenant-Trennung)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401" })],
    "call-control": [
      realRecord("call-control", { cost: "0.001" }),
      realRecord("call-control", { cost: "9.99", ids: FOREIGN_IDS }),
    ],
  });
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 2, "nur die zwei eigenen Belege");
  const sum = res.records.reduce((acc, r) => acc + r.costMicroCents, 0);
  assert.equal(sum, 4110000); // 4010000 + 100000, der fremde Beleg (999000000) fehlt
  assert.ok(
    !res.records.some((r) => r.costMicroCents === 999000000),
    "ein fremder Beleg waere eine Fehlbuchung auf einen fremden Tenant",
  );
});

// LCT-FIX-1: die Gegenprobe zum Test darueber auf dem ZWEITEN Session-Feldnamen. Der
// fremde Beleg ist ein speech-to-text-Record, der NUR eine call_session_id fuehrt - genau
// die Form, die die (im Repo unbelegte) Gleichsetzung der beiden Session-Felder betrifft.
// Der Test pinnt, was die Zuordnung wirklich zusichert: auch ueber call_session_id wird
// NUR akzeptiert, was in der vom Anker aufgespannten Menge liegt. Ohne diese Zeile bliebe
// der call_session_id-Zweig einseitig gepinnt (nur der Treffer-, nie der Ablehnungsfall).
test("Belegabruf: fremde `call_session_id` kommt NIE mit (Zuordnung bleibt fail-closed)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401" })], // Anker + eigene Session
    "speech-to-text": [
      realRecord("speech-to-text", { cost: "0.0000" }),
      realRecord("speech-to-text", { cost: "9.99", ids: FOREIGN_IDS }),
    ],
  });
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 2, "nur Anker-Beleg + eigener speech-to-text-Beleg");
  assert.ok(
    !res.records.some((r) => r.costMicroCents === 999000000),
    "eine fremde call_session_id waere eine Fehlbuchung auf einen fremden Tenant",
  );
});

// LCT-FIX-1 / G27: haelt die Adapter-Konstante gegen die gemessenen Belegformen. Der
// Boot-Guard lehnt genau diese Typen als Pflicht-Typ ab - waere die Liste zu kurz, koennte
// ein unerfuellbarer Pflicht-Typ durchrutschen (dauerhaft 'incomplete': keine
// Rueckerstattung, jede Nachforderung gebucht); waere sie zu lang, verboete der Boot einen
// zuordenbaren Typ ohne Grund. Beide Richtungen werden geprueft.
// Die Kopplung, ohne die der Deckungstest darunter nur die Test-Kopie prueft: kaeme ein Typ
// in COST_RECORD_TYPES dazu, den die Feld-Tabelle nicht kennt, bliebe der Deckungstest gruen,
// waehrend die abgeleitete Zuordenbarkeits-Allowlist des Boot-Guards ihn stillschweigend
// mitfuehrt (moeglicherweise als dauerhaft unerfuellbaren Pflicht-Typ).
test("die Feld-Tabelle deckt GENAU das Produktions-Enum COST_RECORD_TYPES ab (keine zweite Quelle)", () => {
  assert.deepEqual(
    Object.keys(ID_FIELDS_BY_RECORD_TYPE).sort(),
    [...COST_RECORD_TYPES].sort(),
    "jeder abgefragte record_type braucht seine gemessene Belegform - und umgekehrt",
  );
});

test("UNASSIGNABLE_COST_RECORD_TYPES deckt sich mit den Belegformen: weder Anker noch Session", () => {
  const hasNoReference = (recordType) => {
    const fields = ID_FIELDS_BY_RECORD_TYPE[recordType](OWN_IDS);
    return !fields.call_control_id && !fields.telnyx_session_id && !fields.call_session_id;
  };
  assert.deepEqual(
    Object.keys(ID_FIELDS_BY_RECORD_TYPE).filter(hasNoReference).sort(),
    [...UNASSIGNABLE_COST_RECORD_TYPES].sort(),
    "genau die Typen ohne jede Referenz gehoeren in UNASSIGNABLE_COST_RECORD_TYPES",
  );
  assert.ok(SESSION_ONLY_RECORD_TYPES.length > 0, "ohne Session-only-Typen pruefte Stufe 2 nichts");
});

// KE-P3: `inference` wird nicht mehr abgerufen (s. P3-9) - die Zusage "bleibt unzuordenbar"
// gilt trotzdem, nur eine Ebene tiefer: assignCostRecords bekommt den Pool direkt (kein
// Abruf noetig), genau wie ein Sweep ihn faende, haette ihn ein aelterer Pool doch getragen.
test("assignCostRecords: ein Beleg ohne jede Referenz (inference-Form) bleibt unzuordenbar", () => {
  const pool = {
    ok: true,
    complete: true,
    raw: [
      realRecord("sip-trunking", { cost: "0.0401" }),
      realRecord("inference", { cost: "0.001315" }),
    ],
  };
  const res = telnyxVoice.assignCostRecords(pool, WINDOW);
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 1);
  assert.equal(res.records[0].recordType, "sip-trunking");
});

// Der Fensterfilter greift NUR auf einem der geratenen Kandidaten-Feldnamen
// (RECORD_TIMESTAMP_FIELDS). `recorded_at` ist ein solcher Name - er stammt NICHT aus der
// Messung 2026-07-21, dieser Test pinnt also bewusst nur den Codepfad, nicht die
// Wirklichkeit. Der Test darunter haelt fest, was auf den GEMESSENEN Belegformen gilt.
test("Belegabruf: Beleg mit geratenem Zeitstempel-Feld ausserhalb des Fensters wird verworfen (recorded_at)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [
      realRecord("sip-trunking", { cost: "0.0401", extraFields: { recorded_at: "2026-07-20T09:00:00Z" } }),
    ],
  });
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 0, "geratenes Zeitstempel-Feld ausserhalb des Fensters -> verworfen");
});

// LCT-FIX-1 (Runde 3): die EHRLICHE Zusicherung. Das einzige gemessene Zeitfeld ist
// `started_at` (sip-trunking, Messung 2026-07-21) und es steht bewusst NICHT in
// RECORD_TIMESTAMP_FIELDS - auf der gemessenen Belegform filtert das Zeitfenster also
// NICHTS. Damit ist es KEINE zweite Linie hinter der Zuordnung; bei parallel laufenden
// Calls traegt allein die Call-Lokalitaet der Session (konto-weit gemessen 2026-07-21,
// aber nie unter Parallelverkehr - s. tasks/lct-DEPLOY-CHECKLIST.md).
// Der Test faellt, sobald jemand `started_at` aufnimmt - dann ist diese Aussage in
// voice.js und in tasks/lct-DEPLOY-CHECKLIST.md neu zu bewerten, statt still zu veralten.
test("Belegabruf: gemessenes started_at ausserhalb des Fensters filtert NICHT (Zeitfenster ist keine zweite Linie)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [
      realRecord("sip-trunking", { cost: "0.0401", extraFields: { started_at: "2026-07-20T09:00:00Z" } }),
    ],
  });
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.ok, true);
  assert.equal(res.records.length, 1, "der Anker traegt den Beleg - das Zeitfenster greift auf started_at nicht");
});

// ---- (e2) Falsifikations-Sonde: das Log-Format der Deploy-Auflage ----

// captureConsole (test/helpers.js) faengt console.log UND console.warn eines Aufrufs ab und
// restauriert immer, auch beim Wurf (F.I.R.S.T./Independent) - EINE Quelle statt einer
// lokalen Kopie. Der Erfolgs-Log laeuft ueber console.log, die Fehler-Spur ueber console.warn.

function costRecordsLogLine(lines) {
  return lines.find((l) => l.includes("getVoiceCostRecords ok"));
}

// An dieser Zeile haengt die laufende Beobachtung der Session-Invariante
// (tasks/lct-DEPLOY-CHECKLIST.md): sie ist das einzige Instrument, das eine nicht
// call-lokale Session IM BETRIEB sichtbar machen wuerde - die konto-weite Messung
// deckt Parallelverkehr nicht ab. Ungepinnt zerbraeche sie still an einem geaenderten
// Format. Die drei via_-Spalten
// kommen aus den Fixtures: Anker = sip-trunking + ai-voice-assistant, telnyx_session_id =
// call-control + recording, call_session_id = speech-to-text + text-to-speech. `inference`
// wird ab KE-P3 nicht mehr abgerufen (s. P3-9) - rejected bleibt deshalb LEER, statt einen
// session_unresolved-Eintrag zu tragen: der Beleg erreicht den Pool gar nicht erst.
test("Belegabruf: Log-Zeile zaehlt je Zuordnungsweg getrennt (Sonde der Deploy-Auflage)", async () => {
  stubRealRecords();
  const lines = await captureConsole(() => fetchAndAssign(WINDOW));
  assert.equal(
    costRecordsLogLine(lines),
    `[telnyx/voice] getVoiceCostRecords ok records=${ASSIGNABLE_RECORD_COUNT} `
      + "via_anchor=2 via_telnyx_session_id=2 via_call_session_id=2 "
      + "rejected={}",
  );
});

// Die Spalten muessen auch dann vollzaehlig dastehen, wenn ein Weg nichts beigetragen hat -
// eine je nach Datenlage verschwindende Spalte macht die Sonde unlesbar (fehlt sie, ist
// "0 Belege ueber dieses Feld" nicht von "Format geaendert" zu unterscheiden).
test("Belegabruf: Log-Zeile meldet jeden Zuordnungsweg auch mit 0 (kein Anker gefunden)", async () => {
  stubRealRecords({ ids: FOREIGN_IDS });
  const lines = await captureConsole(() => fetchAndAssign(WINDOW));
  assert.equal(
    costRecordsLogLine(lines),
    "[telnyx/voice] getVoiceCostRecords ok records=0 "
      + "via_anchor=0 via_telnyx_session_id=0 via_call_session_id=0 "
      + `rejected={"session_mismatch":${ASSIGNABLE_RECORD_COUNT}}`,
  );
});

// ---- (e3) KE-P1: Vollstaendigkeit kommt aus der ANTWORT, nicht aus der Anforderung ----

// GEMESSENE Werte (Plan F5 / Spec A1, Messung 2026-07-21) - bewusst LITERALE hier und
// NICHT die Produktions-Konstante COST_RECORDS_PAGE_SIZE: ein Test, der die eigene
// Konstante spiegelt, prueft nur sich selbst. Genau das war die abgeloeste 250er-Fixture -
// sie war gruen, weil 250 === 250, und sagte ueber die Wirklichkeit nichts.
const MEASURED_PAGE_SIZE = 50; // page[size] deckelt hart bei 50 (250/100/50 -> immer 50)
const MEASURED_PAGED_META = Object.freeze({ total_results: 212, total_pages: 5, page_size: 50 });
const MEASURED_SINGLE_PAGE_META = Object.freeze({ total_results: 50, total_pages: 1, page_size: 50 });

// Eine volle Seite call-control-Belege. Der Typ traegt in der Messung KEINEN Anker
// (call_control_id), sondern telnyx_leg_id + telnyx_session_id - der KOEDER kommt damit
// aus der gemessenen Form selbst, ohne ein Feld zu erfinden. Er zeigt hier auf eine FREMDE
// Leg-UUID: wuerde der Code telnyx_leg_id als Zuordnungsquelle benutzen, kaeme KEINER
// dieser 50 Belege herein und jede Erwartung unten waere falsch.
function fullCallControlPage() {
  return Array.from({ length: MEASURED_PAGE_SIZE }, () =>
    realRecord("call-control", { cost: "0.001", ids: { ...OWN_IDS, legUuid: FOREIGN_LEG_ID } }),
  );
}

// Der Anker-Beleg, der die Session ueberhaupt erst aufspannt (Stufe 1). Ohne ihn waere
// jede Zaehlung unten trivial 0 und der Test bewiese nichts ueber die Untermenge.
const anchorPage = () => [realRecord("sip-trunking", { cost: "0.0401", billedSec: 60 })];

// Gegenprobe zur Fail-closed-Richtung. Sagt die Antwort selbst, dass es nur diese eine
// Seite gibt, bleibt sie vollstaendig - sonst waere jede exakt 50 Belege grosse Menge
// dauerhaft unmessbar (Deckungsquote 0 %, keine Rueckerstattung mehr, jede Nachforderung
// gebucht: einseitige Korrektur zulasten des Kunden).
test("Belegabruf: volle Seite mit meta.total_pages=1 bleibt vollstaendig", async () => {
  const calls = stubFetchByRecordType({
    "sip-trunking": anchorPage(),
    "call-control": { records: fullCallControlPage(), meta: MEASURED_SINGLE_PAGE_META },
  });
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.ok, true);
  assert.equal(
    res.records.length,
    1 + MEASURED_PAGE_SIZE,
    "Anker-Beleg + alle 50 nur ueber die Session gefundenen call-control-Belege",
  );
  // Gegenprobe zur Seitenschleife: meta sagt "nur diese eine Seite" -> keine zweite Anfrage.
  assert.deepEqual(pageNumbersFor(calls, "call-control"), [1]);
});

// KE-P3: die Seite war (mangels meta) UNBEWIESEN vollstaendig - vor P3 hiess das fail-closed
// (page_truncated, s. Bestandsbericht KE-P1). Ab P3 wird der Beweis stattdessen EMPIRISCH
// erbracht: die Seitenschleife blaettert nach, bis die naechste (kurze) Seite das Ende
// zeigt. Das ist mehr Wissen, nicht weniger - P3-2/P3-2b decken den Fall ab, dass die
// Folgeseiten NIE enden (dann bleibt es bei complete:false, s. dort).
test("(P3-2c) volle Seite OHNE meta wird nachgeblaettert; erst die kurze Folgeseite beweist das Ende", async () => {
  const calls = stubFetchPages({
    "sip-trunking": [anchorPage()],
    "call-control": [fullCallControlPage(), []], // Seite 2 ist LEER - die kurze Folgeseite
  });
  const res = await fetchAndAssign(WINDOW);
  assert.deepEqual(pageNumbersFor(calls, "call-control"), [1, 2]);
  assert.equal(res.ok, true);
  assert.equal(
    res.records.length,
    1 + MEASURED_PAGE_SIZE,
    "Anker-Beleg + alle 50 call-control-Belege der ersten Seite (Seite 2 traegt keine weiteren)",
  );
});

// ---- (h) KE-P3: Seitenschleife ohne geratene Filternamen ----

// GEMESSENE Zeitpunkte fuer die since-Tests: IN_WINDOW_AT liegt im Anrufsfenster (WINDOW),
// BEFORE_SINCE/AFTER_SINCE liegen vor/nach der since-Grenze SINCE_BOUNDARY.
const IN_WINDOW_AT = STARTED_AT;
const SINCE_BOUNDARY = "2026-07-20T09:00:00Z";
const BEFORE_SINCE = "2026-07-20T08:00:00Z";
const AFTER_SINCE = "2026-07-20T10:00:00Z";
const BILLED_CC_COST = "0.001"; // -> 100000 Mikro-Cent (dieselbe Rate wie fullCallControlPage)
const BILLED_CC_MICRO = 100_000;

// KOEDER aus der GEMESSENEN Form selbst: call-control fuehrt telnyx_leg_id + telnyx_session_id
// und NIE einen Anker. Die Leg-UUID zeigt auf eine FREMDE Leg - benutzte der Code sie als
// Zuordnungsquelle, kaeme keiner dieser Belege herein und jede Erwartung unten waere falsch.
// Genau dieser Feldname hat live 297 von 297 Belegen verworfen (LCT-FIX-1).
function pagedCallControlRecord({ cost, billedSec, startedAt = IN_WINDOW_AT }) {
  return realRecord("call-control", {
    cost,
    billedSec,
    ids: { ...OWN_IDS, legUuid: FOREIGN_LEG_ID },
    extraFields: { started_at: startedAt, call_sec: billedSec },
  });
}

// Das gemessene PAAR je Anruf (A2 Null-Zwilling-Pflicht): der Anker haengt am ersten Bein,
// der abgerechnete Betrag am zweiten - eines der beiden Beine ist ECHT null. Wer je Typ nur
// den ersten Treffer nimmt, verliert 0,0401 USD und erstattet ausgegebenes Geld zurueck.
function sipTrunkingLegPair() {
  return [
    realRecord("sip-trunking", { cost: "0.0", billedSec: 0, extraFields: { started_at: IN_WINDOW_AT, call_sec: 0 } }),
    secondLegRecord("sip-trunking", { cost: "0.0401", billedSec: 60, extraFields: { started_at: IN_WINDOW_AT, call_sec: 60 } }),
  ];
}

// GEMESSENE meta aus Spec A1: {total_results:212, total_pages:5, page_size:50}. 212 = 4x50 +
// 12, die letzte Seite ist also kurz - derselbe Grenzfall wie oben, nur mit der WIRKLICH
// gemessenen Zahl (A2: Fixtures spiegeln nur Gemessenes).
const PAGED_LAST_PAGE_COUNT =
  MEASURED_PAGED_META.total_results - (MEASURED_PAGED_META.total_pages - 1) * MEASURED_PAGE_SIZE; // 12

function fivePagedCallControlPages() {
  const billed = () => pagedCallControlRecord({ cost: BILLED_CC_COST, billedSec: 60 });
  const full = () => ({ records: Array.from({ length: MEASURED_PAGE_SIZE }, billed), meta: MEASURED_PAGED_META });
  return [
    full(), full(), full(), full(),
    {
      records: [
        ...Array.from({ length: PAGED_LAST_PAGE_COUNT - 1 }, billed),
        pagedCallControlRecord({ cost: "0.0", billedSec: 0 }), // Null-Zwilling auf der LETZTEN Seite
      ],
      meta: MEASURED_PAGED_META,
    },
  ];
}

test("(P3-1) Seitenschleife sammelt ALLE Seiten eines Typs (212 Belege, letzte Seite kurz)", async () => {
  const calls = stubFetchPages({
    "sip-trunking": [sipTrunkingLegPair()],
    "call-control": fivePagedCallControlPages(),
  });
  const res = await fetchAndAssign(WINDOW);
  assert.deepEqual(pageNumbersFor(calls, "call-control"), [1, 2, 3, 4, 5]);
  assert.equal(res.ok, true);
  const ccRecords = res.records.filter((r) => r.recordType === "call-control");
  assert.equal(ccRecords.length, MEASURED_PAGED_META.total_results);
  assert.equal(res.records.length, MEASURED_PAGED_META.total_results + 2, "212 call-control + 2 sip-trunking (Null-Zwilling + abgerechnet)");
  const expectedSum = (MEASURED_PAGED_META.total_results - 1) * BILLED_CC_MICRO + 4_010_000;
  assert.equal(sumMicroCents(res), expectedSum, "211 abgerechnete call-control-Belege + der abgerechnete sip-trunking-Beleg, zwei echte Nullen tragen 0 bei");
  assert.equal(res.records.filter((r) => r.costMicroCents === 0).length, 2, "beide Null-Zwillinge sind mitgezaehlt");
});

// 99 identische volle Seiten OHNE Chance, ueber meta.total_pages als vollstaendig zu gelten
// (meta.total_pages bleibt immer 99) - erzwingt die Seitenobergrenze.
function manyFullSipTrunkingPages(count) {
  const meta = { total_results: count * MEASURED_PAGE_SIZE, total_pages: count, page_size: MEASURED_PAGE_SIZE };
  const fullPage = () => ({
    records: Array.from({ length: MEASURED_PAGE_SIZE }, () => realRecord("sip-trunking", { cost: BILLED_CC_COST, billedSec: 60 })),
    meta,
  });
  return Array.from({ length: count }, fullPage);
}

test("(P3-2) Seitenobergrenze erreicht -> complete:false (bewiesene Untermenge, ok bleibt true)", async () => {
  const totalPages = 99;
  const calls = stubFetchPages({ "sip-trunking": manyFullSipTrunkingPages(totalPages) });
  const pool = await fetchPool();
  assert.equal(pool.ok, true);
  assert.equal(pool.complete, false);
  const pageNumbers = pageNumbersFor(calls, "sip-trunking");
  assert.deepEqual(pageNumbers, Array.from({ length: pageNumbers.length }, (_, i) => i + 1), "lueckenlos ab Seite 1");
  assert.ok(pageNumbers.length > 1 && pageNumbers.length < totalPages, "bindet die Obergrenze nach oben, ohne die Konstante zu spiegeln");
  assert.equal(calls.length, pageNumbers.length, "der erste unvollstaendige Typ bricht ab - keine weiteren Typen angefragt");
});

test("(P3-2b) volle Seiten OHNE meta laufen nicht endlos -> complete:false", async () => {
  const totalPages = 99;
  const plainPages = Array.from({ length: totalPages }, () =>
    Array.from({ length: MEASURED_PAGE_SIZE }, () => realRecord("sip-trunking", { cost: BILLED_CC_COST, billedSec: 60 })),
  );
  const calls = stubFetchPages({ "sip-trunking": plainPages });
  const pool = await fetchPool();
  assert.equal(pool.complete, false);
  assert.ok(pageNumbersFor(calls, "sip-trunking").length < totalPages);
});

// call-control-Belege ohne (P3-6) bzw. mit dem gemessenen (P3-7/P3-8) Zeitfeld, in Seiten
// zu je MEASURED_PAGE_SIZE. meta traegt total_pages=3, damit die dritte Seite - erreichte
// die Schleife sie ueberhaupt - regulaer als letzte Seite endet.
function threeFullPages(recordFactory) {
  const meta = { total_results: 3 * MEASURED_PAGE_SIZE, total_pages: 3, page_size: MEASURED_PAGE_SIZE };
  return Array.from({ length: 3 }, () => ({
    records: Array.from({ length: MEASURED_PAGE_SIZE }, recordFactory),
    meta,
  }));
}

function ccRecordWithoutTimestamp() {
  return realRecord("call-control", { cost: BILLED_CC_COST, billedSec: 60, ids: { ...OWN_IDS, legUuid: FOREIGN_LEG_ID } });
}

// Eine Seite, deren ERSTER Beleg vor `since` liegt und deren RESTLICHE Belege danach -
// gefolgt von einer Seite, die VOLLSTAENDIG vor `since` liegt. Prueft beide Richtungen der
// "ganze Seite, nie erster Record"-Regel: P3-4 zeigt, dass Seite 1 die Schleife NICHT
// vorzeitig beendet; P3-5 zeigt, dass Seite 2 sie sehr wohl beendet (Seite 3 bleibt ungeholt).
function unsortedCallControlPages() {
  const meta = { total_results: 3 * MEASURED_PAGE_SIZE, total_pages: 3, page_size: MEASURED_PAGE_SIZE };
  const page1 = [
    pagedCallControlRecord({ cost: BILLED_CC_COST, billedSec: 60, startedAt: BEFORE_SINCE }),
    ...Array.from({ length: MEASURED_PAGE_SIZE - 1 }, () =>
      pagedCallControlRecord({ cost: BILLED_CC_COST, billedSec: 60, startedAt: AFTER_SINCE })),
  ];
  const page2 = Array.from({ length: MEASURED_PAGE_SIZE }, () =>
    pagedCallControlRecord({ cost: BILLED_CC_COST, billedSec: 60, startedAt: BEFORE_SINCE }));
  const page3 = Array.from({ length: MEASURED_PAGE_SIZE }, () =>
    pagedCallControlRecord({ cost: BILLED_CC_COST, billedSec: 60, startedAt: AFTER_SINCE }));
  return [{ records: page1, meta }, { records: page2, meta }, { records: page3, meta }];
}

test("(P3-4) unsortierte Seite (erster Beleg ausserhalb, Rest innerhalb) bricht die Schleife NICHT ab", async () => {
  const calls = stubFetchPages({ "call-control": unsortedCallControlPages() });
  await fetchPool({ since: SINCE_BOUNDARY });
  assert.ok(pageNumbersFor(calls, "call-control").includes(2), "Seite 2 wurde angefordert - Seite 1 hat die Schleife nicht vorzeitig beendet");
});

test("(P3-5) eine GANZE Seite vor 'since' beendet die Seitenschleife", async () => {
  const calls = stubFetchPages({ "call-control": unsortedCallControlPages() });
  const pool = await fetchPool({ since: SINCE_BOUNDARY });
  assert.deepEqual(pageNumbersFor(calls, "call-control"), [1, 2], "Seite 3 wird nie geholt");
  assert.equal(pool.complete, true, "das Fenster wurde verlassen - das ist keine Untermenge");
});

test("(P3-6) Beleg OHNE gemessenes Zeitfeld gilt als innerhalb - die Schleife laeuft weiter", async () => {
  const calls = stubFetchPages({ "call-control": threeFullPages(ccRecordWithoutTimestamp) });
  await fetchPool({ since: SINCE_BOUNDARY });
  assert.deepEqual(pageNumbersFor(calls, "call-control"), [1, 2, 3]);
});

// speech-to-text traegt sein Zeitfeld gemessen unter `start_time`, NICHT `started_at`
// (Spec A1). `started_at` ist hier der KOEDER: liest der Code das Zeitfeld generisch statt
// je Typ, endet er faelschlich nach Seite 1.
function sttRecordAt(field, value) {
  return realRecord("speech-to-text", {
    cost: "0.0000",
    ids: { ...OWN_IDS, legUuid: FOREIGN_LEG_ID },
    extraFields: { [field]: value },
  });
}

test("(P3-7) das Zeitfeld wird JE TYP gelesen: 'started_at' an speech-to-text ist KEIN Zeitfeld", async () => {
  const calls = stubFetchPages({
    "speech-to-text": threeFullPages(() => sttRecordAt("started_at", BEFORE_SINCE)),
  });
  await fetchPool({ since: SINCE_BOUNDARY });
  assert.deepEqual(pageNumbersFor(calls, "speech-to-text"), [1, 2, 3], "started_at ist auf speech-to-text kein Zeitfeld - die Schleife liest es nicht");
});

test("(P3-8) 'start_time' vor 'since' beendet die speech-to-text-Schleife (das gemessene Feld greift)", async () => {
  const calls = stubFetchPages({
    "speech-to-text": threeFullPages(() => sttRecordAt("start_time", BEFORE_SINCE)),
  });
  await fetchPool({ since: SINCE_BOUNDARY });
  assert.deepEqual(pageNumbersFor(calls, "speech-to-text"), [1], "start_time ist das gemessene Zeitfeld - die Schleife endet nach Seite 1");
});

test("(P3-9) abgerufene Typenmenge ist GENAU ASSIGNABLE_COST_RECORD_TYPES - inference wird nie angefragt", async () => {
  const calls = stubRealRecords(); // bietet inference weiterhin an (Koeder auf Fixture-Ebene)
  await fetchAndAssign(WINDOW);
  const requestedTypes = calls.map((c) => new URL(c.url).searchParams.get("filter[record_type]"));
  assert.deepEqual(new Set(requestedTypes), new Set(ASSIGNABLE_COST_RECORD_TYPES));
  assert.equal(calls.length, ASSIGNABLE_COST_RECORD_TYPES.length);
  for (const forbidden of UNASSIGNABLE_COST_RECORD_TYPES)
    assert.ok(!requestedTypes.includes(forbidden), `${forbidden} darf nie angefragt werden`);
});

test("(P3-10) die Query traegt AUSSCHLIESSLICH filter[record_type], page[size]=50, page[number] - nie einen Zeitfilter", async () => {
  const calls = stubRealRecords();
  await fetchPool({ since: "2026-07-20T00:00:00Z" });
  assert.equal(calls.length, ASSIGNABLE_COST_RECORD_TYPES.length);
  for (const c of calls) {
    const params = new URL(c.url).searchParams;
    assert.deepEqual([...params.keys()].sort(), ["filter[record_type]", "page[number]", "page[size]"]);
    assert.equal(params.get("page[size]"), String(MEASURED_PAGE_SIZE));
    assert.equal(params.get("page[number]"), "1");
    for (const key of params.keys())
      assert.ok(!/since|created_at|started_at/.test(key), `verbotener Zeitfilter-Key in der Query: ${key}`);
  }
});

test("(P3-11) die Zeitfeld-Tabelle deckt GENAU die abgerufenen Typen ab (keine zweite Quelle)", () => {
  assert.deepEqual(
    Object.keys(COST_RECORD_TIME_FIELDS).sort(),
    [...ASSIGNABLE_COST_RECORD_TYPES].sort(),
  );
});

// ---- (j) KE-P6: ElevenLabs-Zeichen am Beleg + Boot-Guard-Kopplung ----

// KE-P6 (Aenderung 1): die KOPPLUNG, nicht die Konstante. Die abgerufene Typenmenge wird aus
// den ECHTEN (gestubbten) HTTP-Anfragen abgeleitet und der Boot-Guard dagegen gehalten.
// Eine Assertion, die auf BEIDEN Seiten ASSIGNABLE_COST_RECORD_TYPES einsetzt, pruefte nur,
// dass dieselbe Konstante zweimal importiert wurde - sie koennte eine von Hand gepflegte
// Abruf-Liste (Entkopplung) nicht falsifizieren. Dieser Test kann es.
test("(P6-1) Abruf-Typenmenge und Boot-Guard-Allowlist stammen aus DERSELBEN Quelle", async () => {
  const calls = stubRealRecords(); // bietet ALLE 7 Typen an, auch inference
  await fetchPool();
  const fetched = [...new Set(calls.map((c) => new URL(c.url).searchParams.get("filter[record_type]")))];
  assert.ok(fetched.length > 0, "ohne abgerufene Typen pruefte der Test nichts");

  const guard = (t) => costTruingBookingFindings({
    requiredRecordTypes: [t], assignableRecordTypes: ASSIGNABLE_COST_RECORD_TYPES,
    coveragePercent: 100, minCoveragePercent: 80,
  });
  for (const t of fetched)
    assert.deepEqual(guard(t), [], `abgerufener Typ ${t} muss als Pflicht-Typ zulaessig sein`);
  const notFetched = COST_RECORD_TYPES.filter((t) => !fetched.includes(t));
  assert.ok(notFetched.length > 0, "ohne nicht abgerufenen Typ pruefte die Gegenrichtung nichts");
  for (const t of notFetched)
    assert.equal(guard(t)[0]?.code, COST_TRUING_BOOKING_FINDING.REQUIRED_TYPES_UNASSIGNABLE,
      `nicht abgerufener Typ ${t} muss als Pflicht-Typ FATAL abgelehnt werden`);
});

// GEMESSENE ElevenLabs-Belegform (Plan F6): provider + number_of_characters am
// text-to-speech-Beleg, cost in SCI-Notation. Der Koeder call_leg_id kommt aus der
// gemeinsamen Feld-Tabelle (realRecord) - liest der Code ihn als Zuordnungsquelle, faellt
// jede Erwartung.
const elevenLabsTtsRecord = ({ chars, ids = OWN_IDS, provider = "elevenlabs", cost = "1.666E-4" }) =>
  realRecord("text-to-speech", { cost, ids, extraFields: { provider, number_of_characters: chars } });

test("(P6-2) ElevenLabs-Zeichen reisen am zugeordneten text-to-speech-Beleg mit", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401", billedSec: 60 })], // Anker
    "text-to-speech": [elevenLabsTtsRecord({ chars: 238 })],
  });
  const res = await fetchAndAssign(WINDOW);
  const tts = res.records.find((r) => r.recordType === "text-to-speech");
  assert.equal(tts.ttsCharacters, 238);
  assert.equal(res.records.find((r) => r.recordType === "sip-trunking").ttsCharacters, null,
    "Nicht-TTS-Belege tragen null, nie 0 - 0 waere eine gemessene Null");
});

// (P6-3) war urspruenglich EIN Test mit BEIDEN Bedingungen im selben Beleg
// (chars:"viele", provider:"aws-polly") - "viele" ist fuer sich genommen schon
// unparsbar, "aws-polly" fuer sich genommen schon der falsche Provider. Damit blieb
// der Test gruen, wenn man in elevenLabsCharactersOf NUR den Provider-Waechter ODER
// NUR den record_type-Waechter entfernte - er bestaetigte die eigene Annahme statt
// sie zu falsifizieren (Spec A2). Drei getrennte Faelle, je EINEN Waechter isoliert
// und mit sonst gueltigen Werten - fehlt einer, ist genau ein Fall betroffen:
test("(P6-3a) fremder TTS-Provider zaehlt NICHT auf den ElevenLabs-Zaehler - auch mit gueltiger Menge (Provider-Waechter)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401", billedSec: 60 })],
    "text-to-speech": [elevenLabsTtsRecord({ chars: 238, provider: "aws-polly" })],
  });
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.records.find((r) => r.recordType === "text-to-speech").ttsCharacters, null);
});

test("(P6-3b) eine unparsbare Zeichen-Menge zaehlt NICHT - auch beim echten ElevenLabs-Provider (Parser-Waechter)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401", billedSec: 60 })],
    "text-to-speech": [elevenLabsTtsRecord({ chars: "viele", provider: "elevenlabs" })],
  });
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.records.find((r) => r.recordType === "text-to-speech").ttsCharacters, null);
});

test("(P6-3c) ein Nicht-TTS-Beleg zaehlt NICHT - auch mit elevenlabs-Provider und gueltiger Menge (record_type-Waechter)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", {
      cost: "0.0401", billedSec: 60,
      extraFields: { provider: "elevenlabs", number_of_characters: 99 },
    })],
  });
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.records.find((r) => r.recordType === "sip-trunking").ttsCharacters, null);
});

test("(P6-4) ein NICHT zugeordneter ElevenLabs-Beleg liefert keine Zeichen (fail-closed)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401", billedSec: 60 })],
    "text-to-speech": [elevenLabsTtsRecord({ chars: 999, ids: FOREIGN_POOL_IDS })], // fremde Session
  });
  const res = await fetchAndAssign(WINDOW);
  assert.ok(!res.records.some((r) => r.recordType === "text-to-speech"),
    "fremder Beleg kommt nicht herein - und damit auch seine Zeichen nicht");
});

// ---- (i) KE-P4: Drossel am gemessenen Minutenfenster ----

// 6 Seiten JE zuordenbarem Typ = 6 x 6 = 36 Anfragen - mehr als das Minutenbudget (30) und
// bewusst UNTER der Seitenobergrenze, damit dieser Test nicht an MAX_PAGES_PER_RECORD_TYPE
// haengt. meta ist kohaerent gemessen: 6 Seiten x 50 = 300 Belege.
const THROTTLE_PAGES_PER_TYPE = 6;
const THROTTLE_META = Object.freeze({
  total_results: THROTTLE_PAGES_PER_TYPE * MEASURED_PAGE_SIZE,
  total_pages: THROTTLE_PAGES_PER_TYPE,
  page_size: MEASURED_PAGE_SIZE,
});
const THROTTLE_REQUEST_COUNT = ASSIGNABLE_COST_RECORD_TYPES.length * THROTTLE_PAGES_PER_TYPE; // 36

// KOEDER (A2) aus der GEMESSENEN Form selbst: wo der Typ telnyx_leg_id/call_leg_id fuehrt,
// zeigt die Leg-UUID auf eine FREMDE Leg - benutzte der Code sie, waeren die Erwartungen
// unten falsch. NULL-ZWILLING (A2): der letzte Beleg JEDER Seite ist echt null
// (cost "0.0", billed_sec 0, call_sec 0) - das zweite Bein. Der Test weist nach, dass die
// Drossel keinen Beleg verliert, auch nicht den, an dem die Rueckerstattung haengt.
function throttledPages(recordType) {
  const billed = () => realRecord(recordType, {
    cost: BILLED_CC_COST, billedSec: 60,
    ids: { ...OWN_IDS, legUuid: FOREIGN_LEG_ID }, extraFields: { call_sec: 60 },
  });
  const nullTwin = () => realRecord(recordType, {
    cost: "0.0", billedSec: 0,
    ids: { ...OWN_IDS, legUuid: FOREIGN_LEG_ID }, extraFields: { call_sec: 0 },
  });
  const page = () => ({
    records: [...Array.from({ length: MEASURED_PAGE_SIZE - 1 }, billed), nullTwin()],
    meta: THROTTLE_META,
  });
  return Array.from({ length: THROTTLE_PAGES_PER_TYPE }, page);
}
const throttledPagesByType = () =>
  Object.fromEntries(ASSIGNABLE_COST_RECORD_TYPES.map((t) => [t, throttledPages(t)]));

const requestsPerMinute = (calls) => {
  const byMinute = new Map();
  for (const c of calls) {
    const minute = Math.floor(c.atMs / 60_000);
    byMinute.set(minute, (byMinute.get(minute) || 0) + 1);
  }
  return byMinute;
};

test("(P4-1) hoechstens 30 Anfragen je fixem UTC-Minutenfenster - und kein Beleg geht verloren", async () => {
  const clock = jumpClock();
  const calls = stubFetchPages(throttledPagesByType(), clock);
  const pool = await telnyxVoice.fetchCostRecordPool({ throttle: testThrottle(clock) });

  assert.equal(calls.length, THROTTLE_REQUEST_COUNT, "36 Seiten wurden angefordert");
  const perMinute = [...requestsPerMinute(calls).values()];
  for (const count of perMinute)
    assert.ok(count <= BUDGET_PER_MINUTE, `kein Fenster ueber dem Budget (gesehen: ${count})`);
  assert.deepEqual(perMinute, [BUDGET_PER_MINUTE, THROTTLE_REQUEST_COUNT - BUDGET_PER_MINUTE]);
  assert.equal(clock.now() % 60_000, 0, "die Pause endet exakt auf :00 - das Fenster ist fix, nicht gleitend");
  // Die Drossel darf nur bremsen, nie filtern.
  assert.equal(pool.ok, true);
  assert.equal(pool.complete, true);
  assert.equal(pool.raw.length, THROTTLE_REQUEST_COUNT * MEASURED_PAGE_SIZE);
  assert.equal(pool.raw.filter((r) => r.cost === "0.0").length, THROTTLE_REQUEST_COUNT,
    "jeder Null-Zwilling ist mitgekommen");
});

test("(P4-2) 429 -> GENAU ein Wiederholungsversuch mit dem Wartehinweis des Providers, danach ok:false", async () => {
  const RESET_SECONDS = 17; // gemessen unmittelbar nach dem 429 (Plan F1)
  const calls = stubFetchFailure({
    status: RATE_LIMIT_STATUS, body: RATE_LIMIT_BODY,
    headers: { "x-ratelimit-reset": String(RESET_SECONDS) },
  });
  const clock = jumpClock();
  let pool;
  await captureConsole(async () => {
    pool = await telnyxVoice.fetchCostRecordPool({ throttle: testThrottle(clock) });
  });
  assert.equal(calls.length, ATTEMPTS_PER_RATE_LIMITED_PAGE, "ein Versuch + genau eine Wiederholung");
  assert.deepEqual(pageNumbersFor(calls, FIRST_RECORD_TYPE), [FIRST_PAGE, FIRST_PAGE],
    "die Wiederholung holt DIESELBE Seite - keine wird uebersprungen");
  assert.equal(clock.elapsedMs(), RESET_SECONDS * 1000, "gewartet wurde nach x-ratelimit-reset");
  assert.equal(pool.ok, false);
  assert.equal(pool.reason, "provider_error");
  assert.equal(pool.raw, undefined, "ok:false ist NIE die leere Menge");
});

test("(P4-3) 429 ohne x-ratelimit-reset -> Wartezeit bis zur naechsten vollen Minute aus der eigenen Uhr", async () => {
  const calls = stubFetchFailure({ status: RATE_LIMIT_STATUS, body: RATE_LIMIT_BODY }); // kein Header
  const clock = jumpClock(); // 16:18:30Z -> 30 000 ms bis :00
  await captureConsole(() => telnyxVoice.fetchCostRecordPool({ throttle: testThrottle(clock) }));
  assert.equal(clock.elapsedMs(), 30_000);
  assert.equal(calls.length, ATTEMPTS_PER_RATE_LIMITED_PAGE);
});

// ---- (i2) KE-P4 Runde 2 (Review-Blocker): die PRODUKTIVE Drossel selbst war ungetestet ----
// P4-1/2/3 injizieren je eine EIGENE Drossel (testThrottle, test-lokales BUDGET_PER_MINUTE) -
// der modul-globale Default (detailRecordsThrottle in voice.js, echte Uhr/echter Timer) lief
// nie durch einen Test. Zwei Mutationen blieben dadurch bei gruener Suite unentdeckt:
// DETAIL_RECORDS_RESERVE_PER_MINUTE 10 -> 0 (die Reserve verschwindet, Budget = Limit) und die
// Drossel selbst durch ein wirkungsloses Objekt ersetzt (der Live-Zustand VOR KE-P4). Die
// beiden Tests unten pinnen genau das, OHNE eine eigene Drossel zu injizieren - Mock-Timer
// statt Wanduhr (Muster t.mock.timers aus bridge-openai-event.test.js), damit die Suite
// trotzdem in Millisekunden statt einer echten Minute laeuft (F.I.R.S.T.).

test("(P4-R1) das produktive Minutenbudget behaelt die bewusste Reserve unter dem gemessenen Limit", () => {
  // Pinnt die GEMESSENEN Werte selbst (Plan F1) statt sie ueber eine test-lokale Kopie zu
  // pruefen - eine Reserve-Aenderung (z. B. 10 -> 0) macht diesen Test rot, unabhaengig davon,
  // welche Drossel ein einzelner Aufrufer injiziert.
  assert.equal(DETAIL_RECORDS_LIMIT_PER_MINUTE, 40, "gemessenes Kontingent, Plan F1");
  assert.equal(DETAIL_RECORDS_RESERVE_PER_MINUTE, 10, "bewusste Reserve gegen U5/Uhr-Versatz");
  assert.equal(DETAIL_RECORDS_BUDGET_PER_MINUTE, 30);
});

// GENAU EIN Request UEBER dem produktiven Budget, verteilt ueber ALLE zuordenbaren Typen (nie
// mehr als einer insgesamt): die modul-globale Drossel haengt an der ECHTEN Uhr (now =
// Date.now, beim Modul-Import gebunden - ein spaeter aktivierter Date-Mock wuerde diese
// Bindung nicht mehr aendern). Ein zweiter Ueberschuss loeste eine KASKADE echter
// Wartevorgaenge aus, weil das Fenster ohne gemockte Uhr real bleibt, bis eine echte Minute
// vergeht - dafuer bewusst nicht mehr als einer.
const WIRING_TYPE_COUNT = ASSIGNABLE_COST_RECORD_TYPES.length;
const WIRING_BASE_PAGES_PER_TYPE = Math.floor(DETAIL_RECORDS_BUDGET_PER_MINUTE / WIRING_TYPE_COUNT);
const WIRING_FIRST_TYPE_EXTRA_PAGES =
  DETAIL_RECORDS_BUDGET_PER_MINUTE + 1 - WIRING_BASE_PAGES_PER_TYPE * WIRING_TYPE_COUNT;
// Maximal moegliche Wartezeit der Drossel ist eine volle Minute (Fenstergrenze exakt
// getroffen) - 1000 ms Sicherheitsspanne gegen einen Boundary-Rundungsfall, rein virtuell (der
// Mock-Timer kostet keine echte Zeit).
const WIRING_TICK_MS = 61_000;

// Seiten NUR fuer die Drossel-MECHANIK: die Kostensumme pruefen P2-2/P4-1 bereits, hier
// zaehlt allein, wie viele Anfragen die produktive Drossel durchlaesst. EIN realer Beleg je
// Seite (eigene IDs) haelt die Antwortform gemessen (Spec A1), ohne den Null-Zwilling zu
// brauchen, den nur eine Kostensummen-Pruefung verlangt (Spec A2).
function wiringPages(recordType, pageCount) {
  const meta = Object.freeze({
    total_results: pageCount * MEASURED_PAGE_SIZE, total_pages: pageCount, page_size: MEASURED_PAGE_SIZE,
  });
  const page = () => ({
    records: [realRecord(recordType, { cost: BILLED_CC_COST, billedSec: 60, ids: OWN_IDS })],
    meta,
  });
  return Array.from({ length: pageCount }, page);
}
const wiringPagesByType = () =>
  Object.fromEntries(
    ASSIGNABLE_COST_RECORD_TYPES.map((type, i) => [
      type,
      wiringPages(type, WIRING_BASE_PAGES_PER_TYPE + (i === 0 ? WIRING_FIRST_TYPE_EXTRA_PAGES : 0)),
    ]),
  );

test("(P4-R2) fetchCostRecordPool OHNE injizierte Drossel haelt nach der produktiven Budget-Konstante an (Mock-Timer statt Wanduhr)", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] }); // NUR der Timer - Date.now bleibt real (s.o.)
  try {
    const calls = stubFetchPages(wiringPagesByType());
    const poolPromise = telnyxVoice.fetchCostRecordPool({}); // KEIN throttle-Override -> modul-globaler Default

    await new Promise((r) => setImmediate(r)); // Microtask-Queue leerlaufen lassen (Muster telnyx-event-ingest-machine.test.js)
    assert.equal(
      calls.length, DETAIL_RECORDS_BUDGET_PER_MINUTE,
      "die produktive Drossel haelt nach GENAU dem echten Budget an - eine No-op-Drossel liesse hier bereits alle Anfragen durch",
    );

    t.mock.timers.tick(WIRING_TICK_MS); // die Drossel wartet bis zur naechsten vollen Minute (F1) - der Mock ersetzt die Wanduhr
    const pool = await poolPromise;

    assert.equal(calls.length, DETAIL_RECORDS_BUDGET_PER_MINUTE + 1, "nach dem Tick lief die letzte Anfrage durch");
    assert.equal(pool.ok, true);
    assert.equal(pool.complete, true);
  } finally {
    t.mock.timers.reset(); // echte Timer fuer die naechsten Tests wiederherstellen
  }
});

// ---- (f) Twilio-Riegel ----

test("twilioVoice.fetchCostRecordPool/assignCostRecords sind NICHT implementiert (bewusst, Twilio-price deckt nur Connectivity)", () => {
  assert.equal(twilioVoice.fetchCostRecordPool, undefined);
  assert.equal(twilioVoice.assignCostRecords, undefined);
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

// KE-P2: der frueher einteilige Port ist zweigeteilt - der Riegel greppt jetzt BEIDE
// Symbole (Vereinigung der Treffer), sonst saehe er nur noch die Haelfte der Aufrufer.
const COST_RECORD_PORT_SYMBOLS = Object.freeze(["fetchCostRecordPool", "assignCostRecords"]);

test("Belegabruf: Aufrufer NUR in cost-truing.js (LCT P3) - NIE in einem Geld-/Gate-Pfad", () => {
  const srcDir = fileURLToPath(new URL("../src", import.meta.url));
  const hits = listJsFilesRecursive(srcDir)
    .filter((f) => {
      const text = readFileSync(f, "utf8");
      return COST_RECORD_PORT_SYMBOLS.some((symbol) => text.includes(symbol));
    })
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
