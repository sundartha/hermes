import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { config } from "../../src/config.js";
import { wireWebLogin } from "../../src/wiring/web-login.js";
import { SESSION_COOKIE_NAME } from "../../src/web-auth.js";
import { makePgTestStore } from "../pg-helpers.js";
import { makeStripeStub } from "../helpers.js";
import { webLoginBasisKonfiguration } from "../gemeinsam/web-login-konfiguration.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import request from "../gemeinsam/testserver-anfrage.mjs";
import { antwortetNie, mitKurzerFrist } from "../gemeinsam/kurze-antwortfrist.mjs";

const withStripeStub = makeStripeStub(config, "sk_test_koerper");

const ERWARTETER_FEHLER = "Abbruch beim Lesen des Antwortkörpers kommt nicht als TimeoutError an";
const KUENDIGUNG_OHNE_WURF = "Kündigung nach Status 200 darf bei ausbleibendem Körper nicht werfen";

const TENANT = "t_dev-user";
const KUNDE = "cus_koerper";
const KARTE = "pm_koerper";
const ABO = "sub_koerper";
const SITZUNG = "cs_koerper";
const CHECKOUT_URL = "https://checkout.stripe.test/cs_koerper";
const PERIODE_START = 1890777600;
const PERIODE_ENDE = 1893456000;
const LAUFENDES_ABO = { subscriptionId: ABO, planSlug: "starter", currentPeriodEnd: PERIODE_ENDE };
const GEKUENDIGTES_ABO = { ...LAUFENDES_ABO, cancelAtPeriodEnd: true };

const basis = webLoginBasisKonfiguration("https://api.workos.test");
const KONFIGURATION = {
  ...basis,
  tenancy: { selfServiceEnabled: true, multiTenant: true },
  auth: { ...basis.auth, devLoginEnabled: true },
  billing: {
    paymentEnabled: true,
    stripeWebhookSecret: "whsec_koerper",
    stripeStarterPriceId: "price_starter",
    stripeBusinessPriceId: "price_business",
    paymentCurrency: "eur",
    stripeCustomerRetryDelayMs: 0,
    numberSetupFeeCents: 0,
  },
  provisioning: { releaseGraceMs: 0, provisioningCountry: "DE" },
};

const ABO_POSITIONEN = { data: [{ current_period_start: PERIODE_START, current_period_end: PERIODE_ENDE }] };

function stripeGutfall(url, init) {
  const pfad = new URL(url).pathname;
  if (init.method === "POST" && pfad === "/v1/subscriptions")
    return Response.json({ id: ABO, items: ABO_POSITIONEN });
  if (init.method === "GET" && pfad === `/v1/subscriptions/${ABO}`)
    return Response.json({ id: ABO, status: "active" });
  if (init.method === "POST" && pfad === "/v1/checkout/sessions")
    return Response.json({ id: SITZUNG, url: CHECKOUT_URL });
  if (init.method === "GET" && pfad === `/v1/checkout/sessions/${SITZUNG}`)
    return Response.json({
      customer: KUNDE,
      subscription: {
        id: ABO,
        items: ABO_POSITIONEN,
        metadata: { plan_slug: "starter" },
        default_payment_method: { id: KARTE, type: "card" },
      },
    });
  return Response.json({}, { status: 404 });
}

const koerperBleibtAus = async (url, init) => ({ ok: true, status: 200, json: () => antwortetNie(url, init) });

const verbindungReisstAb = async () => ({
  ok: true,
  status: 200,
  json: () => Promise.reject(new TypeError("terminated")),
});

const keinGueltigesJson = async () => new Response("<html>kein json</html>", { status: 200 });

const karteAbgelehnt = async () =>
  Response.json(
    {
      error: {
        type: "card_error",
        code: "card_declined",
        decline_code: "insufficient_funds",
        message: "Your card was declined.",
      },
    },
    { status: 402 },
  );

