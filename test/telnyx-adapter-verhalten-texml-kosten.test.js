import { test } from "node:test";
import assert from "node:assert/strict";
import { captureConsole, makeConfigOverrides } from "./helpers.js";
import { TELNYX_RESERVIERUNG_SCHLUESSEL } from "./gemeinsam/erfundene-geheimnisse.js";

const API_BASE = "https://telnyx.texml.test";
const API_KEY = TELNYX_RESERVIERUNG_SCHLUESSEL;
const CONNECTION_ID = "conn_texml_1";
const ACCOUNT_SID = "acct_texml_1";
process.env.TELNYX_API_BASE = API_BASE;
process.env.TELNYX_API_KEY = API_KEY;
process.env.TELNYX_CONNECTION_ID = CONNECTION_ID;
process.env.TELNYX_ACCOUNT_SID = ACCOUNT_SID;

const { config } = await import("../src/config.js");
const registry = await import("../src/telephony/registry.js");

const { withConfig } = makeConfigOverrides(config);
const voice = registry.voiceControl("telnyx");
const configRead = registry.providerConfigRead();

function stubFetch(response = {}) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url: String(url), opts, body: opts?.body?.toString() });
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: response.jsonFehler ? async () => { throw new Error("kein JSON"); } : async () => response.json ?? {},
      text: async () => response.text ?? JSON.stringify(response.json ?? {}),
    };
  };
  return calls;
}

const authOf = ({ opts }) => opts.headers.Authorization;
const FORM = "application/x-www-form-urlencoded";

test("originateCall: sendet Formular mit allen Feldern an die Verbindung und liefert die Sid", async () => {
  const calls = stubFetch({ json: { data: { sid: "sid_1" } } });
  const res = await voice.originateCall({
    from: "+4930123456",
    to: "+4915112345678",
    url: "https://agent.test/voice",
    statusCallback: "https://agent.test/status",
    statusCallbackEvent: ["answered", "completed"],
    method: "POST",
    timeLimit: 600,
  });
  assert.deepEqual(res, { sid: "sid_1" });
  const [anfrage] = calls;
  assert.equal(anfrage.url, `${API_BASE}/v2/texml/calls/${CONNECTION_ID}`);
  assert.equal(anfrage.opts.method, "POST");
  assert.equal(anfrage.opts.headers.Authorization, `Bearer ${API_KEY}`);
  assert.equal(anfrage.opts.headers["Content-Type"], FORM);
  assert.equal(
    anfrage.body,
    "From=%2B4930123456&To=%2B4915112345678&Url=https%3A%2F%2Fagent.test%2Fvoice" +
      "&StatusCallback=https%3A%2F%2Fagent.test%2Fstatus&UrlMethod=POST&StatusCallbackMethod=POST" +
      "&StatusCallbackEvent=answered&StatusCallbackEvent=completed&TimeLimit=600",
  );
});

test("originateCall: ohne optionale Felder bleibt das Formular schlank, Sid auch aus call_sid", async () => {
  const calls = stubFetch({ json: { call_sid: "sid_2" } });
  const res = await voice.originateCall({ from: "+49301", to: "+49302", url: "https://agent.test/v" });
  assert.deepEqual(res, { sid: "sid_2" });
  assert.equal(calls[0].body, "From=%2B49301&To=%2B49302&Url=https%3A%2F%2Fagent.test%2Fv");
});

test("originateCall: Maschinenerkennung haengt Modus und Frist an, nur wenn sie eingeschaltet ist", async () => {
  const calls = stubFetch({ json: { sid: "sid_3" } });
  const anruf = { from: "+49301", to: "+49302", url: "https://agent.test/v" };
  await withConfig("machineDetection", { enabled: true, timeoutS: 25 }, () => voice.originateCall(anruf));
  await withConfig("machineDetection", { enabled: false, timeoutS: 25 }, () => voice.originateCall(anruf));
  assert.match(calls[0].body, /&AnsweringMachineDetection=detect&MachineDetectionTimeout=25$/);
  assert.doesNotMatch(calls[1].body, /AnsweringMachineDetection|MachineDetectionTimeout/);
});

