import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { starteHermesMitPglite, LOGIN_SUB } from "./server-mit-testdatenbank.js";
import { STRIPE_ROUTEN_GEHEIMNIS } from "../gemeinsam/erfundene-geheimnisse.js";
import { echtWarten } from "../echt-warten.js";
import { waitUntil } from "../helpers.js";
import { fristSignal } from "../gemeinsam/antwortfrist.mjs";

const STRIPE_BASIS = "https://stripe.geld-frist.invalid";
const TELNYX_BASIS = "https://telnyx.geld-frist.invalid";
const WEBHOOK_PFAD = "/webhooks/stripe";
const NEUE_FRIST_UNTERGRENZE_MS = 30_000;
const LANGE_FRIST_GRENZE_MS = 15_000;
const KURZE_WARTEZEIT_MS = 20;
const MS_PER_S = 1000;
const NUMMERN_OBERGRENZE = 100;
const HTTP_OK = 200;
const KARTE = { customerId: "cus_geld", paymentMethodId: "pm_geld", paymentMethodType: "card" };
const NUMMER_E164 = "+12025550100";
const ABGELAUFEN = "Die Frist ist abgelaufen";
const ZAEHLER_ENDE = "2000-01-01T00:00:00.000Z";

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "" });
const { config } = await import("../../src/config.js");
const store = await import("../../src/store.js");

Object.assign(config.billing, {
  paymentEnabled: true,
  stripeSecretKey: "sk_test_geld_frist",
  stripeApiBase: STRIPE_BASIS,
  stripeWebhookSecret: STRIPE_ROUTEN_GEHEIMNIS,
  flushEpochIso: ZAEHLER_ENDE,
  numberSetupFeeCents: 300,
});
Object.assign(config.telephony, { telnyxApiKey: "KEYtest-geld-frist", telnyxApiBase: TELNYX_BASIS });
Object.assign(config.provisioning, {
  provisioningEnabled: true,
  maxNumbers: NUMMERN_OBERGRENZE,
  maxNumbersPerTenant: NUMMERN_OBERGRENZE,
  provisioningCountry: "US",
});

const schweigt = (_ziel, init) =>
  new Promise((_erfuellt, abgelehnt) => {
    init.signal.addEventListener("abort", () => abgelehnt(init.signal.reason), { once: true });
  });

const netzfehler = () => Promise.reject(new TypeError("fetch failed"));

const json = (koerper, status = HTTP_OK) => Promise.resolve(Response.json(koerper, { status }));

function pfadVon(ziel) {
  const { pathname } = new URL(ziel);
  return pathname;
}

function telnyxAntwort(ziel, init) {
  const pfad = pfadVon(ziel);
  const methode = init.method ?? "GET";
  if (pfad === "/v2/available_phone_numbers") return json({ data: [{ phone_number: NUMMER_E164 }] });
  if (pfad === "/v2/number_orders") return json({ data: { phone_numbers: [{ phone_number: NUMMER_E164 }] } });
  if (pfad === "/v2/phone_numbers" && methode === "GET") return json({ data: [{ id: "pnum_geld" }] });
  if (pfad === "/v2/phone_numbers/pnum_geld" && methode === "DELETE") return json({});
  return json({}, 404);
}

function stripeAntwort(ziel, init) {
  const pfad = pfadVon(ziel);
  if (pfad === "/v1/payment_intents") return json({ id: "pi_geld" });
  if (pfad === "/v1/payment_intents/pi_geld/capture") return json({});
  if (pfad === "/v1/payment_intents/pi_geld/cancel") return json({});
  if (pfad === "/v1/billing/meter_events") return json({});
  if (pfad === "/v1/customers") return json({ id: "cus_neu_geld" });
  if (pfad === "/v1/checkout/sessions") return json({ id: "cs_geld", url: "https://checkout.stripe.invalid/cs_geld" });
  if (pfad.startsWith("/v1/subscriptions/") && init.method === "GET")
    return json({ id: "sub_geld", status: "active", latest_invoice: { total: 1900 } });
  return json({}, 404);
}

