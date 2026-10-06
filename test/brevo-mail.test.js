import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBrevoMailer, verifyBrevoAccount } from "../src/brevo-mail.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const API_KEY = "xkeysib-should-never-leak-9f8a7b6c5d4e";
const FROM = "kuendigung@sundartha.example";
const TO = "kunde@example.test";

function mailConfig(over = {}) {
  return withConfigNamespaces({ brevoApiKey: API_KEY, mailFrom: FROM, ...over });
}

function fakeFetch(responses) {
  const calls = [];
  let i = 0;
  const fn = async (url, opts) => {
    calls.push({ url, opts });
    const r = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return r;
  };
  fn.calls = calls;
  return fn;
}

function okResponse() {
  return { ok: true, status: 201 };
}

function errorResponse(status) {
  return { ok: false, status };
}

test("Pflichttest 1: sendMail ruft POST /v3/smtp/email mit Empfaenger/Absender/Betreff/Text auf", async () => {
  const _fetch = fakeFetch([okResponse()]);
  const mailer = makeBrevoMailer(mailConfig(), { _fetch });

  await mailer.sendMail({ to: TO, subject: "Bestätigung Ihrer Kündigung", text: "Hallo,\n\ninhalt" });

  assert.equal(_fetch.calls.length, 1, "genau EIN HTTP-Aufruf");
  const { url, opts } = _fetch.calls[0];
  assert.equal(url, "https://api.brevo.com/v3/smtp/email");
  assert.equal(opts.method, "POST");
  assert.equal(opts.headers["api-key"], API_KEY);
  assert.equal(opts.headers["content-type"], "application/json");

  const body = JSON.parse(opts.body);
  assert.deepEqual(body.sender, { email: FROM });
  assert.deepEqual(body.to, [{ email: TO }]);
  assert.equal(body.subject, "Bestätigung Ihrer Kündigung");
  assert.equal(body.textContent, "Hallo,\n\ninhalt");
});

test("Pflichttest 2: Provider-Fehler -> sendMail wirft, Fehlermeldung ohne Key/Empfaengeradresse", async () => {
  const _fetch = fakeFetch([errorResponse(401)]);
  const mailer = makeBrevoMailer(mailConfig(), { _fetch });

  await assert.rejects(
    mailer.sendMail({ to: TO, subject: "s", text: "t" }),
    (err) => {
      assert.equal(err.code, "http_401");
      const all = `${err.message} ${err.code}`;
      assert.doesNotMatch(all, new RegExp(API_KEY));
      assert.doesNotMatch(all, new RegExp(TO.replace(".", "\\.")));
      return true;
    },
  );
});

test("Pflichttest 2b: Fehler-Response-Body wird NIE gelesen (kein res.text()/res.json() im Fehlerpfad)", async () => {
  let textCalled = false;
  const _fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => {
      textCalled = true;
      return `invalid recipient ${TO}`;
    },
    json: async () => {
      textCalled = true;
      return { message: TO };
    },
  });
  const mailer = makeBrevoMailer(mailConfig(), { _fetch });

  await assert.rejects(mailer.sendMail({ to: TO, subject: "s", text: "t" }));
  assert.equal(textCalled, false, "Antwortkoerper darf im Fehlerpfad nie gelesen werden");
});

test("verifyBrevoAccount: ruft GET /v3/account mit api-key-Header auf, wirft NICHT bei Erfolg", async () => {
  const _fetch = fakeFetch([{ ok: true, status: 200 }]);

  await assert.doesNotReject(verifyBrevoAccount(mailConfig(), { _fetch }));

  assert.equal(_fetch.calls.length, 1);
  const { url, opts } = _fetch.calls[0];
  assert.equal(url, "https://api.brevo.com/v3/account");
  assert.equal(opts.headers["api-key"], API_KEY);
});

test("verifyBrevoAccount: Provider-Fehler -> wirft mit http_<status>-Code, keine Mail verschickt", async () => {
  const _fetch = fakeFetch([{ ok: false, status: 401 }]);

  await assert.rejects(verifyBrevoAccount(mailConfig(), { _fetch }), (err) => {
    assert.equal(err.code, "http_401");
    return true;
  });
  assert.equal(_fetch.calls.length, 1);
  assert.equal(_fetch.calls[0].url, "https://api.brevo.com/v3/account");
});
