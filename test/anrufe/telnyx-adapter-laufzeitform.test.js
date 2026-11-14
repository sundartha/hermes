import assert from "node:assert/strict";
import { test } from "node:test";

import { config } from "../../src/config.js";
import { parseDecimalToMicroCents, parseNonNegativeInteger } from "../../src/telephony/adapters/telnyx/cost-parse.js";
import { assertTelnyxOk } from "../../src/telephony/adapters/telnyx/errors.js";
import { telnyxAuthHeaders, telnyxJson, telnyxUrl } from "../../src/telephony/adapters/telnyx/http.js";
import { TS_HEADER, verifyInboundSignature } from "../../src/telephony/adapters/telnyx/signature.js";
import { SPEAK_OUTCOME, parseSpeakEvent } from "../../src/telephony/adapters/telnyx/speak-events.js";
import { TELNYX_MESSZEILE_SCHLUESSEL } from "../gemeinsam/erfundene-geheimnisse.js";
import { makeTelnyxSigner, nowSeconds } from "../helpers.js";

function mitTelephony(werte, lauf) {
  const alt = { ...config.telephony };
  Object.assign(config.telephony, werte);
  try {
    return lauf();
  } finally {
    Object.assign(config.telephony, alt);
  }
}

test("3400-telnyx: Kostenparser liefert je Eingabe genau diesen Wert", () => {
  const tabelle = [
    ["0", 0],
    ["12", 1200000000],
    ["0.5", 50000000],
    ["0.0021", 210000],
    ["1e-2", 1000000],
    ["1E2", 10000000000],
    [" 3 ", 300000000],
    ["", null],
    ["-1", null],
    ["+1", null],
    ["1e7", null],
    ["1e-13", null],
    ["1e00000", null],
    ["abc", null],
    [5, null],
    [undefined, null],
  ];
  for (const [roh, erwartet] of tabelle) assert.equal(parseDecimalToMicroCents(roh), erwartet, String(roh));
});

test("3400-telnyx: ganze Zahlen aus Zahl oder Text, sonst null", () => {
  const tabelle = [
    [0, 0],
    [7, 7],
    [-1, null],
    [1.5, null],
    ["42", 42],
    [" 42 ", 42],
    ["4.2", null],
    ["-4", null],
    ["", null],
    [null, null],
    ["9".repeat(20), null],
  ];
  for (const [roh, erwartet] of tabelle) assert.equal(parseNonNegativeInteger(roh), erwartet, String(roh));
});

function antwort({ ok = false, status = 500, text = "" } = {}) {
  return { ok, status, text: async () => text };
}

async function fehlerVon(res, op, optionen) {
  try {
    await assertTelnyxOk(res, op, optionen);
  } catch (err) {
    return err;
  }
  return null;
}

test("3400-telnyx: Fehlertext je Antwortkoerper, unlesbare Koerper ergeben nur den Status", async () => {
  const tabelle = [
    ["null", "Telnyx op fehlgeschlagen: HTTP 500"],
    ["[]", "Telnyx op fehlgeschlagen: HTTP 500"],
    ["{}", "Telnyx op fehlgeschlagen: HTTP 500"],
    ['{"errors":"x"}', "Telnyx op fehlgeschlagen: HTTP 500"],
    ["kein json", "Telnyx op fehlgeschlagen: HTTP 500"],
    ["", "Telnyx op fehlgeschlagen: HTTP 500"],
    ['{"errors":[null,{"code":0,"title":"Null"}]}', "Telnyx op fehlgeschlagen: HTTP 500 (0 Null)"],
    ['{"errors":[{"code":null,"title":"T"},{"title":"U"}]}', "Telnyx op fehlgeschlagen: HTTP 500 (T; U)"],
    ['{"errors":[{"code":"1","title":"A"},{"code":2,"title":"B"}]}', "Telnyx op fehlgeschlagen: HTTP 500 (1 A; 2 B)"],
  ];
  for (const [text, erwartet] of tabelle) {
    const err = await fehlerVon(antwort({ text }), "op");
    assert.equal(err.message, erwartet, text);
  }
});