async function mitAussenwelt({ stripe = stripeAntwort, telnyx = telnyxAntwort }, ablauf) {
  const echtesFetch = globalThis.fetch;
  const echteFrist = AbortSignal.timeout;
  const anfragen = [];
  const fristen = [];
  globalThis.fetch = (url, init = {}) => {
    const ziel = String(url);
    const host = URL.canParse(ziel) ? new URL(ziel).host : null;
    const antwort = host === new URL(STRIPE_BASIS).host ? stripe : host === new URL(TELNYX_BASIS).host ? telnyx : null;
    if (!antwort)
      return echtesFetch(url, {
        ...init,
        signal: AbortSignal.any([fristSignal(), ...(init.signal ? [init.signal] : [])]),
      });
    anfragen.push({ methode: init.method ?? "GET", pfad: pfadVon(ziel), init });
    return antwort(ziel, init);
  };
  AbortSignal.timeout = (ms) => {
    if (ms <= LANGE_FRIST_GRENZE_MS) return echteFrist.call(AbortSignal, ms);
    fristen.push(ms);
    const abbruch = new AbortController();
    echtWarten(KURZE_WARTEZEIT_MS).then(() => abbruch.abort(new DOMException(ABGELAUFEN, "TimeoutError")));
    return abbruch.signal;
  };
  try {
    return { ergebnis: await ablauf(), anfragen, fristen };
  } finally {
    globalThis.fetch = echtesFetch;
    AbortSignal.timeout = echteFrist;
  }
}

const anStripe = (anfragen) => anfragen.filter(({ pfad }) => pfad.startsWith("/v1/payment_intents"));

const ausfallBei = (pfadEnden, ausfall) => (ziel, init) =>
  init.method === "POST" && pfadEnden.some((ende) => pfadVon(ziel).endsWith(ende))
    ? ausfall(ziel, init)
    : stripeAntwort(ziel, init);
const posts = (anfragen, pfad) => anfragen.filter((a) => a.methode === "POST" && a.pfad === pfad);

function zahlungsEreignis(tenantId) {
  return JSON.stringify({
    type: "customer.subscription.created",
    data: {
      object: { id: "sub_geld", status: "active", metadata: { tenant_ref: tenantId, plan_slug: "starter" } },
    },
  });
}

async function zahlungSenden(hermes, tenantId) {
  const rumpf = zahlungsEreignis(tenantId);
  const zeit = Math.floor(Date.now() / MS_PER_S);
  const mac = crypto.createHmac("sha256", STRIPE_ROUTEN_GEHEIMNIS).update(`${zeit}.${rumpf}`).digest("hex");
  return hermes.anfrage(WEBHOOK_PFAD, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": `t=${zeit},v1=${mac}` },
    body: rumpf,
  });
}

let kundenZaehler = 0;

async function kundeMitKarte() {
  kundenZaehler += 1;
  const tenantId = `t_geld_frist_${kundenZaehler}`;
  store.load().tenants.push({ id: tenantId, status: "suspended", firstName: "Kunde", ownerName: "Kunde Geld" });
  store.setTenantStripe(tenantId, KARTE);
  store.save();
  await store.drainFlushes();
  return tenantId;
}

const nummerVon = (tenantId) => store.load().numbers.find((nummer) => nummer.tenantId === tenantId);
const AUFTRAG_ENDE = ["done", "failed"];
const auftragVon = (nummer) => store.load().provisioningJobs.find((auftrag) => auftrag.numberId === nummer.id);
const endgueltig = (nummer) => Boolean(nummer && AUFTRAG_ENDE.includes(auftragVon(nummer)?.status));

async function nummerKaufen(stripe, telnyx = telnyxAntwort) {
  const hermes = laufendesHermes();
  const tenantId = await kundeMitKarte();
  const lauf = await mitAussenwelt({ stripe, telnyx }, async () => {
    const antwort = await zahlungSenden(hermes, tenantId);
    assert.equal(antwort.status, HTTP_OK);
    await waitUntil(() => endgueltig(nummerVon(tenantId)));
    return nummerVon(tenantId);
  });
  return { nummer: lauf.ergebnis, anfragen: lauf.anfragen, fristen: lauf.fristen };
}

