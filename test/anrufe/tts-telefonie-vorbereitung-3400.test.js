import assert from "node:assert/strict";
import { test, mock } from "node:test";

import { config } from "../../src/config.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { NUMBER_STATUS } from "../../src/begriffe/nummern.js";
import { PLATFORM_NUMBER_PURPOSE } from "../../src/begriffe/nummern-vergabe.js";
import { anthropicWebSearch } from "../../src/research/adapters/anthropic-web-search.js";
import { antwortdauerMiddleware } from "../../src/telephony/antwortdauer.js";
import {
  platformAlertSender,
  resolveBootstrapAlertSender,
  sendBootstrapAlertSms,
  sendeVorfall,
} from "../../src/telephony/alert-sms.js";
import { kontoBesitzt } from "../../src/telephony/outbound-config-drift.js";
import { reattachActiveCall } from "../../src/telephony/reattach.js";
import { synthesizeSpeechStream } from "../../src/tts/synth.js";
import { starteBetterStackAttrappe } from "../gemeinsam/better-stack-attrappe.mjs";
import { FAKE_FIRST_CHUNK, fakeTtsStreamResponse } from "../helpers/fake-tts-stream.mjs";

const E164 = "+49111";
const BOOTSTRAP_NUMMER = { tenantId: BOOTSTRAP_TENANT_ID, status: NUMBER_STATUS.ACTIVE, provider: "telnyx", e164: E164 };

function synthOptionen(ueberschreibungen = {}) {
  return {
    apiKey: "k",
    voiceId: "v1",
    model: "m",
    apiBase: "https://api.example.test",
    outputFormat: "mp3_44100_128",
    firstChunkTimeoutMs: 2000,
    totalTimeoutMs: 10000,
    ...ueberschreibungen,
  };
}

function melde(ereignis, aufruf) {
  const zeilen = [];
  const stumm = mock.method(console, ereignis, (...teile) => zeilen.push(teile.join(" ")));
  return Promise.resolve(aufruf()).then(
    (wert) => {
      stumm.mock.restore();
      return { wert, zeilen };
    },
    (fehler) => {
      stumm.mock.restore();
      throw fehler;
    },
  );
}

const CONTENT_TYPE_TABELLE = [
  ["", "audio/mpeg"],
  [null, "audio/mpeg"],
  [undefined, "audio/mpeg"],
  ["audio/ogg", "audio/ogg"],
];

for (const [kopf, erwartet] of CONTENT_TYPE_TABELLE) {
  test(`synth: Content-Type ${JSON.stringify(kopf)} liefert ${erwartet}`, async () => {
    const fetchImpl = async () => {
      const antwort = fakeTtsStreamResponse();
      return { ...antwort, headers: { get: () => kopf } };
    };
    const ergebnis = await synthesizeSpeechStream("x", { ...synthOptionen(), fetchImpl });
    assert.equal(ergebnis.ok, true);
    assert.equal(ergebnis.contentType, erwartet);
    assert.deepEqual(Array.from((await ergebnis.audio).bytes.subarray(0, FAKE_FIRST_CHUNK.length)), [...FAKE_FIRST_CHUNK]);
  });
}

test("synth: HTTP-Fehler nennt den Status als http_<zahl> samt Text", async () => {
  const fetchImpl = async () => ({ ok: false, status: 429, text: async () => "zu viele" });
  assert.deepEqual(await synthesizeSpeechStream("x", { ...synthOptionen(), fetchImpl }), {
    ok: false,
    reason: "http_429",
    detail: "zu viele",
  });
});

const FEHLER_TABELLE = [
  [{ name: "AbortError" }, "timeout"],
  [{ name: "TypeError" }, "error"],
  [{ name: 5 }, "error"],
  [null, "error"],
  [undefined, "error"],
  ["AbortError", "error"],
];

