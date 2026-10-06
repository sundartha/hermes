import { test } from "node:test";
import assert from "node:assert/strict";
import { captureConsole, makeConfigOverrides } from "./helpers.js";
import { costTruingBookingFindings, COST_TRUING_BOOKING_FINDING } from "../src/boot-guard.js";

const ASSIGNED_RECORD_COUNT = 4;
const CALL_A_SUM_MICRO_CENTS = 4210000;
const CALL_B_SUM_MICRO_CENTS = 5320000;
const EXPECTED_BUDGET_PER_MINUTE = 30;
const EXPECTED_LIMIT_PER_MINUTE = 40;
const EXPECTED_RESERVE_PER_MINUTE = 10;
const FIFTH_PAGE = 5;
const FLOAT_FIFTH = 0.2;
const FLOAT_TENTH = 0.1;
const FLOAT_THREE_TENTHS = 0.3;
const FOREIGN_RECORD_MICRO_CENTS = 999000000;
const FOURTH_PAGE = 4;
const HALF_MINUTE_MS = 30000;
const INTEGER_INPUT = 120;
const MS_PER_MINUTE = 60000;
const MS_PER_SECOND = 1000;
const NON_INTEGER_INPUT = 1.5;
const NUMBER_TYPED_PRICE = 0.0122;
const OWN_RECORDS_SUM_MICRO_CENTS = 4110000;
const OWN_RECORD_COUNT = 2;
const PAGE_COUNT = 3;
const PARSED_MICRO_CENTS_OF_0_0122 = 1220000;
const PARSED_MICRO_CENTS_OF_0_039 = 3900000;
const PARSED_MICRO_CENTS_OF_1E_MINUS_3 = 100000;
const PARSED_MICRO_CENTS_OF_1_687E_MINUS_4 = 16870;
const PARSED_MICRO_CENTS_OF_7E_MINUS_7 = 70;
const PARSED_MICRO_CENTS_OF_ONE_UNIT = 100000000;
const POOL_RAW_LENGTH = 9;
const REAL_RECORDS_SUM_MICRO_CENTS = 9326870;
const SECOND_CALL_SIP_TRUNKING_MICRO_CENTS = 5020000;
const SECOND_PAGE = 2;
const SIP_TRUNKING_BILLED_SEC = 60;
const SIP_TRUNKING_MICRO_CENTS = 4010000;
const SIP_TRUNKING_RECORD_COUNT = 2;
const SUMMED_MICRO_CENTS_FIRST = 8000000;
const SUMMED_MICRO_CENTS_SECOND = 30000000;
const THIRD_PAGE = 3;
const TTS_CHARACTER_COUNT = 238;
const ZERO_COST_TWIN_COUNT = 2;

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
const { config } = await import("../src/config.js");

const { withBlankedConfig } = makeConfigOverrides(config);

const STARTED_AT = "2026-07-20T10:00:00Z";
const ENDED_AT = "2026-07-20T10:05:00Z";

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

const BAIT_LEG_ID = "0bad0bad-0bad-11f1-0bad-0bad0bad0bad0";
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

const BUDGET_PER_MINUTE = 30;
const THROTTLE_START_AT = "2026-07-21T16:18:30.000Z";

const jumpClock = (startIso = THROTTLE_START_AT) => createJumpClock(startIso);
const testThrottle = (clock = jumpClock()) =>
  createMinuteWindowThrottle({ budget: BUDGET_PER_MINUTE, now: clock.now, sleep: clock.sleep });

const fetchPool = (params = {}) =>
  telnyxVoice.fetchCostRecordPool({ ...params, throttle: testThrottle() });

async function fetchAndAssign(params = WINDOW) {
  const pool = await fetchPool();
  if (!pool.ok) return pool;
  return telnyxVoice.assignCostRecords(pool, params);
}

function listPageBody(page) {
  return Array.isArray(page) ? { data: page } : { data: page.records, meta: page.meta };
}

function stubFetchPages(pagesByType, clock = null) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts, atMs: clock ? clock.now() : null });
    const parsedUrl = new URL(url);
    const pages = pagesByType[parsedUrl.searchParams.get("filter[record_type]")] || [];
    const index = Number(parsedUrl.searchParams.get("page[number]") || FIRST_PAGE) - 1;
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

function stubFetchByRecordType(pagesByType) {
  return stubFetchPages(
    Object.fromEntries(Object.entries(pagesByType).map(([type, page]) => [type, [page]])),
  );
}

const FIRST_PAGE = 1;
const searchParamsOf = (call) => new URL(call.url).searchParams;
const pageNumbersFor = (calls, recordType) =>
  calls
    .map(searchParamsOf)
    .filter((params) => params.get("filter[record_type]") === recordType)
    .map((params) => Number(params.get("page[number]")));

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