test("originateCall: fehlende Konfiguration und HTTP-Fehler werfen, ohne zu wählen", async () => {
  const calls = stubFetch();
  const anruf = { from: "+49301", to: "+49302", url: "https://agent.test/v" };
  await withConfig("telnyxApiKey", "", () =>
    assert.rejects(() => voice.originateCall(anruf), { message: "Telnyx originateCall: TELNYX_API_KEY fehlt" }),
  );
  await withConfig("telnyxConnectionId", "", () =>
    assert.rejects(() => voice.originateCall(anruf), { message: "Telnyx originateCall: TELNYX_CONNECTION_ID fehlt" }),
  );
  assert.equal(calls.length, 0);
  stubFetch({ ok: false, status: 400, json: { errors: [{ code: "10015", title: "Ungueltig" }] } });
  await assert.rejects(
    () => voice.originateCall(anruf),
    (err) => {
      assert.equal(err.message, "Telnyx originateCall fehlgeschlagen: HTTP 400 (10015 Ungueltig)");
      assert.equal(err.providerStatus, 400);
      assert.equal(err.providerCode, "10015");
      return true;
    },
  );
});

test("endCall und redirectCall: aendern den TeXML-Anruf mit genauem Formular und Frist", async () => {
  const calls = stubFetch();
  await voice.endCall("CA_1");
  await voice.redirectCall("CA_2", "https://agent.test/neu?a=1");
  const ziel = (sid) => `${API_BASE}/v2/texml/Accounts/${ACCOUNT_SID}/Calls/${sid}`;
  assert.deepEqual(
    calls.map((c) => [c.url, c.opts.method, c.body, c.opts.headers["Content-Type"], c.opts.headers.Authorization]),
    [
      [ziel("CA_1"), "POST", "Status=completed", FORM, `Bearer ${API_KEY}`],
      [ziel("CA_2"), "POST", "Url=https%3A%2F%2Fagent.test%2Fneu%3Fa%3D1&Method=POST", FORM, `Bearer ${API_KEY}`],
    ],
  );
  for (const c of calls) assert.ok(c.opts.signal, "jede Anfrage hat eine Frist");
});

test("endCall und redirectCall: ohne Schluessel, Konto oder Sid wird nichts gesendet", async () => {
  const calls = stubFetch();
  await withConfig("telnyxApiKey", "", async () => {
    await assert.rejects(() => voice.endCall("CA_1"), { message: "Telnyx endCall: TELNYX_API_KEY fehlt" });
    await assert.rejects(() => voice.redirectCall("CA_1", "https://a.test"), {
      message: "Telnyx redirectCall: TELNYX_API_KEY fehlt",
    });
  });
  await withConfig("telnyxAccountSid", "", async () => {
    await assert.rejects(() => voice.endCall("CA_1"), { message: "Telnyx endCall: TELNYX_ACCOUNT_SID fehlt" });
  });
  await assert.rejects(() => voice.redirectCall("", "https://a.test"), { message: "Telnyx redirectCall: callSid fehlt" });
  assert.equal(calls.length, 0);
});

test("endCall und redirectCall: HTTP-Fehler wirft mit Operation und Status", async () => {
  stubFetch({ ok: false, status: 404, json: { errors: [{ code: "20404", title: "Unbekannt" }] } });
  await assert.rejects(() => voice.endCall("CA_1"), (err) => {
    assert.equal(err.message, "Telnyx endCall fehlgeschlagen: HTTP 404 (20404 Unbekannt)");
    assert.equal(err.providerStatus, 404);
    return true;
  });
  await assert.rejects(() => voice.redirectCall("CA_1", "https://a.test"), { message: /^Telnyx redirectCall fehlgeschlagen: HTTP 404/ });
});