for (const [geworfen, grund] of FEHLER_TABELLE) {
  test(`synth: geworfen ${JSON.stringify(geworfen)} ergibt ${grund}`, async () => {
    const fetchImpl = async () => {
      throw geworfen;
    };
    assert.deepEqual(await synthesizeSpeechStream("x", { ...synthOptionen(), fetchImpl }), { ok: false, reason: grund });
  });
}

test("synth: die Frist fuers erste Paket bricht die Anfrage ab (timeout)", async () => {
  const fetchImpl = (url, init) =>
    new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("abgebrochen"), { name: "AbortError" })));
    });
  const ergebnis = await synthesizeSpeechStream("x", { ...synthOptionen({ firstChunkTimeoutMs: 5 }), fetchImpl });
  assert.deepEqual(ergebnis, { ok: false, reason: "timeout" });
});

function stoppuhr(werte) {
  const folge = [...werte];
  return mock.method(Date, "now", () => folge.length > 1 ? folge.shift() : folge[0]);
}

function antwortAttrappe({ endeFertig, status = 200 }) {
  let schliessen;
  const res = {
    locals: {},
    writableFinished: endeFertig,
    statusCode: status,
    on: (name, aufruf) => {
      if (name === "close") schliessen = aufruf;
    },
  };
  return { res, schliessen: () => schliessen() };
}

const ANTWORTDAUER_TABELLE = [
  [{ endeFertig: true, status: 200, route: { path: "/voice/status" } }, "[voice-antwort] weg=/voice/status ms=250 status=200 ende=beendet"],
  [{ endeFertig: false, status: 503, route: undefined }, "[voice-antwort] weg=ohne-route ms=250 status=503 ende=abgebrochen"],
];

for (const [eingabe, zeile] of ANTWORTDAUER_TABELLE) {
  test(`antwortdauer: schreibt ${zeile}`, async () => {
    const uhr = stoppuhr([1000, 1250]);
    const { res, schliessen } = antwortAttrappe(eingabe);
    let weiter = 0;
    const { zeilen } = await melde("log", () => {
      antwortdauerMiddleware({ route: eingabe.route }, res, () => weiter++);
      schliessen();
    });
    uhr.mock.restore();
    assert.equal(weiter, 1);
    assert.equal(res.locals.eingangMs, 1000);
    assert.deepEqual(zeilen, [zeile]);
  });
}

const TREFFER = { e164: E164, status: "active" };
const KONTO_TABELLE = [
  [null, "unbekannt"],
  [undefined, "unbekannt"],
  [0, "unbekannt"],
  ["", "unbekannt"],
  [{ ok: false, wert: { treffer: [TREFFER] } }, "unbekannt"],
  [{ ok: 1, wert: { treffer: [TREFFER] } }, "unbekannt"],
  [{}, "unbekannt"],
  [{ ok: true }, "verloren"],
  [{ ok: true, wert: null }, "verloren"],
  [{ ok: true, wert: 0 }, "verloren"],
  [{ ok: true, wert: { treffer: null } }, "verloren"],
  [{ ok: true, wert: { treffer: 0 } }, "verloren"],
  [{ ok: true, wert: { treffer: "" } }, "verloren"],
  [{ ok: true, wert: { treffer: [] } }, "verloren"],
  [{ ok: true, wert: { treffer: [{ e164: "+49222", status: "active" }] } }, "verloren"],
  [{ ok: true, wert: { treffer: [{ e164: E164, status: "released" }] } }, "verloren"],
  [{ ok: true, wert: { treffer: [TREFFER] } }, "besitzt"],
  [{ ok: true, wert: { treffer: [{ e164: "+49222", status: "active" }, TREFFER] } }, "besitzt"],
];

for (const [eingabe, erwartet] of KONTO_TABELLE) {
  test(`kontoBesitzt: ${JSON.stringify(eingabe)} ergibt ${erwartet}`, () => {
    assert.equal(kontoBesitzt(eingabe, E164), erwartet);
  });
}