const ID_FIELDS_BY_RECORD_TYPE = Object.freeze({
  "sip-trunking": ({ anchorId, sessionId }) => ({ call_control_id: anchorId, telnyx_session_id: sessionId }),
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
  inference: () => ({ conversation_id: CONVERSATION_ID }),
});

function realRecord(recordType, { cost, billedSec, currency = "USD", ids = OWN_IDS, extraFields = {} } = {}) {
  return {
    record_type: recordType,
    cost,
    currency,
    ...ID_FIELDS_BY_RECORD_TYPE[recordType](ids),
    ...(billedSec === undefined ? {} : { billed_sec: billedSec }),
    ...extraFields,
  };
}

function secondLegRecord(recordType, opts) {
  const record = realRecord(recordType, opts);
  delete record.call_control_id;
  return record;
}

const PARSER_CASES = [
  ["0.0122", PARSED_MICRO_CENTS_OF_0_0122],
  ["0", 0],
  ["1", PARSED_MICRO_CENTS_OF_ONE_UNIT],
  ["1.687E-4", PARSED_MICRO_CENTS_OF_1_687E_MINUS_4],
  ["1.687e-4", PARSED_MICRO_CENTS_OF_1_687E_MINUS_4],
  ["1e-3", PARSED_MICRO_CENTS_OF_1E_MINUS_3],
  ["7.0E-7", PARSED_MICRO_CENTS_OF_7E_MINUS_7],
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
  NUMBER_TYPED_PRICE,
  "-0.01",
  "1.0E+400",
  "1e",
  "E-4",
  "1.",
  "0.0.1",
  "+0.01",
];

for (const input of PARSER_INVALID_CASES) {
  test(`parseDecimalToMicroCents(${JSON.stringify(input)}) === null`, () => {
    assert.equal(parseDecimalToMicroCents(input), null);
  });
}

test("parseDecimalToMicroCents: Ganzzahl-Summe ohne Float-Fehler (0.07+0.01 === 8000000 exakt)", () => {
  const sum = parseDecimalToMicroCents("0.07") + parseDecimalToMicroCents("0.01");
  assert.equal(sum, SUMMED_MICRO_CENTS_FIRST);
});

test("parseDecimalToMicroCents: Float-Fehlerklasse demonstriert (0.1+0.2 !== 0.3 in JS), Parser bleibt exakt", () => {
  assert.notEqual(FLOAT_TENTH + FLOAT_FIFTH, FLOAT_THREE_TENTHS, "Kontrollannahme: klassischer IEEE754-Rundungsfehler");
  const sum = parseDecimalToMicroCents("0.1") + parseDecimalToMicroCents("0.2");
  assert.equal(sum, SUMMED_MICRO_CENTS_SECOND);
});

test("parseDecimalToMicroCents: Einheiten-Riegel 10^8 (0.039 -> 3900000, NICHT 39000)", () => {
  assert.equal(parseDecimalToMicroCents("0.039"), PARSED_MICRO_CENTS_OF_0_039);
});

test("parseDecimalToMicroCents: wissenschaftliche Notation ist gueltig (1.687E-4 === 16870)", () => {
  assert.equal(parseDecimalToMicroCents("1.687E-4"), PARSED_MICRO_CENTS_OF_1_687E_MINUS_4);
});

test("parseNonNegativeInteger: gueltige Ganzzahlen (string und number)", () => {
  assert.equal(parseNonNegativeInteger("120"), INTEGER_INPUT);
  assert.equal(parseNonNegativeInteger(INTEGER_INPUT), INTEGER_INPUT);
  assert.equal(parseNonNegativeInteger("0"), 0);
});

test("parseNonNegativeInteger: ungueltige Werte -> null", () => {
  for (const input of ["-1", "1.5", "abc", "", null, undefined, -1, NON_INTEGER_INPUT, "1e3"]) {
    assert.equal(parseNonNegativeInteger(input), null, `Eingabe ${JSON.stringify(input)}`);
  }
});

const REQUIRED_RECORD_TYPES = Object.freeze(["sip-trunking", "call-control"]);

const REAL_RECORDS = [
  { recordType: "sip-trunking", cost: "0.0401", billedSec: 60, extraFields: { started_at: "2026-07-20T10:01:00Z" } },
  { recordType: "call-control", cost: "0.001" },
  { recordType: "speech-to-text", cost: "0.0000" },
  { recordType: "text-to-speech", cost: "1.687E-4" },
  { recordType: "recording", cost: "0.002" },
  { recordType: "ai-voice-assistant", cost: "0.05", billedSec: 60, extraFields: { rate_measured_in: "ai_voice_assistant_minutes" } },
  { recordType: "inference", cost: "0.001315" },
];