const INVOICE_URL = `${API_BASE}/v2/invoices?sort=-period_start&page%5Bsize%5D=12`;

test("Rechnungssumme: fragt die letzten zwoelf Rechnungen ab und unterscheidet die Gruende", async () => {
  const faelle = [
    [{ data: [{ period_start: "2024-05-01T00:00:00Z" }] }, "amount_not_exposed_by_provider"],
    [{ data: [{ period_start: "2024-04-30" }, { period_start: 20240501 }, {}] }, "invoice_not_found"],
    [{ data: [] }, "invoice_not_found"],
    [{ data: "kaputt" }, "shape_unexpected"],
    [[{ period_start: "2024-05-31" }], "amount_not_exposed_by_provider"],
  ];
  for (const [json, grund] of faelle) {
    const calls = stubFetch({ json });
    assert.deepEqual(await voice.fetchMonthlyInvoiceTotal({ month: "2024-05" }), { ok: false, reason: grund }, JSON.stringify(json));
    assert.equal(calls[0].url, INVOICE_URL);
    assert.equal(authOf(calls[0]), `Bearer ${API_KEY}`);
    assert.ok(calls[0].opts.signal);
  }
  stubFetch({ jsonFehler: true });
  assert.equal((await voice.fetchMonthlyInvoiceTotal({ month: "2024-05" })).reason, "shape_unexpected");
});

test("Rechnungssumme: ohne Schluessel keine Anfrage, Anbieterfehler wird mit Status und Code geloggt", async () => {
  const calls = stubFetch();
  await withConfig("telnyxApiKey", "", async () => {
    assert.deepEqual(await voice.fetchMonthlyInvoiceTotal({ month: "2024-05" }), { ok: false, reason: "config_missing" });
  });
  assert.equal(calls.length, 0);
  stubFetch({ ok: false, status: 503, json: { errors: [{ code: "50300", title: "Aus" }] } });
  const zeilen = await captureConsole(async () => {
    assert.deepEqual(await voice.fetchMonthlyInvoiceTotal({ month: "2024-05" }), { ok: false, reason: "provider_error" });
  });
  assert.deepEqual(zeilen, ["[telnyx/voice] fetchMonthlyInvoiceTotal fehler status=503 code=50300"]);
  global.fetch = async () => {
    throw new Error("Netz weg");
  };
  const ohneStatus = await captureConsole(() => voice.fetchMonthlyInvoiceTotal({ month: "2024-05" }));
  assert.deepEqual(ohneStatus, ["[telnyx/voice] fetchMonthlyInvoiceTotal fehler status=none code=none"]);
});

test("Rufnummernsuche: filtert nach E.164 und bildet Treffer auf Nummer und Status ab", async () => {
  const calls = stubFetch({
    json: { data: [{ phone_number: "+4930123456", status: "active", id: "1" }, { phone_number: "+4930999", status: "purchase-pending" }] },
  });
  const res = await configRead.findPhoneNumber("+4930123456");
  assert.deepEqual(res, {
    treffer: [
      { e164: "+4930123456", status: "active" },
      { e164: "+4930999", status: "purchase-pending" },
    ],
  });
  assert.equal(calls[0].url, `${API_BASE}/v2/phone_numbers?filter%5Bphone_number%5D=%2B4930123456`);
  assert.equal(authOf(calls[0]), `Bearer ${API_KEY}`);
  assert.ok(calls[0].opts.signal);
  stubFetch({ text: "" });
  assert.deepEqual(await configRead.findPhoneNumber("+4930123456"), { treffer: [] });
  stubFetch({ json: { data: null } });
  assert.deepEqual(await configRead.findPhoneNumber("+4930123456"), { treffer: [] });
});