test("Geld-Frist: Nummernkauf mit antwortender Gegenseite sendet an Stripe Frist-Signal, Schlüssel und Körper unverändert", async () => {
  const { nummer, anfragen, fristen } = await nummerKaufen(stripeAntwort);

  assert.equal(nummer.status, "active");
  assert.deepEqual(
    anStripe(anfragen).map(({ methode, pfad }) => `${methode} ${pfad}`),
    ["POST /v1/payment_intents", "POST /v1/payment_intents/pi_geld/capture"],
  );
  const [halten] = posts(anfragen, "/v1/payment_intents");
  const [einziehen] = posts(anfragen, "/v1/payment_intents/pi_geld/capture");
  for (const { init } of [halten, einziehen]) {
    assert.ok(init.signal instanceof AbortSignal, "Anfrage trägt ein Frist-Signal");
    assert.equal("fristMs" in init, false, "fristMs erreicht fetch nicht");
    assert.equal(init.headers.Authorization, "Bearer sk_test_geld_frist");
    assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
  }
  assert.equal(halten.init.headers["Idempotency-Key"], `hold_${nummer.id}`);
  const haltung = new URLSearchParams(String(halten.init.body));
  assert.equal(haltung.get("capture_method"), "manual");
  assert.equal(haltung.get("customer"), KARTE.customerId);
  assert.equal(haltung.get("payment_method"), KARTE.paymentMethodId);
  assert.equal(haltung.get("metadata[tenant_ref]"), nummer.tenantId);
  assert.equal(new URLSearchParams(String(einziehen.init.body)).get("amount_to_capture"), haltung.get("amount"));
  assert.equal(fristen.length, 2, "Haltung und Einziehen haben je eine Frist");
  assert.ok(fristen.every((ms) => ms >= NEUE_FRIST_UNTERGRENZE_MS), `Fristen ${fristen} liegen unter 30 s`);
});

for (const [name, ausfall, fehlertext] of [
  ["Fristabbruch", schweigt, ABGELAUFEN],
  ["Netzfehler", netzfehler, "fetch failed"],
]) {
  test(`Geld-Frist: ${name} bei der Haltung -> Nummer scheitert, keine Bestellung, keine zweite Haltung`, async () => {
    const { nummer, anfragen, fristen } = await nummerKaufen(ausfallBei(["/v1/payment_intents"], ausfall));

    assert.equal(nummer.status, "failed");
    assert.equal(nummer.e164 ?? null, null, "keine Nummer freigeschaltet");
    assert.equal(auftragVon(nummer).lastError, fehlertext, "der Auftrag nennt den Fehler der Anfrage");
    assert.equal(posts(anfragen, "/v1/payment_intents").length, 1, "genau eine Haltung");
    assert.equal(posts(anfragen, "/v2/number_orders").length, 0, "keine Nummernbestellung");
    assert.deepEqual(
      anStripe(anfragen).map(({ pfad }) => pfad),
      ["/v1/payment_intents"],
    );
    assert.equal(fristen.length, 1, "die Haltung trägt genau eine Frist");
  });
}

for (const [name, ausfall] of [
  ["Fristabbruch", schweigt],
  ["Netzfehler", netzfehler],
]) {
  test(`Geld-Frist: ${name} beim Einziehen -> Nummer gibt zurück, Haltung wird gelöst, kein zweites Einziehen`, async () => {
    const { nummer, anfragen, fristen } = await nummerKaufen(ausfallBei(["/capture", "/cancel"], ausfall));

    assert.equal(nummer.status, "released");
    assert.equal(posts(anfragen, "/v1/payment_intents/pi_geld/capture").length, 1, "genau ein Einziehen");
    assert.equal(posts(anfragen, "/v1/payment_intents/pi_geld/cancel").length, 1, "Haltung wird einmal gelöst");
    assert.equal(posts(anfragen, "/v1/payment_intents").length, 1, "genau eine Haltung");
    assert.equal(anfragen.filter(({ methode, pfad }) => methode === "DELETE" && pfad === "/v2/phone_numbers/pnum_geld").length, 1);
    assert.equal(fristen.length, 3, "Haltung, Einziehen und Lösen haben je eine Frist");
  });
}