function stubRealRecords({ ids = OWN_IDS } = {}) {
  const pages = {};
  for (const record of REAL_RECORDS)
    pages[record.recordType] = [
      realRecord(record.recordType, { cost: record.cost, billedSec: record.billedSec, extraFields: record.extraFields, ids }),
    ];
  return stubFetchByRecordType(pages);
}

const ASSIGNABLE_RECORD_COUNT = COST_RECORD_TYPES.length - UNASSIGNABLE_COST_RECORD_TYPES.length;

const SESSION_ONLY_RECORD_TYPES = Object.freeze(
  Object.keys(ID_FIELDS_BY_RECORD_TYPE).filter(
    (recordType) => !ID_FIELDS_BY_RECORD_TYPE[recordType](OWN_IDS).call_control_id
      && !UNASSIGNABLE_COST_RECORD_TYPES.includes(recordType),
  ),
);

test("Belegabruf: reale Belegformen - der Anker spannt die Session auf, die Belege OHNE Anker kommen mit", async () => {
  stubRealRecords();
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.ok, true);
  assert.equal(
    res.records.length,
    ASSIGNABLE_RECORD_COUNT,
    "alle Typen ausser den unzuordenbaren kommen mit (inference traegt keine Session)",
  );
  const sum = res.records.reduce((acc, record) => acc + record.costMicroCents, 0);
  assert.equal(sum, REAL_RECORDS_SUM_MICRO_CENTS);
  const found = new Set(res.records.map((record) => record.recordType));
  for (const sessionOnly of SESSION_ONLY_RECORD_TYPES)
    assert.ok(found.has(sessionOnly), `${sessionOnly} traegt keinen Anker und muss ueber die Session kommen`);
  for (const required of REQUIRED_RECORD_TYPES)
    assert.ok(found.has(required), `Pflicht-Typ ${required} fehlt - die Pflicht-Menge waere nicht erfuellbar`);
  assert.ok(!found.has("inference"));
  for (const record of res.records) {
    assert.equal(record.currency, "USD");
    assert.equal(record.legId, CALL_CONTROL_ID, "legId bleibt der uebergebene Anker (Korrelationsschluessel)");
  }
  assert.equal(res.records.find((record) => record.recordType === "sip-trunking").billedSec, SIP_TRUNKING_BILLED_SEC);
});

test("Belegabruf: fragt jeden record_type aus ASSIGNABLE_COST_RECORD_TYPES mit Bearer-Key ab", async () => {
  const calls = stubRealRecords();
  await fetchAndAssign(WINDOW);
  assert.equal(calls.length, ASSIGNABLE_COST_RECORD_TYPES.length);
  for (const call of calls) {
    assert.ok(call.url.startsWith(`${API_BASE}/v2/detail_records`));
    assert.equal(call.opts.headers.Authorization, `Bearer ${API_KEY}`);
  }
});

test("Belegabruf: Ende-zu-Ende sip-trunking cost 0.0401 -> costMicroCents 4010000", async () => {
  stubRealRecords();
  const res = await fetchAndAssign(WINDOW);
  const sipTrunking = res.records.find((record) => record.recordType === "sip-trunking");
  assert.equal(sipTrunking.costMicroCents, SIP_TRUNKING_MICRO_CENTS);
});

function twoAnchorPool() {
  return [
    realRecord("sip-trunking", { cost: "0.0", billedSec: 0, ids: CALL_A_IDS }),
    secondLegRecord("sip-trunking", { cost: "0.0401", billedSec: 60, ids: CALL_A_IDS }),
    realRecord("sip-trunking", { cost: "0.0", billedSec: 0, ids: CALL_B_IDS }),
    secondLegRecord("sip-trunking", { cost: "0.0502", billedSec: 60, ids: CALL_B_IDS }),
    realRecord("call-control", { cost: "9.99", billedSec: 60, ids: FOREIGN_POOL_IDS }),
    realRecord("call-control", { cost: "0.002", billedSec: 60, ids: CALL_A_IDS }),
    realRecord("call-control", { cost: "0.0", billedSec: 0, ids: CALL_A_IDS }),
    realRecord("call-control", { cost: "0.003", billedSec: 60, ids: CALL_B_IDS }),
    realRecord("call-control", { cost: "0.0", billedSec: 0, ids: CALL_B_IDS }),
  ];
}

const sumMicroCents = (res) => res.records.reduce((acc, record) => acc + record.costMicroCents, 0);