const AKTIV = { id: "c1", twilioSid: "CA1", status: "active", answeredAt: new Date().toISOString(), startedAt: null, maxDurationS: null };

function abhaengigkeiten(angebunden) {
  const protokoll = [];
  return {
    protokoll,
    deps: {
      attachActiveCall: async () => {
        if (angebunden instanceof Error) throw angebunden;
        return angebunden;
      },
      maxCallDurationS: 180,
      terminateCappedCall: async () => protokoll.push("kappen"),
      scheduleMaxDurationEnd: (call, sid, rest) => protokoll.push(["planen", call.id, sid, rest > 0]),
      budgetAxisFor: () => null,
      terminateOverBudgetCall: async () => protokoll.push("budget"),
    },
  };
}

const REATTACH_TABELLE = [
  [null, { call: null, logUnknown: true }],
  [undefined, { call: null, logUnknown: true }],
  [{ ...AKTIV, status: "ended" }, { call: null, logUnknown: true }],
  [new Error("weg"), { call: null, logUnknown: false, fehlgeschlagen: true }],
];

for (const [angebunden, erwartet] of REATTACH_TABELLE) {
  test(`reattach: ${angebunden instanceof Error ? "Fehler" : JSON.stringify(angebunden?.status ?? angebunden)} ergibt ${JSON.stringify(erwartet)}`, async () => {
    const { deps, protokoll } = abhaengigkeiten(angebunden);
    assert.deepEqual(await reattachActiveCall("r-tabelle", deps), erwartet);
    assert.deepEqual(protokoll, []);
  });
}

test("reattach: aktiver Anruf wird mit Restzeit eingeplant und zurueckgegeben", async () => {
  const { deps, protokoll } = abhaengigkeiten(AKTIV);
  const ergebnis = await reattachActiveCall("r-aktiv", deps);
  assert.equal(ergebnis.call, AKTIV);
  assert.deepEqual(protokoll, [["planen", "c1", "CA1", true]]);
});

const SUCHZAEHLER_TABELLE = [
  [undefined, null],
  [null, null],
  [{}, null],
  [{ usage: {} }, null],
  [{ usage: { server_tool_use: {} } }, null],
  [{ usage: { server_tool_use: { web_search_requests: 0 } } }, 0],
  [{ usage: { server_tool_use: { web_search_requests: 3 } } }, 3],
];

for (const [zug, erwartet] of SUCHZAEHLER_TABELLE) {
  test(`anthropic-web-search: searchCount ${JSON.stringify(zug)} ergibt ${erwartet}`, () => {
    assert.equal(anthropicWebSearch.searchCount(zug), erwartet);
  });
}

test("anthropic-web-search: researchTools nennt das Werkzeug mit der Obergrenze aus der Konfiguration", () => {
  assert.deepEqual(anthropicWebSearch.researchTools(), [
    { type: "web_search_20250305", name: "web_search", max_uses: config.research.researchMaxUses },
  ]);
});

function speicher(zustand) {
  return { load: () => zustand };
}

test("alert-sms: Bootstrap-Absender ist die Nummer selbst, ohne Treffer null mit Warnung", async () => {
  const { wert, zeilen } = await melde("warn", () => [
    resolveBootstrapAlertSender(speicher({ numbers: [BOOTSTRAP_NUMMER] })),
    resolveBootstrapAlertSender(speicher({ numbers: [] })),
  ]);
  assert.deepEqual(wert[0], BOOTSTRAP_NUMMER);
  assert.equal(wert[1], null);
  assert.deepEqual(zeilen, ["[alert-sms] Plattform-Alarm: keine aktive Bootstrap-Nummer, KEINE SMS"]);
});

