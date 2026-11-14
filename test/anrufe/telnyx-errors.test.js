import { test } from "node:test";
import assert from "node:assert/strict";

const { assertTelnyxOk } = await import("../../src/telephony/adapters/telnyx/errors.ts");

function fakeRes({ ok = false, status = 500, text = "" }) {
  return { ok, status, text: async () => text };
}

const ENVELOPE = JSON.stringify({
  errors: [{ code: "10015", title: "Payment required", detail: "Account balance too low" }],
});

test("assertTelnyxOk: res.ok -> kein throw (No-Op)", async () => {
  await assertTelnyxOk(fakeRes({ ok: true, status: 200 }), "op");
});

test("assertTelnyxOk default: nur code+title, detail wird NICHT durchgereicht (voice-Pfad)", async () => {
  const body = JSON.stringify({
    errors: [{ code: "10015", title: "Caller ID not allowed", detail: "from=+18643028341 secret" }],
  });
  await assert.rejects(
    () => assertTelnyxOk(fakeRes({ status: 403, text: body }), "originateCall"),
    (err) => {
      assert.match(err.message, /HTTP 403/);
      assert.match(err.message, /10015/);
      assert.match(err.message, /Caller ID not allowed/);
      assert.ok(!err.message.includes("secret"), "detail-Fragment darf nicht leaken");
      assert.ok(!err.message.includes("+18643028341"), "Nummer (PII) darf nicht leaken");
      assert.equal(err.providerStatus, undefined, "ohne attachStatus kein providerStatus");
      return true;
    },
  );
});

test("assertTelnyxOk includeDetail: code+title+detail sichtbar (numbers 402-Diagnose)", async () => {
  await assert.rejects(
    () => assertTelnyxOk(fakeRes({ status: 402, text: ENVELOPE }), "orderNumber", { includeDetail: true }),
    (err) => {
      assert.match(err.message, /HTTP 402/);
      assert.match(err.message, /10015/);
      assert.match(err.message, /Payment required/);
      assert.match(err.message, /Account balance too low/);
      return true;
    },
  );
});

test("assertTelnyxOk includeDetail: detail wird auf 200 Zeichen gekuerzt (Log-Volumen)", async () => {
  const longDetail = "x".repeat(500);
  const body = JSON.stringify({ errors: [{ code: "1", title: "t", detail: longDetail }] });
  await assert.rejects(
    () => assertTelnyxOk(fakeRes({ status: 422, text: body }), "orderNumber", { includeDetail: true }),
    (err) => {
      assert.ok(err.message.includes("x".repeat(200)), "200 Zeichen detail enthalten");
      assert.ok(!err.message.includes("x".repeat(201)), "auf 200 Zeichen gekuerzt");
      return true;
    },
  );
});

test("assertTelnyxOk attachStatus: err.providerStatus gesetzt (Aufrufer-Kategorisierung)", async () => {
  await assert.rejects(
    () => assertTelnyxOk(fakeRes({ status: 403, text: ENVELOPE }), "originateCall", { attachStatus: true }),
    (err) => {
      assert.equal(err.providerStatus, 403);
      return true;
    },
  );
});

test("assertTelnyxOk: unbekannte Felder/Roh-Body werden NIE durchgereicht (Allowlist)", async () => {
  const body = JSON.stringify({
    secret_key: "KEYsuper-secret",
    errors: [{ code: "1", title: "t", meta: { token: "leak-me" } }],
  });
  await assert.rejects(
    () => assertTelnyxOk(fakeRes({ status: 500, text: body }), "op", { includeDetail: true }),
    (err) => {
      assert.ok(!err.message.includes("KEYsuper-secret"), "top-level Feld leakt nicht");
      assert.ok(!err.message.includes("leak-me"), "unbekanntes errors-Feld leakt nicht");
      return true;
    },
  );
});

test("assertTelnyxOk: nicht-JSON Body -> status-only, kein Rohtext (Leak-Schutz)", async () => {
  await assert.rejects(
    () => assertTelnyxOk(fakeRes({ status: 502, text: "<html>upstream error</html>" }), "op"),
    (err) => {
      assert.match(err.message, /^Telnyx op fehlgeschlagen: HTTP 502$/);
      assert.ok(!err.message.includes("upstream error"), "kein Roh-Body-Dump");
      return true;
    },
  );
});

test("assertTelnyxOk: leerer Body -> reiner status-only-Throw", async () => {
  await assert.rejects(
    () => assertTelnyxOk(fakeRes({ status: 402, text: "" }), "orderNumber", { includeDetail: true }),
    /Telnyx orderNumber fehlgeschlagen: HTTP 402$/,
  );
});

const RATE_LIMIT_ENVELOPE = JSON.stringify({
  errors: [{ code: "10011", title: "Too many requests", detail: "quota exceeded" }],
});

test("assertTelnyxOk: err.providerCode traegt den allowlisteten Telnyx-Code (strukturiert)", async () => {
  await assert.rejects(
    () => assertTelnyxOk(fakeRes({ status: 429, text: RATE_LIMIT_ENVELOPE }), "getVoiceCostRecords", { attachStatus: true }),
    (err) => {
      assert.equal(err.providerCode, "10011");
      assert.equal(err.providerStatus, 429);
      return true;
    },
  );
});

test("assertTelnyxOk: providerCode ist NUR der Code - nie detail, nie der Roh-Body (Allowlist)", async () => {
  const body = JSON.stringify({
    secret_key: "KEYsuper-secret",
    errors: [{ code: "10011", title: "t", detail: "from=+18643028341" }],
  });
  await assert.rejects(
    () => assertTelnyxOk(fakeRes({ status: 429, text: body }), "op", { includeDetail: true }),
    (err) => {
      assert.equal(err.providerCode, "10011", "auch mit includeDetail nur der nackte Code");
      return true;
    },
  );
});

test("assertTelnyxOk: Body ohne errors[].code -> kein providerCode (kein geratener Wert)", async () => {
  await assert.rejects(
    () => assertTelnyxOk(fakeRes({ status: 502, text: "<html>upstream error</html>" }), "op"),
    (err) => {
      assert.equal(err.providerCode, undefined, "nicht-JSON -> kein Code, keine Erfindung");
      return true;
    },
  );
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