test("assignCostRecords: geteilter Pool - zwei Anker, kein Anker-Beleg gleicht dem anderen, fremde Session bei keinem", async () => {
  const pool9 = twoAnchorPool();
  const byType = (recordType) => pool9.filter((record) => record.record_type === recordType);
  const calls = stubFetchByRecordType({ "sip-trunking": byType("sip-trunking"), "call-control": byType("call-control") });

  const pool = await fetchPool();
  assert.equal(calls.length, ASSIGNABLE_COST_RECORD_TYPES.length, "EIN Pool-Abruf, unabhaengig davon, dass er fuer BEIDE Calls zustaendig ist");
  assert.equal(pool.ok, true);
  assert.equal(pool.complete, true);
  assert.equal(pool.raw.length, POOL_RAW_LENGTH);

  const resultA = telnyxVoice.assignCostRecords(pool, { legId: CALL_CONTROL_ID, startedAt: STARTED_AT, endedAt: ENDED_AT });
  const resultB = telnyxVoice.assignCostRecords(pool, { legId: SECOND_CALL_CONTROL_ID, startedAt: STARTED_AT, endedAt: ENDED_AT });

  assert.equal(resultA.records.length, ASSIGNED_RECORD_COUNT);
  assert.equal(resultB.records.length, ASSIGNED_RECORD_COUNT);
  assert.equal(sumMicroCents(resultA), CALL_A_SUM_MICRO_CENTS, "0 + 4010000 + 200000 + 0");
  assert.equal(sumMicroCents(resultB), CALL_B_SUM_MICRO_CENTS, "0 + 5020000 + 300000 + 0");
  assert.ok(resultA.records.some((record) => record.costMicroCents === SIP_TRUNKING_MICRO_CENTS), "der abgerechnete sip-trunking-Beleg haengt am Session-Weg");
  assert.equal(resultA.records.filter((record) => record.costMicroCents === 0).length, ZERO_COST_TWIN_COUNT, "beide Null-Zwillinge sind mitgezaehlt");
  assert.ok(!resultA.records.some((record) => record.costMicroCents === FOREIGN_RECORD_MICRO_CENTS), "fremde Session kommt bei A nicht mit");
  assert.ok(!resultB.records.some((record) => record.costMicroCents === FOREIGN_RECORD_MICRO_CENTS), "fremde Session kommt bei B nicht mit");
  assert.ok(!resultA.records.some((record) => record.costMicroCents === SECOND_CALL_SIP_TRUNKING_MICRO_CENTS), "keine Quervermischung: B-Beleg landet nicht bei A");

  assert.deepEqual(
    telnyxVoice.assignCostRecords(pool, { legId: CALL_CONTROL_ID, startedAt: STARTED_AT, endedAt: ENDED_AT }),
    resultA,
  );
});

test("assignCostRecords: ohne brauchbaren Pool -> ok:false (pool_missing), nie eine leere Messung", () => {
  const res = telnyxVoice.assignCostRecords({ ok: false, reason: "provider_error" }, WINDOW);
  assert.equal(res.ok, false);
  assert.equal(res.reason, "pool_missing");
  assert.equal(res.records, undefined);
  assert.doesNotThrow(() => telnyxVoice.assignCostRecords(undefined, WINDOW));
});

test("Belegabruf: HTTP 500 -> ok:false, records undefined, kein Wurf", async () => {
  stubFetchFailure({ status: 500, body: {} });
  await assert.doesNotReject(async () => {
    const res = await fetchAndAssign(WINDOW);
    assert.equal(res.ok, false);
    assert.equal(res.records, undefined);
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

const RATE_LIMIT_STATUS = 429;
const RATE_LIMIT_CODE = "10011";
const LEAK_NUMBER = "+4915112345678";
const POISONED_DETAIL = `Bearer ${API_KEY} from=${LEAK_NUMBER} session=${SESSION_ID}`;
const RATE_LIMIT_BODY = {
  secret_key: API_KEY,
  errors: [{ code: RATE_LIMIT_CODE, title: "Too many requests", detail: POISONED_DETAIL }],
};
const FIRST_RECORD_TYPE = ASSIGNABLE_COST_RECORD_TYPES[0];

const failureLines = (lines) => lines.filter((line) => line.includes("getVoiceCostRecords fehler"));

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

test("Belegabruf: fremde Waehrung wird verworfen, gleiche Waehrung kleingeschrieben akzeptiert", async () => {
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
  assert.equal(res.records.length, OWN_RECORD_COUNT, "nur die zwei eigenen Belege");
  const sum = res.records.reduce((acc, record) => acc + record.costMicroCents, 0);
  assert.equal(sum, OWN_RECORDS_SUM_MICRO_CENTS);
  assert.ok(
    !res.records.some((record) => record.costMicroCents === FOREIGN_RECORD_MICRO_CENTS),
    "ein fremder Beleg waere eine Fehlbuchung auf einen fremden Tenant",
  );
});

test("Belegabruf: fremde `call_session_id` kommt NIE mit (Zuordnung bleibt fail-closed)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401" })],
    "speech-to-text": [
      realRecord("speech-to-text", { cost: "0.0000" }),
      realRecord("speech-to-text", { cost: "9.99", ids: FOREIGN_IDS }),
    ],
  });
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.ok, true);
  assert.equal(res.records.length, OWN_RECORD_COUNT, "nur Anker-Beleg + eigener speech-to-text-Beleg");
  assert.ok(
    !res.records.some((record) => record.costMicroCents === FOREIGN_RECORD_MICRO_CENTS),
    "eine fremde call_session_id waere eine Fehlbuchung auf einen fremden Tenant",
  );
});

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