test("3400-telnyx: Detail nur auf Wunsch und auf 200 Zeichen gekuerzt, Status und Code nur auf Wunsch", async () => {
  const koerper = JSON.stringify({ errors: [{ code: 7, title: "T", detail: "d".repeat(250) }, { code: 0, detail: 0 }] });
  const ohne = await fehlerVon(antwort({ status: 402, text: koerper }), "op");
  assert.equal(ohne.message, "Telnyx op fehlgeschlagen: HTTP 402 (7 T; 0)");
  assert.equal(ohne.providerStatus, undefined);
  assert.equal(ohne.providerCode, "7");
  const mit = await fehlerVon(antwort({ status: 402, text: koerper }), "op", { includeDetail: true, attachStatus: true });
  assert.equal(mit.message, `Telnyx op fehlgeschlagen: HTTP 402 (7 T: ${"d".repeat(200)}; 0)`);
  assert.equal(mit.providerStatus, 402);
  const ohneCode = await fehlerVon(antwort({ text: '{"errors":[{"title":"T"}]}' }), "op", { attachStatus: true });
  assert.equal(ohneCode.providerCode, undefined);
  assert.equal(ohneCode.providerStatus, 500);
  assert.equal(await fehlerVon(antwort({ ok: true }), "op"), null);
});

test("3400-telnyx: nicht lesbarer Antwortkoerper ergibt nur den Status", async () => {
  const res = { ok: false, status: 503, text: async () => Promise.reject(new Error("kaputt")) };
  assert.equal((await fehlerVon(res, "op")).message, "Telnyx op fehlgeschlagen: HTTP 503");
});

test("3400-telnyx: Anfragekopf traegt den Schluessel, ohne Schluessel wird abgelehnt", () => {
  mitTelephony({ telnyxApiKey: TELNYX_MESSZEILE_SCHLUESSEL, telnyxApiBase: "https://api.example" }, () => {
    assert.deepEqual(telnyxAuthHeaders(), {
      Authorization: `Bearer ${TELNYX_MESSZEILE_SCHLUESSEL}`,
      "Content-Type": "application/json",
    });
    assert.equal(telnyxAuthHeaders({ "Content-Type": "x", Extra: "1" })["Content-Type"], "x");
    assert.equal(telnyxAuthHeaders({ Extra: "1" }).Extra, "1");
    assert.equal(telnyxUrl("/v2/calls"), "https://api.example/v2/calls");
  });
  for (const key of ["", undefined, null]) {
    mitTelephony({ telnyxApiKey: key }, () => {
      assert.throws(() => telnyxAuthHeaders(), /Telnyx: TELNYX_API_KEY fehlt/, String(key));
    });
  }
});

test("3400-telnyx: lange Kennungen bleiben als Text erhalten, leere Antwort ergibt ein leeres Objekt", async () => {
  const lang = "12345678901234567";
  const koerper = `{"data":{"id":${lang},"connection_id":${lang},"phone_number_id":${lang},"zahl":${lang}}}`;
  const heraus = await telnyxJson(antwort({ ok: true, text: koerper }));
  assert.equal(heraus.data.id, lang);
  assert.equal(heraus.data.connection_id, lang);
  assert.equal(heraus.data.phone_number_id, lang);
  assert.notEqual(heraus.data.zahl, lang);
  assert.deepEqual(await telnyxJson(antwort({ ok: true, text: "" })), {});
});