test("Rufnummernsuche: ohne Schluessel oder bei HTTP-Fehler wirft sie", async () => {
  const calls = stubFetch();
  await withConfig("telnyxApiKey", "", () =>
    assert.rejects(() => configRead.findPhoneNumber("+4930123456"), { message: "Telnyx: TELNYX_API_KEY fehlt" }),
  );
  assert.equal(calls.length, 0);
  stubFetch({ ok: false, status: 401 });
  await assert.rejects(() => configRead.findPhoneNumber("+4930123456"), (err) => {
    assert.equal(err.message, "Telnyx findPhoneNumber fehlgeschlagen: HTTP 401");
    assert.equal(err.providerStatus, 401);
    return true;
  });
});

const LEG = "cc_leg";
const START = "2024-05-01T10:00:00Z";
const END = "2024-05-01T10:10:00Z";
const zuordnen = (raw, pool = { raw }) =>
  withConfig("providerCurrency", "EUR", () => voice.assignCostRecords(pool, { legId: LEG, startedAt: START, endedAt: END }));
const kosten = (extra) => ({ call_control_id: LEG, record_type: "sip-trunking", currency: "EUR", cost: "0.0035", ...extra });

test("Kostenbelege: Parameter und Pool muessen vollstaendig sein", () => {
  const ok = { raw: [] };
  assert.deepEqual(voice.assignCostRecords(ok, { startedAt: START, endedAt: END }), { ok: false, reason: "params_missing" });
  assert.deepEqual(voice.assignCostRecords(ok, { legId: LEG, endedAt: END }), { ok: false, reason: "params_missing" });
  assert.deepEqual(voice.assignCostRecords(ok, { legId: LEG, startedAt: START }), { ok: false, reason: "params_missing" });
  assert.deepEqual(voice.assignCostRecords(ok), { ok: false, reason: "params_missing" });
  assert.deepEqual(voice.assignCostRecords({}, { legId: LEG, startedAt: START, endedAt: END }), { ok: false, reason: "pool_missing" });
  assert.deepEqual(voice.assignCostRecords(undefined, { legId: LEG, startedAt: START, endedAt: END }), { ok: false, reason: "pool_missing" });
});

test("Kostenbelege: Beleg wird mit Betrag in Mikrocent, Dauer und Leitung uebernommen", async () => {
  const res = await zuordnen([kosten({ currency: " eur ", billed_sec: "125" }), kosten({ record_type: "recording", billed_sec: 7, cost: "2" })]);
  assert.deepEqual(res, {
    ok: true,
    records: [
      { recordType: "sip-trunking", costMicroCents: 350000, currency: "EUR", billedSec: 125, ttsCharacters: null, legId: LEG },
      { recordType: "recording", costMicroCents: 200000000, currency: "EUR", billedSec: 7, ttsCharacters: null, legId: LEG },
    ],
  });
  const ohneDauer = await zuordnen([kosten({ billed_sec: "abc" })]);
  assert.equal(ohneDauer.records[0].billedSec, null);
});

test("Kostenbelege: Zeichen zaehlen nur bei Sprachausgabe von ElevenLabs", async () => {
  const tts = (extra) => kosten({ record_type: "text-to-speech", provider: "ElevenLabs", number_of_characters: "480", ...extra });
  const zeichen = async (raw) => (await zuordnen([raw])).records[0].ttsCharacters;
  assert.equal(await zeichen(tts()), 480);
  assert.equal(await zeichen(tts({ provider: " ELEVENLABS " })), 480);
  assert.equal(await zeichen(tts({ provider: "telnyx" })), null);
  assert.equal(await zeichen(tts({ provider: undefined })), null);
  assert.equal(await zeichen(tts({ record_type: "recording" })), null);
  assert.equal(await zeichen(tts({ number_of_characters: "-3" })), null);
  assert.equal(await zeichen(tts({ number_of_characters: 12 })), 12);
});