function costRecordsLogLine(lines) {
  return lines.find((line) => line.includes("getVoiceCostRecords ok"));
}

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

const MEASURED_PAGE_SIZE = 50;
const MEASURED_PAGED_META = Object.freeze({ total_results: 212, total_pages: 5, page_size: 50 });
const MEASURED_SINGLE_PAGE_META = Object.freeze({ total_results: 50, total_pages: 1, page_size: 50 });

function fullCallControlPage() {
  return Array.from({ length: MEASURED_PAGE_SIZE }, () =>
    realRecord("call-control", { cost: "0.001", ids: { ...OWN_IDS, legUuid: FOREIGN_LEG_ID } }),
  );
}

const anchorPage = () => [realRecord("sip-trunking", { cost: "0.0401", billedSec: 60 })];

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
  assert.deepEqual(pageNumbersFor(calls, "call-control"), [1]);
});

test("(P3-2c) volle Seite OHNE meta wird nachgeblaettert; erst die kurze Folgeseite beweist das Ende", async () => {
  const calls = stubFetchPages({
    "sip-trunking": [anchorPage()],
    "call-control": [fullCallControlPage(), []],
  });
  const res = await fetchAndAssign(WINDOW);
  assert.deepEqual(pageNumbersFor(calls, "call-control"), [1, SECOND_PAGE]);
  assert.equal(res.ok, true);
  assert.equal(
    res.records.length,
    1 + MEASURED_PAGE_SIZE,
    "Anker-Beleg + alle 50 call-control-Belege der ersten Seite (Seite 2 traegt keine weiteren)",
  );
});

const IN_WINDOW_AT = STARTED_AT;
const SINCE_BOUNDARY = "2026-07-20T09:00:00Z";
const BEFORE_SINCE = "2026-07-20T08:00:00Z";
const AFTER_SINCE = "2026-07-20T10:00:00Z";
const BILLED_CC_COST = "0.001";
const BILLED_CC_MICRO = 100_000;

function pagedCallControlRecord({ cost, billedSec, startedAt = IN_WINDOW_AT }) {
  return realRecord("call-control", {
    cost,
    billedSec,
    ids: { ...OWN_IDS, legUuid: FOREIGN_LEG_ID },
    extraFields: { started_at: startedAt, call_sec: billedSec },
  });
}

function sipTrunkingLegPair() {
  return [
    realRecord("sip-trunking", { cost: "0.0", billedSec: 0, extraFields: { started_at: IN_WINDOW_AT, call_sec: 0 } }),
    secondLegRecord("sip-trunking", { cost: "0.0401", billedSec: 60, extraFields: { started_at: IN_WINDOW_AT, call_sec: 60 } }),
  ];
}

const PAGED_LAST_PAGE_COUNT =
  MEASURED_PAGED_META.total_results - (MEASURED_PAGED_META.total_pages - 1) * MEASURED_PAGE_SIZE;

