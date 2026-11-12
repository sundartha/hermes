import { test, mock } from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { config } from "../../src/config.js";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { SESSION_COOKIE_NAME } from "../../src/web-auth.js";
import { starteTelemetrie } from "../../src/utils/telemetrie.js";
import { makePgTestStore } from "../pg-helpers.js";
import { makeStripeStub, waitUntil } from "../helpers.js";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";
import { abrufMitFrist, fristSignal } from "../gemeinsam/antwortfrist.mjs";
import {
  BREVO_ABO_MESSUNG_SCHLUESSEL,
  STRIPE_ABO_MESSUNG_GEHEIMNIS,
  STRIPE_MAIL_ZAHLUNG_MESSUNG_SCHLUESSEL,
} from "../gemeinsam/erfundene-geheimnisse.js";
import request from "../gemeinsam/testserver-anfrage.mjs";
import { dauerPunkte, mitTelemetrie, zaehlerPunkte } from "../gemeinsam/anbieter-messung-export.mjs";

const HTTP_OK = 200;
const HTTP_CREATED = 201;
const HTTP_ZU_VIELE = 429;
const HTTP_FEHLER = 500;
const WORKOS = "https://api.workos.test";
const BREVO_VERSAND = "https://api.brevo.com/v3/smtp/email";
const STRIPE_BASIS = "https://api.stripe.test";
const EMPFAENGER_MAIL = "empfaenger@example.test";
const FEHLERTEXT_MIT_429 = "interner Fehler 429 fuer empfaenger@example.test";
const TENANT = "t_dev-user";
const WORKOS_NUTZER = "user_messung";
const KUNDE = "cus_messung";

const echtesFetch = globalThis.fetch;
const attrappe = { brevo: null, stripe: null, workos: null };
const anfragenAn = { brevo: 0, workos: 0 };

globalThis.fetch = async (url, init = {}) => {
  const ziel = String(url);
  if (ziel === BREVO_VERSAND) {
    anfragenAn.brevo++;
    return attrappe.brevo();
  }
  if (new URL(ziel).origin === WORKOS) {
    anfragenAn.workos++;
    return attrappe.workos(ziel, init);
  }
  if (new URL(ziel).origin === STRIPE_BASIS) return attrappe.stripe(ziel, init);
  return echtesFetch(url, {
    ...init,
    signal: AbortSignal.any([fristSignal(), ...(init.signal ? [init.signal] : [])]),
  });
};

const mitStripe = makeStripeStub(config, STRIPE_MAIL_ZAHLUNG_MESSUNG_SCHLUESSEL);

const basis = webLoginBasisKonfiguration(WORKOS);
const KONFIGURATION = {
  ...basis,
  tenancy: { selfServiceEnabled: true, multiTenant: true },
  auth: { ...basis.auth, devLoginEnabled: true, workosManagementApiKey: "" },
  billing: {
    paymentEnabled: true,
    stripeWebhookSecret: STRIPE_ABO_MESSUNG_GEHEIMNIS,
    stripeStarterPriceId: "price_starter",
    stripeBusinessPriceId: "price_business",
    paymentCurrency: "eur",
    stripeCustomerRetryDelayMs: 0,
    numberSetupFeeCents: 0,
  },
  provisioning: { releaseGraceMs: 0, provisioningCountry: "DE" },
  mail: { smtpHost: "", brevoApiKey: BREVO_ABO_MESSUNG_SCHLUESSEL, mailFrom: "absender@example.test" },
};

const brevoOk = () => Response.json({}, { status: HTTP_CREATED });
const brevoFrist = () => Promise.reject(new DOMException("Frist", "TimeoutError"));

const stripeMit = (checkout) => (ziel) => {
  const pfad = new URL(ziel).pathname;
  if (pfad === "/v1/customers") return Response.json({ id: KUNDE });
  if (pfad === "/v1/checkout/sessions") return checkout();
  return Response.json({}, { status: 404 });
};
const checkoutOk = () => Response.json({ id: "cs_messung", url: "https://checkout.stripe.test/cs_messung" });
const stripeFehler = (status, text) => () => Response.json({ error: { message: text } }, { status });

function workosAntwort({ exchange = HTTP_OK, loeschen = HTTP_OK } = {}) {
  return (ziel, init) => {
    if (ziel.startsWith(`${WORKOS}/user_management/authenticate`)) {
      const sid = Buffer.from(JSON.stringify({ sid: "sess_messung" })).toString("base64url");
      const user = { id: WORKOS_NUTZER, email: "anna@example.test", email_verified: true };
      return Response.json(exchange === HTTP_OK ? { user, access_token: `h.${sid}.s` } : {}, { status: exchange });
    }
    assert.equal(init.method, "DELETE");
    return new Response("", { status: loeschen });
  };
}