const BINDUNGS_TABELLE = [
  [[], null],
  [[{ purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER, releasedAt: "2026-01-01", e164: E164, provider: "telnyx" }], null],
  [[{ purpose: "outbound_ani", releasedAt: null, e164: E164, provider: "telnyx" }], null],
  [[{ purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER, releasedAt: null, e164: "", provider: "telnyx" }], null],
  [[{ purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER, releasedAt: null, e164: E164, provider: "telnyx", extra: 1 }], { provider: "telnyx", e164: E164 }],
];

for (const [nutzung, erwartet] of BINDUNGS_TABELLE) {
  test(`alert-sms: platformAlertSender fuer ${nutzung.length} Bindung(en) ergibt ${JSON.stringify(erwartet)}`, async () => {
    const { wert } = await melde("warn", () => platformAlertSender(speicher({ platformNumberUse: nutzung })));
    assert.deepEqual(wert, erwartet);
  });
}

const VORFALL_FEHLER_TABELLE = [
  [{ name: "TimeoutError" }, "TimeoutError"],
  [null, "undefined"],
  [undefined, "undefined"],
  ["Text", "undefined"],
];

for (const [geworfen, name] of VORFALL_FEHLER_TABELLE) {
  test(`alert-sms: sendeVorfall loggt bei geworfen ${JSON.stringify(geworfen)} den Namen ${name}`, async () => {
    const abruf = mock.method(globalThis, "fetch", async () => {
      throw geworfen;
    });
    const { wert, zeilen } = await melde("error", () =>
      sendeVorfall({ adresse: "http://127.0.0.1:9/x", anlass: "t", schluessel: "s1", status: "alert", meldezeile: "m" }),
    );
    abruf.mock.restore();
    assert.equal(wert, false);
    assert.deepEqual(zeilen, [`[t] Better-Stack-Meldung s1 nicht zugestellt: ${name}`]);
  });
}

test("alert-sms: sendeVorfall loggt den HTTP-Status einer Ablehnung", async () => {
  const attrappe = await starteBetterStackAttrappe({ antwortStatus: 500 });
  try {
    const { wert, zeilen } = await melde("error", () =>
      sendeVorfall({ adresse: attrappe.url, anlass: "t", schluessel: "s2", status: "alert", meldezeile: "m" }),
    );
    assert.equal(wert, false);
    assert.deepEqual(zeilen, ["[t] Better-Stack-Meldung s2 nicht zugestellt: HTTP 500"]);
  } finally {
    await attrappe.close();
  }
});

test("alert-sms: sendBootstrapAlertSms meldet an die Adresse der Konfiguration", async () => {
  const attrappe = await starteBetterStackAttrappe();
  try {
    sendBootstrapAlertSms({ config: { billing: { betterstackAlertUrl: attrappe.url } }, prefix: "p ", detail: "d", logTag: "tag" });
    const meldungen = await attrappe.aufMeldungen(1);
    assert.equal(meldungen[0].text, "p d");
    assert.match(meldungen[0].id, /^tag:/);
  } finally {
    await attrappe.close();
  }
});

const ADRESSEN_TABELLE = [{ betterstackAlertUrl: "" }, { betterstackAlertUrl: null }, {}];

for (const billing of ADRESSEN_TABELLE) {
  test(`alert-sms: sendBootstrapAlertSms ohne gueltige Adresse ${JSON.stringify(billing)} sendet nichts und wirft nicht`, () => {
    const abruf = mock.method(globalThis, "fetch", async () => {
      throw new Error("darf nicht gerufen werden");
    });
    assert.doesNotThrow(() => sendBootstrapAlertSms({ config: { billing }, prefix: "p", detail: "d", logTag: "t" }));
    assert.equal(abruf.mock.callCount(), 0);
    abruf.mock.restore();
  });
}

test("alert-sms: sendBootstrapAlertSms ohne billing in der Konfiguration wirft", () => {
  assert.throws(() => sendBootstrapAlertSms({ config: {}, prefix: "p", detail: "d", logTag: "t" }));
});