function fivePagedCallControlPages() {
  const billed = () => pagedCallControlRecord({ cost: BILLED_CC_COST, billedSec: 60 });
  const full = () => ({ records: Array.from({ length: MEASURED_PAGE_SIZE }, billed), meta: MEASURED_PAGED_META });
  return [
    full(), full(), full(), full(),
    {
      records: [
        ...Array.from({ length: PAGED_LAST_PAGE_COUNT - 1 }, billed),
        pagedCallControlRecord({ cost: "0.0", billedSec: 0 }),
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
  assert.deepEqual(pageNumbersFor(calls, "call-control"), [1, SECOND_PAGE, THIRD_PAGE, FOURTH_PAGE, FIFTH_PAGE]);
  assert.equal(res.ok, true);
  const ccRecords = res.records.filter((record) => record.recordType === "call-control");
  assert.equal(ccRecords.length, MEASURED_PAGED_META.total_results);
  assert.equal(res.records.length, MEASURED_PAGED_META.total_results + SIP_TRUNKING_RECORD_COUNT, "212 call-control + 2 sip-trunking (Null-Zwilling + abgerechnet)");
  const expectedSum = (MEASURED_PAGED_META.total_results - 1) * BILLED_CC_MICRO + SIP_TRUNKING_MICRO_CENTS;
  assert.equal(sumMicroCents(res), expectedSum, "211 abgerechnete call-control-Belege + der abgerechnete sip-trunking-Beleg, zwei echte Nullen tragen 0 bei");
  assert.equal(res.records.filter((record) => record.costMicroCents === 0).length, ZERO_COST_TWIN_COUNT, "beide Null-Zwillinge sind mitgezaehlt");
});

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
  assert.deepEqual(pageNumbers, Array.from({ length: pageNumbers.length }, (_item, i) => i + 1), "lueckenlos ab Seite 1");
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

function threeFullPages(recordFactory) {
  const meta = { total_results: PAGE_COUNT * MEASURED_PAGE_SIZE, total_pages: 3, page_size: MEASURED_PAGE_SIZE };
  return Array.from({ length: 3 }, () => ({
    records: Array.from({ length: MEASURED_PAGE_SIZE }, recordFactory),
    meta,
  }));
}

function ccRecordWithoutTimestamp() {
  return realRecord("call-control", { cost: BILLED_CC_COST, billedSec: 60, ids: { ...OWN_IDS, legUuid: FOREIGN_LEG_ID } });
}

function unsortedCallControlPages() {
  const meta = { total_results: PAGE_COUNT * MEASURED_PAGE_SIZE, total_pages: 3, page_size: MEASURED_PAGE_SIZE };
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
  assert.ok(pageNumbersFor(calls, "call-control").includes(SECOND_PAGE), "Seite 2 wurde angefordert - Seite 1 hat die Schleife nicht vorzeitig beendet");
});

test("(P3-5) eine GANZE Seite vor 'since' beendet die Seitenschleife", async () => {
  const calls = stubFetchPages({ "call-control": unsortedCallControlPages() });
  const pool = await fetchPool({ since: SINCE_BOUNDARY });
  assert.deepEqual(pageNumbersFor(calls, "call-control"), [1, SECOND_PAGE], "Seite 3 wird nie geholt");
  assert.equal(pool.complete, true, "das Fenster wurde verlassen - das ist keine Untermenge");
});

test("(P3-6) Beleg OHNE gemessenes Zeitfeld gilt als innerhalb - die Schleife laeuft weiter", async () => {
  const calls = stubFetchPages({ "call-control": threeFullPages(ccRecordWithoutTimestamp) });
  await fetchPool({ since: SINCE_BOUNDARY });
  assert.deepEqual(pageNumbersFor(calls, "call-control"), [1, SECOND_PAGE, THIRD_PAGE]);
});

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
  assert.deepEqual(pageNumbersFor(calls, "speech-to-text"), [1, SECOND_PAGE, THIRD_PAGE], "started_at ist auf speech-to-text kein Zeitfeld - die Schleife liest es nicht");
});

test("(P3-8) 'start_time' vor 'since' beendet die speech-to-text-Schleife (das gemessene Feld greift)", async () => {
  const calls = stubFetchPages({
    "speech-to-text": threeFullPages(() => sttRecordAt("start_time", BEFORE_SINCE)),
  });
  await fetchPool({ since: SINCE_BOUNDARY });
  assert.deepEqual(pageNumbersFor(calls, "speech-to-text"), [1], "start_time ist das gemessene Zeitfeld - die Schleife endet nach Seite 1");
});

test("(P3-9) abgerufene Typenmenge ist GENAU ASSIGNABLE_COST_RECORD_TYPES - inference wird nie angefragt", async () => {
  const calls = stubRealRecords();
  await fetchAndAssign(WINDOW);
  const requestedTypes = calls.map((call) => new URL(call.url).searchParams.get("filter[record_type]"));
  assert.deepEqual(new Set(requestedTypes), new Set(ASSIGNABLE_COST_RECORD_TYPES));
  assert.equal(calls.length, ASSIGNABLE_COST_RECORD_TYPES.length);
  for (const forbidden of UNASSIGNABLE_COST_RECORD_TYPES)
    assert.ok(!requestedTypes.includes(forbidden), `${forbidden} darf nie angefragt werden`);
});

