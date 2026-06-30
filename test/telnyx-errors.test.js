// Gemeinsamer Telnyx-Fehler-Envelope-Helper (errors.js): EIN Parser fuer voice + numbers.
// Rein offline: ein minimales Fake-res-Objekt (ok/status/text) genuegt - kein fetch, keine
// echte Telnyx-API (F.I.R.S.T.). Sichert die Leak-Allowlist (Regel 4/5) an einer Stelle ab.
import { test } from "node:test";
import assert from "node:assert/strict";

const { assertTelnyxOk } = await import("../src/telephony/adapters/telnyx/errors.js");

// Fake-res: text() liefert single-use den Body-String; json() wird vom !ok-Pfad nie genutzt.
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
  // detail traegt hier ein Fragment, das NIE leaken darf (Allowlist code/title).
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