let zaehlerEreignisse = 0;

function ereignisAnlegen() {
  zaehlerEreignisse += 1;
  store.load().usageEvents.length = 0;
  const id = `ue_geld_frist_${zaehlerEreignisse}`;
  store.load().usageEvents.push({
    id,
    tenantId: `t_zaehler_${zaehlerEreignisse}`,
    callId: null,
    kind: "voice_minute",
    quantity: 2,
    costCents: 0,
    occurredAt: new Date().toISOString(),
    stripeMeterSent: false,
  });
  return id;
}

async function zaehlerMelden(stripe) {
  const hermes = laufendesHermes();
  const { sessionCookie } = await hermes.anmelden();
  await hermes.db.query(
    "UPDATE tenant SET status = 'active' WHERE id IN (SELECT tenant_id FROM account WHERE sub = $1)",
    [LOGIN_SUB],
  );
  const id = ereignisAnlegen();
  const lauf = await mitAussenwelt({ stripe }, async () => {
    const antwort = await hermes.anfrage("/api/billing/flush-meters", {
      method: "POST",
      headers: { cookie: sessionCookie },
    });
    return { status: antwort.status, koerper: await antwort.json() };
  });
  const ereignis = store.load().usageEvents.find((zeile) => zeile.id === id);
  return { id, ereignis, ...lauf };
}

test("Geld-Frist: Zähler-Ereignis mit antwortender Gegenseite trägt Frist-Signal, Schlüssel und Körper unverändert", async () => {
  const { id, ereignis, ergebnis, anfragen, fristen } = await zaehlerMelden(stripeAntwort);

  assert.deepEqual(ergebnis, { status: HTTP_OK, koerper: { sent: 1, failed: 0, skipped: 0, skipReason: null } });
  assert.equal(ereignis.stripeMeterSent, true);
  const [meldung] = posts(anfragen, "/v1/billing/meter_events");
  assert.ok(meldung.init.signal instanceof AbortSignal, "Anfrage trägt ein Frist-Signal");
  assert.equal("fristMs" in meldung.init, false, "fristMs erreicht fetch nicht");
  assert.equal(meldung.init.headers["Idempotency-Key"], `meter_${ereignis.tenantId}_voice_minute_${id}`);
  const koerper = new URLSearchParams(String(meldung.init.body));
  assert.equal(koerper.get("event_name"), "voice_minutes");
  assert.equal(koerper.get("payload[value]"), "2");
  assert.equal(fristen.length, 1);
  assert.ok(fristen[0] >= NEUE_FRIST_UNTERGRENZE_MS, `Frist ${fristen[0]} liegt unter 30 s`);
});

for (const [name, ausfall] of [
  ["Fristabbruch", schweigt],
  ["Netzfehler", netzfehler],
]) {
  test(`Geld-Frist: ${name} beim Zähler-Ereignis -> als fehlgeschlagen gezählt, nicht als gesendet markiert, kein zweiter Versuch`, async () => {
    const { ereignis, ergebnis, anfragen, fristen } = await zaehlerMelden(
      ausfallBei(["/v1/billing/meter_events"], ausfall),
    );

    assert.deepEqual(ergebnis, { status: HTTP_OK, koerper: { sent: 0, failed: 1, skipped: 0, skipReason: null } });
    assert.equal(ereignis.stripeMeterSent, false);
    assert.equal(posts(anfragen, "/v1/billing/meter_events").length, 1);
    assert.equal(fristen.length, 1, "das Zähler-Ereignis trägt genau eine Frist");
  });
}