test("Kostenbelege: Betrag wird exakt in Mikrocent gerechnet, Unbrauchbares lehnt der Beleg ab", async () => {
  const faelle = [
    ["1", 100000000], ["0.0035", 350000], ["1.5e-3", 150000], ["2E2", 20000000000], [" 2 ", 200000000],
    ["0", 0], ["0.00000001", 1], ["0.000000019", 1], ["0.000000001", 0], ["1e-12", 0], ["1e+2", 10000000000],
    ["1000000", 100000000000000], ["1e6", 100000000000000], ["1e0001", 1000000000], ["12.50", 1250000000],
    ["10000000", null], ["1e7", null], ["1e-13", null], ["1e00001", null], ["1e-0013", null],
    ["-1", null], ["+1", null], ["abc", null], ["", null], ["  ", null], ["1.", null], [".5", null], ["1e", null], [5, null], [undefined, null],
  ];
  for (const [cost, erwartet] of faelle) {
    const res = await zuordnen([kosten({ cost })]);
    if (erwartet === null) assert.deepEqual(res.records, [], `cost=${cost}`);
    else assert.equal(res.records[0]?.costMicroCents, erwartet, `cost=${cost}`);
  }
});

test("Kostenbelege: Zuordnung ueber Anker, Sitzung und Waehrung mit Ablehnungsgrund im Log", async () => {
  const pool = [
    kosten({ sip_call_id: undefined, call_control_id: LEG, telnyx_session_id: "S1" }),
    kosten({ call_control_id: "anderer", sip_call_id: LEG }),
    kosten({ call_control_id: "x", telnyx_session_id: "S1", record_type: "call-control" }),
    kosten({ call_control_id: "y", call_session_id: "S1", record_type: "recording" }),
    kosten({ call_control_id: "z", telnyx_session_id: "S9" }),
    kosten({ call_control_id: "w" }),
    kosten({ currency: "USD" }),
    kosten({ currency: "" }),
    kosten({ currency: undefined }),
    kosten({ cost: "kaputt" }),
  ];
  let res;
  const zeilen = await captureConsole(async () => {
    res = await zuordnen(pool);
  });
  assert.deepEqual(res.records.map((r) => r.recordType), ["sip-trunking", "sip-trunking", "call-control", "recording"]);
  assert.deepEqual(zeilen, [
    '[telnyx/voice] getVoiceCostRecords ok records=4 via_anchor=2 via_telnyx_session_id=1 via_call_session_id=1 rejected={"session_mismatch":1,"session_unresolved":1,"currency_mismatch":3,"cost_unparsable":1}',
  ]);
  const ohneTreffer = await captureConsole(async () => {
    await zuordnen([]);
  });
  assert.deepEqual(ohneTreffer, ['[telnyx/voice] getVoiceCostRecords ok records=0 via_anchor=0 via_telnyx_session_id=0 via_call_session_id=0 rejected={}']);
});

test("Kostenbelege: Beleg-Zeitfenster gilt inklusive der Grenzen, fehlende oder kaputte Zeit laesst durch", async () => {
  const faelle = [
    [{ recorded_at: START }, true],
    [{ recorded_at: END }, true],
    [{ recorded_at: "2024-05-01T09:59:59Z" }, false],
    [{ recorded_at: "2024-05-01T10:10:01Z" }, false],
    [{ created_at: "2024-05-01T10:05:00Z" }, true],
    [{ created_at: "2024-05-01T11:00:00Z" }, false],
    [{ recorded_at: "2024-05-01T10:05:00Z", created_at: "2020-01-01T00:00:00Z" }, true],
    [{ recorded_at: "2020-01-01T00:00:00Z", created_at: "2024-05-01T10:05:00Z" }, false],
    [{ recorded_at: "kein Datum" }, true],
    [{ recorded_at: "" }, true],
    [{}, true],
  ];
  for (const [zeit, erwartet] of faelle) {
    const res = await zuordnen([kosten(zeit)]);
    assert.equal(res.records.length, erwartet ? 1 : 0, JSON.stringify(zeit));
  }
  const zeilen = await captureConsole(async () => {
    await zuordnen([kosten({ recorded_at: "2020-01-01T00:00:00Z" })]);
  });
  assert.match(zeilen[0], /rejected=\{"out_of_window":1\}$/);
});