async function starteMitKarte(abo) {
  const { store, runner } = await makePgTestStore();
  const app = express();
  app.use(express.json());
  const verdrahtung = await wireWebLogin({
    app,
    config: KONFIGURATION,
    store,
    audit: () => {},
    provision: async () => ({ reason: "dry_run" }),
    createPortalRunner: () => runner,
    stripeWebhookPath: "/webhooks/stripe",
    appPath: "/app",
  });
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  const login = await abrufMitFrist(`http://127.0.0.1:${port}/auth/dev-login`, {
    method: "POST",
    redirect: "manual",
  });
  const [cookie] = login.headers.get("set-cookie").split(";");
  assert.ok(cookie.startsWith(`${SESSION_COOKIE_NAME}=`), "Dev-Login setzt das Sitzungs-Cookie");
  store.setTenantStripe(TENANT, { customerId: KUNDE, paymentMethodId: KARTE });
  if (abo) {
    store.setTenantSubscription(TENANT, abo);
    await verdrahtung.accounts.setStatus(TENANT, "active");
  }
  return { store, port, cookie, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function mitMandant(abo, pruefung) {
  const s = await starteMitKarte(abo);
  try {
    await pruefung(s);
  } finally {
    await s.close();
  }
}

const ABRECHNUNG = "/api/self-service/billing";
const SUBSCRIBE = { method: "POST", pfad: `${ABRECHNUNG}/subscribe`, body: { plan: "starter" } };
const CHECKOUT = { method: "POST", pfad: `${ABRECHNUNG}/setup-checkout`, body: { plan: "starter" } };
const RUECKKEHR = { method: "GET", pfad: `${ABRECHNUNG}/return?session_id=${SITZUNG}&plan=starter` };
const KUENDIGEN = { method: "POST", pfad: `${ABRECHNUNG}/cancel` };
const FORTSETZEN = { method: "POST", pfad: `${ABRECHNUNG}/resume` };
const STATUS = { method: "GET", pfad: `${ABRECHNUNG}/status` };

async function anfrage(s, { method, pfad, body }) {
  const antwort = await request(method, `http://127.0.0.1:${s.port}${pfad}`, { cookie: s.cookie, body });
  const istJson = /application\/json/.test(antwort.headers["content-type"]);
  return { status: antwort.status, location: antwort.location, body: istJson ? JSON.parse(antwort.body) : antwort.body };
}

async function mitStripe(stripe, s, route) {
  let antwort;
  await withStripeStub(stripe, () =>
    mitKurzerFrist(async () => {
      antwort = await anfrage(s, route);
    }),
  );
  return antwort;
}

async function abrechnungsstand(s) {
  const { body: status } = await anfrage(s, STATUS);
  const abo = s.store.tenantSubscription(TENANT);
  return { status: status.status, planSlug: status.planSlug ?? null, aboReferenz: abo.subscriptionId ?? null };
}

const NICHT_FREIGESCHALTET = { status: "suspended", planSlug: null, aboReferenz: null };
const FREIGESCHALTET = { status: "active", planSlug: "starter", aboReferenz: ABO };
const ABRECHNUNG_NICHT_ERREICHBAR = { error: "billing_unavailable" };

test("Stripe-Körperfrist: bleibt der Körper der Abo-Anlage aus, antwortet subscribe mit 502 und schaltet den Mandanten nicht frei", () =>
  mitMandant(null, async (s) => {
    const res = await mitStripe(koerperBleibtAus, s, SUBSCRIBE);
    assert.equal(res.status, 502, ERWARTETER_FEHLER);
    assert.deepEqual(res.body, ABRECHNUNG_NICHT_ERREICHBAR);
    assert.deepEqual(await abrechnungsstand(s), NICHT_FREIGESCHALTET);
  }));

test("Stripe-Körperfrist: reißt die Verbindung im Körper der Abo-Anlage ab, antwortet subscribe mit 502 und schaltet den Mandanten nicht frei", () =>
  mitMandant(null, async (s) => {
    const res = await mitStripe(verbindungReisstAb, s, SUBSCRIBE);
    assert.equal(res.status, 502, ERWARTETER_FEHLER);
    assert.deepEqual(await abrechnungsstand(s), NICHT_FREIGESCHALTET);
  }));

test("Stripe-Körperfrist: bleibt der Körper der Checkout-Sitzung aus, antwortet setup-checkout mit 502 statt einer leeren Adresse", () =>
  mitMandant(null, async (s) => {
    const res = await mitStripe(koerperBleibtAus, s, CHECKOUT);
    assert.equal(res.status, 502, ERWARTETER_FEHLER);
    assert.deepEqual(res.body, ABRECHNUNG_NICHT_ERREICHBAR);
  }));

test("[NIE1] nach Körperabbruch der Abo-Anlage bleibt der Mandant gesperrt, ohne Plan und ohne Abo-Referenz", async () => {
  for (const stripe of [koerperBleibtAus, verbindungReisstAb]) {
    await mitMandant(null, async (s) => {
      const { status } = await mitStripe(stripe, s, SUBSCRIBE);
      assert.deepEqual(
        { status, ...(await abrechnungsstand(s)) },
        { status: 502, ...NICHT_FREIGESCHALTET },
        `Abo-Anlage nach Körperabbruch (${stripe.name}) darf nicht freischalten`,
      );
    });
  }
});

test("[NIE2] rechtzeitige Antwort mit gültigem JSON: subscribe legt das Abo an und schaltet frei", () =>
  mitMandant(null, async (s) => {
    const res = await mitStripe(stripeGutfall, s, SUBSCRIBE);
    assert.deepEqual(res.body, { plan: "starter", currentPeriodEnd: PERIODE_ENDE });
    assert.deepEqual(await abrechnungsstand(s), FREIGESCHALTET);
  }));

test("[NIE2] rechtzeitige Antwort mit gültigem JSON: setup-checkout liefert die Checkout-Adresse", () =>
  mitMandant(null, async (s) => {
    const res = await mitStripe(stripeGutfall, s, CHECKOUT);
    assert.deepEqual({ status: res.status, body: res.body }, { status: 200, body: { url: CHECKOUT_URL } });
  }));

test("[NIE2] rechtzeitige Antwort mit gültigem JSON: die Rückkehr bindet das Abo und leitet auf sub=ok", () =>
  mitMandant(null, async (s) => {
    const res = await mitStripe(stripeGutfall, s, RUECKKEHR);
    assert.deepEqual({ status: res.status, location: res.location }, { status: 302, location: "/app?sub=ok" });
    assert.deepEqual(await abrechnungsstand(s), FREIGESCHALTET);
  }));

test("[NIE3] Körper einer rechtzeitigen 200-Antwort ist kein JSON: setup-checkout und subscribe antworten wie heute mit leerem Ergebnis", () =>
  mitMandant(null, async (s) => {
    const checkout = await mitStripe(keinGueltigesJson, s, CHECKOUT);
    assert.deepEqual({ status: checkout.status, body: checkout.body }, { status: 200, body: {} });
    const abo = await mitStripe(keinGueltigesJson, s, SUBSCRIBE);
    assert.deepEqual({ status: abo.status, body: abo.body }, { status: 200, body: { plan: "starter" } });
  }));

test("[NIE4] Ablehnung der Karte bei der Abo-Anlage: subscribe antwortet weiter mit 502 billing_unavailable", () =>
  mitMandant(null, async (s) => {
    const res = await mitStripe(karteAbgelehnt, s, SUBSCRIBE);
    assert.deepEqual({ status: res.status, body: res.body }, { status: 502, body: ABRECHNUNG_NICHT_ERREICHBAR });
    assert.deepEqual(await abrechnungsstand(s), NICHT_FREIGESCHALTET);
  }));

test("[NIE5] Stripe-Körperfrist: bleibt der Körper von Kündigen nach Status 200 aus, antwortet cancel wie heute mit Erfolg", () =>
  mitMandant(LAUFENDES_ABO, async (s) => {
    const res = await mitStripe(koerperBleibtAus, s, KUENDIGEN);
    assert.equal(res.status, 200, KUENDIGUNG_OHNE_WURF);
    assert.deepEqual(res.body, { cancelAtPeriodEnd: true, currentPeriodEnd: PERIODE_ENDE });
  }));

test("[NIE5] Stripe-Körperfrist: bleibt der Körper von Fortsetzen nach Status 200 aus, antwortet resume wie heute mit Erfolg", () =>
  mitMandant(GEKUENDIGTES_ABO, async (s) => {
    const res = await mitStripe(koerperBleibtAus, s, FORTSETZEN);
    assert.equal(res.status, 200, KUENDIGUNG_OHNE_WURF);
    assert.deepEqual(res.body, { cancelAtPeriodEnd: false, currentPeriodEnd: PERIODE_ENDE });
  }));

const ROUTENFEHLER = "self-service billing route failed:";

test("Stripe-Körperfrist: das Protokoll der Route nennt bei Körperabbruch den echten Abbruchfehler statt eines Folgefehlers", (t) =>
  mitMandant(null, async (s) => {
    const fehler = [];
    t.mock.method(console, "error", (...args) => fehler.push(args.join(" ")));
    await mitStripe(koerperBleibtAus, s, SUBSCRIBE);
    await mitStripe(verbindungReisstAb, s, SUBSCRIBE);
    await mitStripe(koerperBleibtAus, s, CHECKOUT);
    await mitStripe(verbindungReisstAb, s, CHECKOUT);
    assert.deepEqual(
      fehler.filter((zeile) => zeile.startsWith(ROUTENFEHLER)),
      [
        `${ROUTENFEHLER} Die Frist ist abgelaufen`,
        `${ROUTENFEHLER} terminated`,
        `${ROUTENFEHLER} Die Frist ist abgelaufen`,
        `${ROUTENFEHLER} terminated`,
      ],
    );
  }));