test("(P3-10) die Query traegt AUSSCHLIESSLICH filter[record_type], page[size]=50, page[number] - nie einen Zeitfilter", async () => {
  const calls = stubRealRecords();
  await fetchPool({ since: "2026-07-20T00:00:00Z" });
  assert.equal(calls.length, ASSIGNABLE_COST_RECORD_TYPES.length);
  for (const call of calls) {
    const params = new URL(call.url).searchParams;
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

test("(P6-1) Abruf-Typenmenge und Boot-Guard-Allowlist stammen aus DERSELBEN Quelle", async () => {
  const calls = stubRealRecords();
  await fetchPool();
  const fetched = [...new Set(calls.map((call) => new URL(call.url).searchParams.get("filter[record_type]")))];
  assert.ok(fetched.length > 0, "ohne abgerufene Typen pruefte der Test nichts");

  const guard = (recordType) => costTruingBookingFindings({
    requiredRecordTypes: [recordType], assignableRecordTypes: ASSIGNABLE_COST_RECORD_TYPES,
    coveragePercent: 100, minCoveragePercent: 80,
  });
  for (const recordType of fetched)
    assert.deepEqual(guard(recordType), [], `abgerufener Typ ${recordType} muss als Pflicht-Typ zulaessig sein`);
  const notFetched = COST_RECORD_TYPES.filter((recordType) => !fetched.includes(recordType));
  assert.ok(notFetched.length > 0, "ohne nicht abgerufenen Typ pruefte die Gegenrichtung nichts");
  for (const recordType of notFetched)
    assert.equal(guard(recordType)[0]?.code, COST_TRUING_BOOKING_FINDING.REQUIRED_TYPES_UNASSIGNABLE,
      `nicht abgerufener Typ ${recordType} muss als Pflicht-Typ FATAL abgelehnt werden`);
});

const elevenLabsTtsRecord = ({ chars, ids = OWN_IDS, provider = "elevenlabs", cost = "1.666E-4" }) =>
  realRecord("text-to-speech", { cost, ids, extraFields: { provider, number_of_characters: chars } });

test("(P6-2) ElevenLabs-Zeichen reisen am zugeordneten text-to-speech-Beleg mit", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401", billedSec: 60 })],
    "text-to-speech": [elevenLabsTtsRecord({ chars: 238 })],
  });
  const res = await fetchAndAssign(WINDOW);
  const tts = res.records.find((record) => record.recordType === "text-to-speech");
  assert.equal(tts.ttsCharacters, TTS_CHARACTER_COUNT);
  assert.equal(res.records.find((record) => record.recordType === "sip-trunking").ttsCharacters, null,
    "Nicht-TTS-Belege tragen null, nie 0 - 0 waere eine gemessene Null");
});

test("(P6-3a) fremder TTS-Provider zaehlt NICHT auf den ElevenLabs-Zaehler - auch mit gueltiger Menge (Provider-Waechter)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401", billedSec: 60 })],
    "text-to-speech": [elevenLabsTtsRecord({ chars: 238, provider: "aws-polly" })],
  });
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.records.find((record) => record.recordType === "text-to-speech").ttsCharacters, null);
});

test("(P6-3b) eine unparsbare Zeichen-Menge zaehlt NICHT - auch beim echten ElevenLabs-Provider (Parser-Waechter)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401", billedSec: 60 })],
    "text-to-speech": [elevenLabsTtsRecord({ chars: "viele", provider: "elevenlabs" })],
  });
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.records.find((record) => record.recordType === "text-to-speech").ttsCharacters, null);
});

test("(P6-3c) ein Nicht-TTS-Beleg zaehlt NICHT - auch mit elevenlabs-Provider und gueltiger Menge (record_type-Waechter)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", {
      cost: "0.0401", billedSec: 60,
      extraFields: { provider: "elevenlabs", number_of_characters: 99 },
    })],
  });
  const res = await fetchAndAssign(WINDOW);
  assert.equal(res.records.find((record) => record.recordType === "sip-trunking").ttsCharacters, null);
});

test("(P6-4) ein NICHT zugeordneter ElevenLabs-Beleg liefert keine Zeichen (fail-closed)", async () => {
  stubFetchByRecordType({
    "sip-trunking": [realRecord("sip-trunking", { cost: "0.0401", billedSec: 60 })],
    "text-to-speech": [elevenLabsTtsRecord({ chars: 999, ids: FOREIGN_POOL_IDS })],
  });
  const res = await fetchAndAssign(WINDOW);
  assert.ok(!res.records.some((record) => record.recordType === "text-to-speech"),
    "fremder Beleg kommt nicht herein - und damit auch seine Zeichen nicht");
});

