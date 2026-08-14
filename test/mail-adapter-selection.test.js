// mail-adapter-selection (312k-Phase 5, HTTP-Fortsetzung): EINE Stelle, EINE Rangfolge
// (wiring/web-login.js selectMailer) entscheidet, welcher Mail-Adapter konstruiert wird.
// Reiner Unit-Test der Auswahlfunktion, offline (injizierte Konstruktoren statt echtem
// nodemailer/fetch) - Muster test/config-namespaces.test.js Setter-Durchschlag-Test:
// beweist die Rangfolge, nicht die Adapter selbst (die haben eigene Tests, s.
// brevo-mail.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectMailer } from "../src/wiring/web-login.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

function mailConfig(over = {}) {
  return withConfigNamespaces({ brevoApiKey: "", smtpHost: "", ...over });
}

function fakeConstructor(tag) {
  const fn = (config) => ({ tag, config });
  fn.calls = 0;
  const wrapped = (config) => {
    wrapped.calls += 1;
    return fn(config);
  };
  wrapped.calls = 0;
  return wrapped;
}

test("Rangfolge 1: Brevo-Schluessel gesetzt -> HTTP-Adapter, SMTP-Konstruktor wird nie aufgerufen", () => {
  const _makeBrevoMailer = fakeConstructor("brevo");
  const _makeSmtpMailer = fakeConstructor("smtp");

  const mailer = selectMailer(mailConfig({ brevoApiKey: "brevo-key" }), {
    _makeBrevoMailer,
    _makeSmtpMailer,
  });

  assert.equal(mailer.tag, "brevo");
  assert.equal(_makeBrevoMailer.calls, 1);
  assert.equal(_makeSmtpMailer.calls, 0);
});

test("Rangfolge 2: nur SMTP-Host gesetzt -> SMTP-Adapter", () => {
  const _makeBrevoMailer = fakeConstructor("brevo");
  const _makeSmtpMailer = fakeConstructor("smtp");

  const mailer = selectMailer(mailConfig({ smtpHost: "smtp.zoho.eu" }), {
    _makeBrevoMailer,
    _makeSmtpMailer,
  });

  assert.equal(mailer.tag, "smtp");
  assert.equal(_makeBrevoMailer.calls, 0);
  assert.equal(_makeSmtpMailer.calls, 1);
});

test("Rangfolge 3: nichts gesetzt -> kein Mailer (null), kein Konstruktor aufgerufen", () => {
  const _makeBrevoMailer = fakeConstructor("brevo");
  const _makeSmtpMailer = fakeConstructor("smtp");

  const mailer = selectMailer(mailConfig(), { _makeBrevoMailer, _makeSmtpMailer });

  assert.equal(mailer, null);
  assert.equal(_makeBrevoMailer.calls, 0);
  assert.equal(_makeSmtpMailer.calls, 0);
});

test("Rangfolge 4: BEIDE gesetzt -> Brevo gewinnt (dieselbe Rangfolge wie die Boot-Sonde)", () => {
  const _makeBrevoMailer = fakeConstructor("brevo");
  const _makeSmtpMailer = fakeConstructor("smtp");

  const mailer = selectMailer(mailConfig({ brevoApiKey: "brevo-key", smtpHost: "smtp.zoho.eu" }), {
    _makeBrevoMailer,
    _makeSmtpMailer,
  });

  assert.equal(mailer.tag, "brevo");
  assert.equal(_makeSmtpMailer.calls, 0);
});