async function starteServer({ store, runner, config: konfiguration = KONFIGURATION }) {
  const app = express();
  app.use(express.json());
  await wireWebLogin({
    app,
    config: konfiguration,
    store,
    audit: () => {},
    provision: async () => ({ reason: "dry_run" }),
    createPortalRunner: () => runner,
    stripeWebhookPath: "/webhooks/stripe",
    appPath: "/app",
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

const cookiePaare = (res) => {
  const roh = res.headers.getSetCookie();
  return roh.map((c) => c.split(";")[0]).filter((c) => !/=$/.test(c));
};
const stateAus = (res) => {
  const ziel = new URL(res.headers.get("location"));
  return ziel.searchParams.get("state");
};

async function meldeAn(s, runner, { aktiv = false } = {}) {
  const login = await abrufMitFrist(`http://127.0.0.1:${s.port}/auth/dev-login`, {
    method: "POST",
    redirect: "manual",
  });
  const [cookie] = cookiePaare(login);
  assert.ok(cookie.startsWith(`${SESSION_COOKIE_NAME}=`));
  if (aktiv) await runner.withClient((c) => c.query("UPDATE tenant SET status = 'active' WHERE id = $1", [TENANT]));
  return cookie;
}

async function mitServer(lauf, optionen = {}) {
  const { store, runner } = await makePgTestStore();
  const s = await starteServer({ store, runner, ...optionen });
  try {
    return await lauf(s, runner);
  } finally {
    await s.close();
  }
}

const empfaengerEintragen = (s, cookie) =>
  request("POST", `http://127.0.0.1:${s.port}/api/self-service/newsletter-recipients`, {
    cookie,
    body: { email: EMPFAENGER_MAIL },
  });

const karteEinrichten = (s, cookie) =>
  request("POST", `http://127.0.0.1:${s.port}/api/self-service/billing/setup-checkout`, { cookie, body: {} });

async function newsletterEintrag(brevo) {
  attrappe.brevo = brevo;
  return mitServer(async (s, runner) => empfaengerEintragen(s, await meldeAn(s, runner, { aktiv: true })));
}

async function karteMitStripe(checkout) {
  attrappe.stripe = stripeMit(checkout);
  return mitServer((s, runner) =>
    meldeAn(s, runner).then((cookie) => mitStripe(globalThis.fetch, () => karteEinrichten(s, cookie))),
  );
}

async function gemessen(lauf) {
  return mitTelemetrie(starteTelemetrie, async ({ telemetrie, exporte }) => {
    const ergebnis = await lauf(telemetrie);
    await telemetrie.spuele();
    return { ergebnis, exporte };
  });
}

const antwortVon = ({ status, body }) => ({ status, body });

test("S3: ein Zeitueberschreitungs-Fehler beim Bestaetigungs-Mail zaehlt brevo/mail-senden/zeitueberschreitung", async () => {
  const { exporte } = await gemessen(() => newsletterEintrag(brevoFrist));
  assert.deepEqual(zaehlerPunkte(exporte), [
    { anbieter: "brevo", vorgang: "mail-senden", ergebnis: "zeitueberschreitung", wert: 1 },
  ]);
});

test("Brevo-Erfolg zaehlt ok, die Dauer steht nur unter anbieter und vorgang, ohne Adresse im Export", async () => {
  const { exporte } = await gemessen(() => newsletterEintrag(brevoOk));
  assert.deepEqual(zaehlerPunkte(exporte), [{ anbieter: "brevo", vorgang: "mail-senden", ergebnis: "ok", wert: 1 }]);
  assert.deepEqual(dauerPunkte(exporte), [{ attribute: { anbieter: "brevo", vorgang: "mail-senden" }, anzahl: 1 }]);
  assert.ok(!JSON.stringify(exporte).includes(EMPFAENGER_MAIL));
});

test("Brevo 429 zaehlt 429, Brevo 500 mit 429 im Text zaehlt fehler", async () => {
  const mitStatus = (status) => () => Response.json({ message: FEHLERTEXT_MIT_429 }, { status });
  const drossel = await gemessen(() => newsletterEintrag(mitStatus(HTTP_ZU_VIELE)));
  assert.deepEqual(zaehlerPunkte(drossel.exporte), [
    { anbieter: "brevo", vorgang: "mail-senden", ergebnis: "429", wert: 1 },
  ]);
  const fehler = await gemessen(() => newsletterEintrag(mitStatus(HTTP_FEHLER)));
  assert.deepEqual(zaehlerPunkte(fehler.exporte), [
    { anbieter: "brevo", vorgang: "mail-senden", ergebnis: "fehler", wert: 1 },
  ]);
  assert.ok(!JSON.stringify(fehler.exporte).includes(EMPFAENGER_MAIL));
});

test("B3: ohne Messung antwortet der Eintrag mit Brevo-201 unveraendert und Brevo wird einmal gerufen", async () => {
  anfragenAn.brevo = 0;
  const res = await newsletterEintrag(brevoOk);
  assert.deepEqual(antwortVon(res), { status: HTTP_OK, body: JSON.stringify({ ok: true, status: "pending" }) });
  assert.equal(anfragenAn.brevo, 1);
});

test("B2: wirft das Erfassen, bleibt die Antwort gleich und die Logzeile nennt nur anbieter und vorgang", async () => {
  const ohne = await newsletterEintrag(brevoOk);
  const { ergebnis } = await gemessen(async (telemetrie) => {
    mock.method(telemetrie, "messeAnbieter", () => {
      throw new Error(`Erfassen kaputt ${EMPFAENGER_MAIL}`);
    });
    const warnung = mock.method(console, "warn", () => {});
    const res = await newsletterEintrag(brevoOk);
    const zeilen = warnung.mock.calls.map((aufruf) => String(aufruf.arguments[0]));
    warnung.mock.restore();
    return { res, zeilen, versuche: telemetrie.messeAnbieter.mock.callCount() };
  });
  assert.deepEqual(antwortVon(ergebnis.res), antwortVon(ohne));
  assert.equal(ergebnis.versuche, 1);
  assert.deepEqual(ergebnis.zeilen, ["[anbieter-messung] Erfassen fehlgeschlagen anbieter=brevo vorgang=mail-senden"]);
});

test("S4: scheitert das Anlegen der Karten-Sitzung mit 500, zaehlt stripe/checkout-karte-anlegen/fehler", async () => {
  const { exporte } = await gemessen(() => karteMitStripe(stripeFehler(HTTP_FEHLER, "kaputt")));
  assert.deepEqual(zaehlerPunkte(exporte), [
    { anbieter: "stripe", vorgang: "checkout-karte-anlegen", ergebnis: "fehler", wert: 1 },
    { anbieter: "stripe", vorgang: "kunde-anlegen", ergebnis: "ok", wert: 1 },
  ]);
});

test("S9: Stripe 429 zaehlt 429 beim Checkout und beim Kunden, die Antwort der Route bleibt gleich", async () => {
  const ohne = await karteMitStripe(stripeFehler(HTTP_ZU_VIELE, "zu viele"));
  const { ergebnis, exporte } = await gemessen(() => karteMitStripe(stripeFehler(HTTP_ZU_VIELE, "zu viele")));
  assert.deepEqual(antwortVon(ergebnis), antwortVon(ohne));
  assert.deepEqual(zaehlerPunkte(exporte), [
    { anbieter: "stripe", vorgang: "checkout-karte-anlegen", ergebnis: "429", wert: 1 },
    { anbieter: "stripe", vorgang: "kunde-anlegen", ergebnis: "ok", wert: 1 },
  ]);
  attrappe.stripe = (ziel) =>
    new URL(ziel).pathname === "/v1/customers" ? stripeFehler(HTTP_ZU_VIELE, "zu viele")() : checkoutOk();
  const kunde = await gemessen(() =>
    mitServer((s, runner) =>
      meldeAn(s, runner).then((cookie) => mitStripe(globalThis.fetch, () => karteEinrichten(s, cookie))),
    ),
  );
  assert.deepEqual(zaehlerPunkte(kunde.exporte), [
    { anbieter: "stripe", vorgang: "kunde-anlegen", ergebnis: "429", wert: 1 },
  ]);
});

test("PM6: ein Stripe-Fehler 500 mit 429 im Text zaehlt fehler, der Text steht nicht im Export", async () => {
  const { exporte } = await gemessen(() => karteMitStripe(stripeFehler(HTTP_FEHLER, FEHLERTEXT_MIT_429)));
  const punkte = zaehlerPunkte(exporte).filter((p) => p.vorgang === "checkout-karte-anlegen");
  assert.deepEqual(punkte, [{ anbieter: "stripe", vorgang: "checkout-karte-anlegen", ergebnis: "fehler", wert: 1 }]);
  assert.ok(!JSON.stringify(exporte).includes("429 fuer"));
});

test("Stripe-Erfolg zaehlt ok fuer beide Vorgaenge, je genau ein Dauer-Eintrag mit nur anbieter und vorgang", async () => {
  const { exporte } = await gemessen(() => karteMitStripe(checkoutOk));
  assert.deepEqual(zaehlerPunkte(exporte), [
    { anbieter: "stripe", vorgang: "checkout-karte-anlegen", ergebnis: "ok", wert: 1 },
    { anbieter: "stripe", vorgang: "kunde-anlegen", ergebnis: "ok", wert: 1 },
  ]);
  const dauer = dauerPunkte(exporte).sort((a, b) => a.attribute.vorgang.localeCompare(b.attribute.vorgang));
  assert.deepEqual(dauer, [
    { attribute: { anbieter: "stripe", vorgang: "checkout-karte-anlegen" }, anzahl: 1 },
    { attribute: { anbieter: "stripe", vorgang: "kunde-anlegen" }, anzahl: 1 },
  ]);
});

async function anmeldungDurchlaufen(s, exchange) {
  attrappe.workos = workosAntwort({ exchange });
  const start = await abrufMitFrist(`http://127.0.0.1:${s.port}/auth/login`, { redirect: "manual" });
  const state = stateAus(start);
  const cookie = cookiePaare(start).join("; ");
  return abrufMitFrist(`http://127.0.0.1:${s.port}/auth/callback?code=c1&state=${encodeURIComponent(state)}`, {
    redirect: "manual",
    headers: { cookie },
  });
}

test("S5: der Codetausch beim Anmelden zaehlt workos/anmeldung-tauschen/ok", async () => {
  const { exporte, ergebnis } = await gemessen(() => mitServer((s) => anmeldungDurchlaufen(s, HTTP_OK)));
  assert.equal(ergebnis.status, 302);
  assert.deepEqual(zaehlerPunkte(exporte), [
    { anbieter: "workos", vorgang: "anmeldung-tauschen", ergebnis: "ok", wert: 1 },
  ]);
});

test("Die Login-Weiterleitung allein erzeugt keinen Messwert", async () => {
  const { exporte } = await gemessen(() =>
    mitServer(async (s) => {
      const start = await abrufMitFrist(`http://127.0.0.1:${s.port}/auth/login`, { redirect: "manual" });
      assert.equal(start.status, 302);
    }),
  );
  assert.deepEqual(zaehlerPunkte(exporte), []);
});

test("S8: ein WorkOS-Fehler mit 429 im Text zaehlt fehler, die Antwort an den Browser bleibt gleich", async () => {
  const ohne = await mitServer((s) => anmeldungDurchlaufen(s, HTTP_ZU_VIELE));
  const { ergebnis, exporte } = await gemessen(() => mitServer((s) => anmeldungDurchlaufen(s, HTTP_ZU_VIELE)));
  assert.deepEqual(zaehlerPunkte(exporte), [
    { anbieter: "workos", vorgang: "anmeldung-tauschen", ergebnis: "fehler", wert: 1 },
  ]);
  assert.equal(ergebnis.status, ohne.status);
  assert.equal(ergebnis.headers.get("location"), ohne.headers.get("location"));
});

async function vertragsendeMitWorkos(loeschen) {
  attrappe.workos = workosAntwort({ loeschen });
  const { store, runner } = await makePgTestStore();
  const erster = await starteServer({ store, runner });
  await meldeAn(erster, runner);
  await erster.close();
  const tenant = store.load().tenants.find((t) => t.id === TENANT);
  tenant.idpSubject = WORKOS_NUTZER;
  tenant.numberReleasePending = true;
  const konfiguration = { ...KONFIGURATION, auth: { ...KONFIGURATION.auth, workosManagementApiKey: "wm-messung" } };
  const zweiter = await starteServer({ store, runner, config: konfiguration });
  await waitUntil(() => "workosDeletePending" in tenant);
  await zweiter.close();
}

test("Das Loeschen des WorkOS-Nutzers zaehlt workos/nutzer-loeschen: ok bei 200, fehler bei 429 (nur im Text)", async () => {
  const ok = await gemessen(() => vertragsendeMitWorkos(HTTP_OK));
  assert.deepEqual(zaehlerPunkte(ok.exporte).filter((p) => p.anbieter === "workos"), [
    { anbieter: "workos", vorgang: "nutzer-loeschen", ergebnis: "ok", wert: 1 },
  ]);
  const gedrosselt = await gemessen(() => vertragsendeMitWorkos(HTTP_ZU_VIELE));
  assert.deepEqual(zaehlerPunkte(gedrosselt.exporte).filter((p) => p.anbieter === "workos"), [
    { anbieter: "workos", vorgang: "nutzer-loeschen", ergebnis: "fehler", wert: 1 },
  ]);
  assert.ok(!JSON.stringify(gedrosselt.exporte).includes(WORKOS_NUTZER));
});