test("3400-telnyx: Signaturpruefung nimmt nur gueltige Signaturen und lehnt alles andere ab", () => {
  const signer = makeTelnyxSigner();
  const rawBody = Buffer.from('{"data":{}}');
  const ts = String(nowSeconds());
  const kopf = (sig, zeit = ts) => ({ "telnyx-signature-ed25519": sig, [TS_HEADER]: zeit });
  mitTelephony({ telnyxPublicKey: signer.publicKeyBase64 }, () => {
    assert.equal(verifyInboundSignature({ headers: kopf(signer.sign(ts, rawBody)), rawBody }), true);
    assert.equal(verifyInboundSignature({ headers: kopf(signer.sign(ts, Buffer.from("x"))), rawBody }), false);
    assert.equal(verifyInboundSignature({ headers: kopf(""), rawBody }), false);
    assert.equal(verifyInboundSignature({ headers: {}, rawBody }), false);
    assert.equal(verifyInboundSignature({ headers: kopf(signer.sign(ts, rawBody)), rawBody: undefined }), false);
    assert.equal(verifyInboundSignature({ headers: kopf(signer.sign("abc", rawBody), "abc"), rawBody }), false);
  });
  mitTelephony({ telnyxPublicKey: signer.publicKeyPem }, () => {
    assert.equal(verifyInboundSignature({ headers: kopf(signer.sign(ts, rawBody)), rawBody }), true);
  });
  const andere = makeTelnyxSigner();
  mitTelephony({ telnyxPublicKey: andere.publicKeyBase64 }, () => {
    assert.equal(verifyInboundSignature({ headers: kopf(signer.sign(ts, rawBody)), rawBody }), false);
  });
});

test("3400-telnyx: ohne brauchbaren oeffentlichen Schluessel wird jede Signatur abgelehnt", () => {
  const signer = makeTelnyxSigner();
  const rawBody = Buffer.from("{}");
  const ts = String(nowSeconds());
  const headers = { "telnyx-signature-ed25519": signer.sign(ts, rawBody), [TS_HEADER]: ts };
  const unbrauchbar = ["", undefined, null, 5, {}, "AAAA", "-----BEGIN kaputt"];
  for (const key of unbrauchbar) {
    mitTelephony({ telnyxPublicKey: key }, () => {
      assert.equal(verifyInboundSignature({ headers, rawBody }), false, String(key));
    });
  }
});

test("3400-telnyx: Sprechereignis ergibt je Form des Koerpers dieses Ergebnis", () => {
  const ereignis = (typ, payload) => ({ data: { event_type: typ, payload } });
  const ok = { outcome: SPEAK_OUTCOME.OK, reason: "completed" };
  const keins = { outcome: SPEAK_OUTCOME.NONE, reason: null };
  const fehl = (reason) => ({ outcome: SPEAK_OUTCOME.FAILED, reason });
  const tabelle = [
    [ereignis("call.speak.ended", { status: "completed" }), ok],
    [{ event_type: "call.speak.ended", payload: { status: "completed" } }, ok],
    [ereignis("call.speak.ended", { status: "failed" }), fehl("failed")],
    [ereignis("call.speak.ended", { status: "other" }), keins],
    [ereignis("call.speak.ended", undefined), keins],
    [ereignis("call.speak.ended", "completed"), keins],
    [ereignis("call.speak.ended", ["completed"]), keins],
    [ereignis("call.speak.started", { status: "completed" }), keins],
    [ereignis("call.speak.failed", { status: "failed" }), fehl("failed")],
    [ereignis("call.speak.failed", { status: "completed" }), fehl("completed")],
    [ereignis("call.speak.failed", { status: "seltsam" }), fehl("unknown")],
    [ereignis("call.speak.failed", { status: "" }), fehl("failed")],
    [ereignis("call.speak.failed", { status: 0 }), fehl("failed")],
    [ereignis("call.speak.failed", { status: null }), fehl("failed")],
    [ereignis("call.speak.failed", { status: false }), fehl("failed")],
    [ereignis("call.speak.failed", { status: undefined }), fehl("failed")],
    [ereignis("call.speak.failed", {}), fehl("failed")],
    [ereignis("call.speak.failed", undefined), fehl("failed")],
    [ereignis("call.speak.failed", 5), fehl("failed")],
    [ereignis("call.hangup", { status: "failed" }), fehl("failed")],
    [ereignis("", { status: "failed" }), keins],
    [ereignis(undefined, { status: "completed" }), keins],
    [{ data: 5, event_type: "call.speak.failed" }, fehl("failed")],
    [{ data: [], event_type: "call.speak.failed" }, keins],
    [{}, keins],
    [[], keins],
    [null, keins],
    ["call.speak.failed", keins],
    [5, keins],
  ];
  for (const [koerper, erwartet] of tabelle) assert.deepEqual(parseSpeakEvent(koerper), erwartet, JSON.stringify(koerper));
});