const THROTTLE_PAGES_PER_TYPE = 6;
const THROTTLE_META = Object.freeze({
  total_results: THROTTLE_PAGES_PER_TYPE * MEASURED_PAGE_SIZE,
  total_pages: THROTTLE_PAGES_PER_TYPE,
  page_size: MEASURED_PAGE_SIZE,
});
const THROTTLE_REQUEST_COUNT = ASSIGNABLE_COST_RECORD_TYPES.length * THROTTLE_PAGES_PER_TYPE;

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
  Object.fromEntries(ASSIGNABLE_COST_RECORD_TYPES.map((recordType) => [recordType, throttledPages(recordType)]));

const requestsPerMinute = (calls) => {
  const byMinute = new Map();
  for (const call of calls) {
    const minute = Math.floor(call.atMs / MS_PER_MINUTE);
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
  assert.equal(clock.now() % MS_PER_MINUTE, 0, "die Pause endet exakt auf :00 - das Fenster ist fix, nicht gleitend");
  assert.equal(pool.ok, true);
  assert.equal(pool.complete, true);
  assert.equal(pool.raw.length, THROTTLE_REQUEST_COUNT * MEASURED_PAGE_SIZE);
  assert.equal(pool.raw.filter((record) => record.cost === "0.0").length, THROTTLE_REQUEST_COUNT,
    "jeder Null-Zwilling ist mitgekommen");
});

test("(P4-2) 429 -> GENAU ein Wiederholungsversuch mit dem Wartehinweis des Providers, danach ok:false", async () => {
  const RESET_SECONDS = 17;
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
  assert.equal(clock.elapsedMs(), RESET_SECONDS * MS_PER_SECOND, "gewartet wurde nach x-ratelimit-reset");
  assert.equal(pool.ok, false);
  assert.equal(pool.reason, "provider_error");
  assert.equal(pool.raw, undefined, "ok:false ist NIE die leere Menge");
});

test("(P4-3) 429 ohne x-ratelimit-reset -> Wartezeit bis zur naechsten vollen Minute aus der eigenen Uhr", async () => {
  const calls = stubFetchFailure({ status: RATE_LIMIT_STATUS, body: RATE_LIMIT_BODY });
  const clock = jumpClock();
  await captureConsole(() => telnyxVoice.fetchCostRecordPool({ throttle: testThrottle(clock) }));
  assert.equal(clock.elapsedMs(), HALF_MINUTE_MS);
  assert.equal(calls.length, ATTEMPTS_PER_RATE_LIMITED_PAGE);
});

test("(P4-R1) das produktive Minutenbudget behaelt die bewusste Reserve unter dem gemessenen Limit", () => {
  assert.equal(DETAIL_RECORDS_LIMIT_PER_MINUTE, EXPECTED_LIMIT_PER_MINUTE, "gemessenes Kontingent, Plan F1");
  assert.equal(DETAIL_RECORDS_RESERVE_PER_MINUTE, EXPECTED_RESERVE_PER_MINUTE, "bewusste Reserve gegen U5/Uhr-Versatz");
  assert.equal(DETAIL_RECORDS_BUDGET_PER_MINUTE, EXPECTED_BUDGET_PER_MINUTE);
});

const WIRING_TYPE_COUNT = ASSIGNABLE_COST_RECORD_TYPES.length;
const WIRING_BASE_PAGES_PER_TYPE = Math.floor(DETAIL_RECORDS_BUDGET_PER_MINUTE / WIRING_TYPE_COUNT);
const WIRING_FIRST_TYPE_EXTRA_PAGES =
  DETAIL_RECORDS_BUDGET_PER_MINUTE + 1 - WIRING_BASE_PAGES_PER_TYPE * WIRING_TYPE_COUNT;
const WIRING_TICK_MS = 61_000;

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

test("(P4-R2) fetchCostRecordPool OHNE injizierte Drossel haelt nach der produktiven Budget-Konstante an (Mock-Timer statt Wanduhr)", async (recordType) => {
  recordType.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const calls = stubFetchPages(wiringPagesByType());
    const poolPromise = telnyxVoice.fetchCostRecordPool({});

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      calls.length, DETAIL_RECORDS_BUDGET_PER_MINUTE,
      "die produktive Drossel haelt nach GENAU dem echten Budget an - eine No-op-Drossel liesse hier bereits alle Anfragen durch",
    );

    recordType.mock.timers.tick(WIRING_TICK_MS);
    const pool = await poolPromise;

    assert.equal(calls.length, DETAIL_RECORDS_BUDGET_PER_MINUTE + 1, "nach dem Tick lief die letzte Anfrage durch");
    assert.equal(pool.ok, true);
    assert.equal(pool.complete, true);
  } finally {
    recordType.mock.timers.reset();
  }
});
