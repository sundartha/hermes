import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config } from "../../src/config.js";
import {
  applyStripeWebhook,
  interpretStripeEvent,
  verifyStripeSignature,
  SUBSCRIPTION_EVENT,
  WEBHOOK_ACTION,
} from "../../src/billing/webhook.js";
import { makeStripeWebhookRoute } from "../../src/routes/stripe-webhook.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makePgTestStore } from "../pg-helpers.js";
import {
  STRIPE_ALARM_GEHEIMNIS,
  STRIPE_FALSCHES_GEHEIMNIS,
  STRIPE_ROUTEN_GEHEIMNIS,
  STRIPE_SIGNATUR_GEHEIMNIS,
} from "../gemeinsam/erfundene-geheimnisse.js";

const SECRET = STRIPE_SIGNATUR_GEHEIMNIS;
const NOW = 1_700_000_000;
const BODY = '{"id":"evt_1","type":"customer.subscription.updated"}';
const SIGNATURE_HEX_LENGTH = 64;
const SIGNATURE_TOLERANCE_S = 300;
const PERIOD_END_S = 1_893_456_000;
const PERIOD_START_S = 1_890_864_000;
const MS_PER_SECOND = 1000;
const HTTP_BAD_REQUEST = 400;

function signHeader(body, secret, ts) {
  const mac = crypto.createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${mac}`;
}

function nowSeconds() {
  return Math.floor(Date.now() / MS_PER_SECOND);
}

function verify({ rawBody = BODY, signatureHeader, secret = SECRET }) {
  return verifyStripeSignature({ rawBody, signatureHeader, secret, nowS: NOW });
}

test("verifyStripeSignature: gueltige Signatur im Toleranzfenster -> true", () => {
  assert.equal(verify({ signatureHeader: signHeader(BODY, SECRET, NOW) }), true);
});

test("verifyStripeSignature: fehlender/leerer Header -> false", () => {
  for (const header of [undefined, "", "garbage", `v1=${"0".repeat(SIGNATURE_HEX_LENGTH)}`]) {
    assert.equal(verify({ signatureHeader: header }), false, `Header ${JSON.stringify(header)} -> false`);
  }
});

test("verifyStripeSignature: abgelaufener Timestamp (>300s) -> false (Replay-Schutz)", () => {
  const oldTs = NOW - SIGNATURE_TOLERANCE_S - 1;
  assert.equal(verify({ signatureHeader: signHeader(BODY, SECRET, oldTs) }), false);
});

test("verifyStripeSignature: fehlendes Secret oder rawBody -> false", () => {
  const header = signHeader(BODY, SECRET, NOW);
  assert.equal(verify({ signatureHeader: header, secret: "" }), false);
  assert.equal(verify({ rawBody: null, signatureHeader: header }), false);
});

test("interpretStripeEvent: subscription.updated -> activate, tenantRef aus metadata", () => {
  const event = {
    type: SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: "sub_1",
        status: "active",
        current_period_end: PERIOD_END_S,
        metadata: { tenant_ref: "t_a", plan_slug: "starter" },
      },
    },
  };
  const result = interpretStripeEvent(event);
  assert.equal(result.action, WEBHOOK_ACTION.ACTIVATE);
  assert.equal(result.tenantRef, "t_a");
  assert.equal(result.subscriptionId, "sub_1");
  assert.equal(result.planSlug, "starter");
  assert.equal(result.currentPeriodEnd, PERIOD_END_S);
});

test("interpretStripeEvent: updated mit current_period_start -> currentPeriodStart im Ergebnis (B1a)", () => {
  const event = {
    type: SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: "sub_1",
        status: "active",
        current_period_end: PERIOD_END_S,
        current_period_start: PERIOD_START_S,
        metadata: { tenant_ref: "t_a", plan_slug: "starter" },
      },
    },
  };
  const result = interpretStripeEvent(event);
  assert.equal(result.currentPeriodStart, PERIOD_START_S, "Anker reist top-level wie currentPeriodEnd");
});

test("interpretStripeEvent: subscription.created -> activate (neuer Subscription-Checkout, P3)", () => {
  const event = {
    type: SUBSCRIPTION_EVENT.CREATED,
    data: { object: { id: "sub_new", status: "active", metadata: { tenant_ref: "t_c", plan_slug: "starter" } } },
  };
  const result = interpretStripeEvent(event);
  assert.equal(result.action, WEBHOOK_ACTION.ACTIVATE);
  assert.equal(result.tenantRef, "t_c");
  assert.equal(result.subscriptionId, "sub_new");
});

test("interpretStripeEvent: created/updated mit unbestaetigtem Status -> ignore (Invariante 1/2)", () => {
  for (const status of ["incomplete", "past_due", "unpaid", "canceled"]) {
    const created = interpretStripeEvent({
      type: SUBSCRIPTION_EVENT.CREATED,
      data: { object: { id: "sub_x", status, metadata: { tenant_ref: "t_x" } } },
    });
    assert.equal(created.action, WEBHOOK_ACTION.IGNORE, `created/${status} -> ignore`);
    const updated = interpretStripeEvent({
      type: SUBSCRIPTION_EVENT.UPDATED,
      data: { object: { id: "sub_x", status, metadata: { tenant_ref: "t_x" } } },
    });
    assert.equal(updated.action, WEBHOOK_ACTION.IGNORE, `updated/${status} -> ignore`);
  }
  const trial = interpretStripeEvent({
    type: SUBSCRIPTION_EVENT.UPDATED,
    data: { object: { id: "sub_t", status: "trialing", metadata: { tenant_ref: "t_t" } } },
  });
  assert.equal(trial.action, WEBHOOK_ACTION.ACTIVATE, "trialing -> activate (bestaetigt)");
});

test("interpretStripeEvent: subscription.deleted -> suspend", () => {
  const event = {
    type: SUBSCRIPTION_EVENT.DELETED,
    data: { object: { id: "sub_1", metadata: { tenant_ref: "t_a" } } },
  };
  const result = interpretStripeEvent(event);
  assert.equal(result.action, WEBHOOK_ACTION.SUSPEND);
  assert.equal(result.subscriptionId, "sub_1");
});

test("interpretStripeEvent: unbekannter Typ -> ignore (idempotent, kein Fehler)", () => {
  const result = interpretStripeEvent({ type: "charge.succeeded", data: { object: {} } });
  assert.equal(result.action, WEBHOOK_ACTION.IGNORE);
});

test("interpretStripeEvent: activate traegt customerId + paymentMethodId (String und expandiertes Objekt) fuer den Race-Fix", () => {
  const base = {
    type: SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: "sub_1",
        status: "active",
        customer: "cus_1",
        default_payment_method: "pm_1",
        metadata: { tenant_ref: "t_a" },
      },
    },
  };
  const result = interpretStripeEvent(base);
  assert.equal(result.customerId, "cus_1");
  assert.equal(result.paymentMethodId, "pm_1", "unexpandierter String (Webhook-Normalform)");
  const expanded = interpretStripeEvent({
    ...base,
    data: { object: { ...base.data.object, default_payment_method: { id: "pm_1" } } },
  });
  assert.equal(expanded.paymentMethodId, "pm_1", "expandierte Objekt-Form");
  const missing = interpretStripeEvent({
    ...base,
    data: { object: { id: "sub_1", status: "active", metadata: { tenant_ref: "t_a" } } },
  });
  assert.equal(missing.customerId, null, "fehlt -> null (Bestandsform bleibt wirkungslos)");
  assert.equal(missing.paymentMethodId, null);
});

test("interpretStripeEvent: Perioden-Anker aus items.data[0] (aktuelle API-Form, kein top-level current_period_*)", () => {
  const result = interpretStripeEvent({
    type: SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: "sub_1",
        status: "active",
        items: { data: [{ current_period_start: PERIOD_START_S, current_period_end: PERIOD_END_S }] },
        metadata: { tenant_ref: "t_a" },
      },
    },
  });
  assert.equal(result.currentPeriodStart, PERIOD_START_S, "Anker aus dem Item (Fallback-Quelle)");
  assert.equal(result.currentPeriodEnd, PERIOD_END_S);
});

function revokeDeps({ tenantBySub = null } = {}) {
  const calls = { setStatus: [], invalidate: [], subscription: [], suspend: [] };
  const store = {
    tenantSubscription: () => ({ planSlug: null, cancelAtPeriodEnd: false }),
    setSuspendedAtIfAbsent: (tenant) => calls.suspend.push(tenant),
    tenantExists: () => true,
    findTenantBySubscription: (subId) => (tenantBySub && subId ? { id: tenantBySub } : null),
    setTenantSubscription: (tenant, patch) => calls.subscription.push([tenant, patch]),
  };
  return {
    calls,
    store,
    accounts: { setStatus: async (tenant, status) => calls.setStatus.push([tenant, status]) },
    sessions: { invalidateByTenant: async (tenant) => calls.invalidate.push(tenant) },
    audit: () => {},
    req: {},
  };
}

test("Phase 2: customer.subscription.deleted -> setStatus(suspended) + Sessions invalidiert", async () => {
  const deps = revokeDeps();
  await applyStripeWebhook(
    { type: SUBSCRIPTION_EVENT.DELETED, data: { object: { id: "sub_1", metadata: { tenant_ref: "t_a" } } } },
    deps,
  );
  assert.deepEqual(deps.calls.setStatus, [["t_a", "suspended"]], "Tenant suspendiert");
  assert.deepEqual(deps.calls.invalidate, ["t_a"], "Sessions des Tenants invalidiert");
});

test("Phase 2: invoice.payment_failed -> Tenant ueber subscriptionId aufgeloest + suspendiert", async () => {
  const deps = revokeDeps({ tenantBySub: "t_b" });
  await applyStripeWebhook(
    { type: SUBSCRIPTION_EVENT.PAYMENT_FAILED, data: { object: { subscription: "sub_9", customer: "cus_9", metadata: {} } } },
    deps,
  );
  assert.deepEqual(deps.calls.setStatus, [["t_b", "suspended"]], "Tenant suspendiert");
  assert.deepEqual(deps.calls.invalidate, ["t_b"], "Sessions des Tenants invalidiert");
});

test("Phase 2: payment_failed ohne aufloesbaren Tenant -> No-Op (kein Cross-Tenant-Suspend)", async () => {
  const deps = revokeDeps({ tenantBySub: null });
  await applyStripeWebhook(
    { type: SUBSCRIPTION_EVENT.PAYMENT_FAILED, data: { object: { subscription: "sub_x", metadata: {} } } },
    deps,
  );
  assert.deepEqual(deps.calls.setStatus, [], "kein Suspend ohne Tenant");
  assert.deepEqual(deps.calls.invalidate, [], "keine Session-Invalidierung ohne Tenant");
});

async function assertierteWirkung(type) {
  const auditCalls = [];
  await applyStripeWebhook(
    { type, data: { object: { id: "evt_gap03" } } },
    {
      store: {},
      accounts: { setStatus: async () => {} },
      sessions: { invalidateByTenant: async () => {} },
      audit: (kind, _req, detail) => auditCalls.push(`${kind} ${detail}`),
      req: {},
      provision: async () => {},
      billing: undefined,
    },
  );
  assert.ok(
    auditCalls.length > 0,
    `SOLL: mindestens ein Audit-Eintrag (oder eine Store-Wirkung) fuer '${type}'; heute ` +
      "kehrt applyStripeWebhook VOR jedem Audit/Store-Zugriff zurueck (webhook.js:200, " +
      "interpretStripeEvent default-Zweig -> action=IGNORE, webhook.js:139-141)",
  );
}

test("Stripe-Event 'charge.dispute.created' erzeugt eine assertierte Wirkung (GAP-03, gefixt in P4)", () =>
  assertierteWirkung("charge.dispute.created"));

test("Stripe-Event 'charge.refunded' erzeugt eine assertierte Wirkung (GAP-03, gefixt in P4)", () =>
  assertierteWirkung("charge.refunded"));

test("Stripe-Event 'customer.subscription.paused' erzeugt eine assertierte Wirkung (GAP-03, gefixt in P4)", () =>
  assertierteWirkung("customer.subscription.paused"));

test("Stripe-Event 'invoice.payment_action_required' erzeugt eine assertierte Wirkung (GAP-03, gefixt in P4)", () =>
  assertierteWirkung("invoice.payment_action_required"));

function fakeRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

function makeAuditSpy() {
  const calls = [];
  const audit = (...args) => calls.push(args);
  return { audit, calls };
}

function webhookRoute({ secret, audit = () => {}, store = {}, platformAlertSmsTo, messaging }) {
  return makeStripeWebhookRoute({
    config: withConfigNamespaces({ paymentEnabled: true, stripeWebhookSecret: secret, platformAlertSmsTo }),
    store,
    audit,
    accounts: {},
    sessions: {},
    billing: {},
    provision: async () => {},
    messaging,
  });
}

async function postSignedBody(handler, body, signingSecret) {
  const req = { rawBody: Buffer.from(body), headers: { "stripe-signature": signHeader(body, signingSecret, nowSeconds()) } };
  const res = fakeRes();
  await handler(req, res);
  return res;
}

const ROUTE_SECRET = STRIPE_ROUTEN_GEHEIMNIS;
const WRONG_SECRET = STRIPE_FALSCHES_GEHEIMNIS;
const RAW_BODY = "not-json";

test("stripe-webhook-Route: korrektes config.billing.stripeWebhookSecret -> Signatur besteht, faellt am JSON.parse (400 bad payload, kein Audit-Reject)", async () => {
  const { audit, calls } = makeAuditSpy();
  const res = await postSignedBody(webhookRoute({ secret: ROUTE_SECRET, audit }), RAW_BODY, ROUTE_SECRET);
  assert.equal(res.statusCode, HTTP_BAD_REQUEST);
  assert.deepEqual(res.body, { error: "bad payload" });
  assert.equal(
    calls.some(([event]) => event === "stripe_webhook_rejected"),
    false,
    "Signatur bestand -> kein Reject-Audit, der Fehler liegt danach beim Parsen",
  );
});

test("stripe-webhook-Route: falsches Secret -> Signaturpruefung schlaegt fehl (400 invalid signature, Audit-Reject, fail-closed)", async () => {
  const { audit, calls } = makeAuditSpy();
  const res = await postSignedBody(webhookRoute({ secret: ROUTE_SECRET, audit }), RAW_BODY, WRONG_SECRET);
  assert.equal(res.statusCode, HTTP_BAD_REQUEST);
  assert.deepEqual(res.body, { error: "invalid signature" });
  assert.equal(
    calls.some(([event]) => event === "stripe_webhook_rejected"),
    true,
    "falsches Secret -> Signatur faellt durch -> Audit-Reject (fail-closed)",
  );
});

const ALARM_SECRET = STRIPE_ALARM_GEHEIMNIS;
const ALARM_CUSTOMER = "cus_alarm1";
const ALARM_TENANT = "t_alarm1";
const ALARM_SMS_TO = "+491711234567";

const BOOTSTRAP_SENDER = {
  tenantId: "owner",
  status: "active",
  provider: "telnyx",
  e164: "+491700000000",
};

function disputeBody() {
  return JSON.stringify({
    id: "evt_alarm1",
    type: "charge.dispute.created",
    data: { object: { customer: ALARM_CUSTOMER } },
  });
}

function alarmStore(sender) {
  return {
    findTenantByCustomer: (cid) => (cid === ALARM_CUSTOMER ? { id: ALARM_TENANT } : null),
    findTenantBySubscription: () => null,
    load: () => ({ numbers: sender ? [sender] : [] }),
  };
}

function fakeMessaging() {
  const calls = [];
  return { calls, messaging: () => ({ sendSms: async (args) => { calls.push(args); } }) };
}

function alarmRoute({ platformAlertSmsTo, sender, messaging }) {
  return webhookRoute({ secret: ALARM_SECRET, store: alarmStore(sender), platformAlertSmsTo, messaging });
}

test("outcome.alarm -> Route sendet die SMS ueber messaging()", async () => {
  const { calls, messaging } = fakeMessaging();
  const handler = alarmRoute({ platformAlertSmsTo: ALARM_SMS_TO, sender: BOOTSTRAP_SENDER, messaging });
  const res = await postSignedBody(handler, disputeBody(), ALARM_SECRET);
  assert.deepEqual(res.body, { received: true }, "Antwort bleibt received:true");
  assert.equal(calls.length, 1, "genau eine SMS gesendet");
  assert.match(calls[0].body, /type=charge\.dispute\.created/);
  assert.match(calls[0].body, new RegExp(`tenant=${ALARM_TENANT}`));
});

test("ohne PLATFORM_ALERT_SMS_TO: kein Versand, kein Wurf, Antwort bleibt received:true", async () => {
  const { calls, messaging } = fakeMessaging();
  const handler = alarmRoute({ platformAlertSmsTo: "", sender: BOOTSTRAP_SENDER, messaging });
  const res = await postSignedBody(handler, disputeBody(), ALARM_SECRET);
  assert.deepEqual(res.body, { received: true });
  assert.equal(calls.length, 0, "kein Versand ohne Empfaenger");
});

test("werfendes messaging() (fehlender Bootstrap-Absender) beeintraechtigt die Antwort NICHT (fail-soft)", async () => {
  const { calls, messaging } = fakeMessaging();
  const handler = alarmRoute({ platformAlertSmsTo: ALARM_SMS_TO, sender: null, messaging });
  const res = await postSignedBody(handler, disputeBody(), ALARM_SECRET);
  assert.deepEqual(res.body, { received: true }, "Antwort bleibt received:true trotz fehlendem Absender");
  assert.equal(calls.length, 0, "kein Absender -> kein Versand");
});

const VERWORFEN_MELDUNG = "verworfenes Zahlungsereignis nennt Art und Ereignis-ID nicht";
const VERWORFEN_GEIST_TENANT = "t_verworfen_geist";
const BEKANNTER_KUNDE = "cus_verworfen_bekannt";

config.server.dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-verworfen-"));
const speicher = await import("../../src/store.js");
speicher.load().numbers.push(BOOTSTRAP_SENDER);
speicher.save();
if (!fs.existsSync(path.join(config.server.dataDir, "store.json"))) {
  throw new Error("Vorbedingung: der JSON-Speicher schreibt nicht ins Wegwerf-Verzeichnis");
}

function speicherStand() {
  return {
    imSpeicher: JSON.stringify(speicher.load()),
    aufPlatte: fs.readFileSync(path.join(config.server.dataDir, "store.json"), "utf8"),
  };
}

function speicherRoute(audit, messaging) {
  return webhookRoute({
    secret: ROUTE_SECRET,
    audit,
    store: speicher,
    platformAlertSmsTo: ALARM_SMS_TO,
    messaging,
  });
}

async function sendeEreignis(ereignis) {
  const { audit, calls: auditCalls } = makeAuditSpy();
  const { calls: smsCalls, messaging } = fakeMessaging();
  const vorher = speicherStand();
  const res = await postSignedBody(speicherRoute(audit, messaging), JSON.stringify(ereignis), ROUTE_SECRET);
  await speicher.drainFlushes();
  const zeilen = auditCalls.map(([event, , detail]) => [event, detail]);
  return { res, zeilen, smsCalls, vorher, nachher: speicherStand() };
}

function ignoriertDetail(zeilen) {
  const zeile = zeilen.find(([event]) => event === "stripe_money_event_ignored");
  assert.ok(zeile, "Auditzeile stripe_money_event_ignored fehlt");
  return zeile[1];
}

test("verworfene Erstattung ohne Tenant: Audit nennt type= und event= vor no_tenant", async () => {
  const ergebnis = await sendeEreignis({
    id: "evt_verworfen_ohne_tenant",
    type: "charge.refunded",
    data: { object: { customer: "cus_verworfen_ohne_tenant" } },
  });
  assert.deepEqual(ergebnis.res.body, { received: true });
  assert.deepEqual(ergebnis.nachher, ergebnis.vorher, "kein Schreibzugriff auf den Speicher");
  assert.equal(
    ignoriertDetail(ergebnis.zeilen),
    "type=charge.refunded event=evt_verworfen_ohne_tenant no_tenant",
    VERWORFEN_MELDUNG,
  );
});

test("verworfene Erstattung mit unbekanntem tenant_ref: Audit nennt type= und event= vor unknown_tenant", async () => {
  const ergebnis = await sendeEreignis({
    id: "evt_verworfen_geist",
    type: "charge.refunded",
    data: { object: { customer: "cus_verworfen_geist", metadata: { tenant_ref: VERWORFEN_GEIST_TENANT } } },
  });
  assert.deepEqual(ergebnis.res.body, { received: true });
  assert.deepEqual(ergebnis.nachher, ergebnis.vorher, "kein Schreibzugriff auf den Speicher");
  assert.equal(
    ignoriertDetail(ergebnis.zeilen),
    `type=charge.refunded event=evt_verworfen_geist tenant=${VERWORFEN_GEIST_TENANT} unknown_tenant`,
    VERWORFEN_MELDUNG,
  );
});

test("verworfene Rückbuchung ohne Tenant: keine Alarm-SMS, Audit nennt type= und event=", async () => {
  const ergebnis = await sendeEreignis({
    id: "evt_verworfen_dispute",
    type: "charge.dispute.created",
    data: { object: { customer: "cus_verworfen_dispute" } },
  });
  assert.deepEqual(ergebnis.res.body, { received: true });
  assert.equal(ergebnis.smsCalls.length, 0, "keine Alarm-SMS fuer ein verworfenes Ereignis");
  assert.equal(
    ignoriertDetail(ergebnis.zeilen),
    "type=charge.dispute.created event=evt_verworfen_dispute no_tenant",
    VERWORFEN_MELDUNG,
  );
});

test("[NIE1] Zahlungsereignisse ohne Tenant: received:true, Speicher unveraendert, keine Alarm-SMS", async () => {
  const ereignisse = [
    { id: "evt_nie1_dispute", type: "charge.dispute.created", data: { object: { customer: "cus_nie1_dispute" } } },
    { id: "evt_nie1_aktion", type: "invoice.payment_action_required", data: { object: { customer: "cus_nie1_aktion" } } },
    {
      id: "evt_nie1_geist",
      type: "charge.dispute.created",
      data: { object: { customer: "cus_nie1_geist", metadata: { tenant_ref: "t_nie1_geist" } } },
    },
  ];
  for (const ereignis of ereignisse) {
    const ergebnis = await sendeEreignis(ereignis);
    assert.deepEqual(ergebnis.res.body, { received: true }, `${ereignis.id}: Antwort received:true`);
    assert.deepEqual(ergebnis.nachher, ergebnis.vorher, `${ereignis.id}: kein Schreibzugriff`);
    assert.equal(ergebnis.smsCalls.length, 0, `${ereignis.id}: keine Alarm-SMS`);
  }
});

test("[NIE2] Auditzeile des verworfenen Ereignisses behaelt den Grund und nennt keine Kunden-ID", async () => {
  const ohneTenant = await sendeEreignis({
    id: "evt_nie2_ohne",
    type: "customer.subscription.paused",
    data: { object: { customer: "cus_nie2_ohne" } },
  });
  const ohneDetail = ignoriertDetail(ohneTenant.zeilen);
  assert.match(ohneDetail, /(^| )no_tenant$/, "Grund no_tenant bleibt am Ende der Zeile");
  assert.equal(ohneDetail.includes("cus_nie2_ohne"), false, "keine Kunden-ID in der Zeile");

  const geist = await sendeEreignis({
    id: "evt_nie2_geist",
    type: "charge.refunded",
    data: { object: { customer: "cus_nie2_geist", metadata: { tenant_ref: "t_nie2_geist" } } },
  });
  const geistDetail = ignoriertDetail(geist.zeilen);
  assert.match(geistDetail, /(^| )tenant=t_nie2_geist unknown_tenant$/, "Grund unknown_tenant bleibt");
  assert.equal(geistDetail.includes("cus_nie2_geist"), false, "keine Kunden-ID in der Zeile");
});

test("[NIE3] stripe_money_event-Zeile und aufgeloeste Zahlungsereignisse bleiben wie bisher", async () => {
  const verworfen = await sendeEreignis({
    id: "evt_nie3_verworfen",
    type: "charge.refunded",
    data: { object: { customer: "cus_nie3_verworfen" } },
  });
  assert.deepEqual(verworfen.zeilen[0], [
    "stripe_money_event",
    "type=charge.refunded event=evt_nie3_verworfen action=revoke_period_credit",
  ]);

  speicher.setTenantStripe(BOOTSTRAP_SENDER.tenantId, { customerId: BEKANNTER_KUNDE });
  const erstattung = await sendeEreignis({
    id: "evt_nie3_erstattung",
    type: "charge.refunded",
    data: { object: { customer: BEKANNTER_KUNDE } },
  });
  assert.deepEqual(erstattung.res.body, { received: true });
  assert.deepEqual(erstattung.zeilen, [
    ["stripe_money_event", "type=charge.refunded event=evt_nie3_erstattung action=revoke_period_credit"],
  ]);
  assert.equal(speicher.tenantSubscription(BOOTSTRAP_SENDER.tenantId).periodCreditRevoked, true);
  assert.equal(erstattung.smsCalls.length, 0, "Erstattung ohne Alarm");

  const rueckbuchung = await sendeEreignis({
    id: "evt_nie3_dispute",
    type: "charge.dispute.created",
    data: { object: { customer: BEKANNTER_KUNDE } },
  });
  assert.deepEqual(rueckbuchung.zeilen, [
    ["stripe_money_event", "type=charge.dispute.created event=evt_nie3_dispute action=warn"],
  ]);
  assert.deepEqual(rueckbuchung.nachher, rueckbuchung.vorher, "Rueckbuchung schreibt nichts");
  assert.equal(rueckbuchung.smsCalls.length, 1, "aufgeloeste Rueckbuchung alarmiert weiter");
  assert.match(rueckbuchung.smsCalls[0].body, /type=charge\.dispute\.created tenant=owner$/);
});

const ABO_SECRET = STRIPE_ROUTEN_GEHEIMNIS;
const ABO_CREATED_S = 1_800_000_000;
const VERZOEGERUNG_RUNDEN = 20;

async function aboStore(tenantId, subscriptionId, { gesperrt = false } = {}) {
  const { store } = await makePgTestStore();
  store.load().tenants.push({
    id: tenantId,
    status: gesperrt ? "suspended" : "active",
    firstName: "Kunde",
    ownerName: "Kunde Abo",
    idpSubject: tenantId,
  });
  store.setTenantSubscription(tenantId, { subscriptionId, planSlug: "starter", currentPeriodEnd: PERIOD_END_S });
  if (gesperrt) store.setSuspendedAtIfAbsent(tenantId);
  return store;
}

function stripeAbo(cancelAtPeriodEnd) {
  return { planSlug: "starter", numberSetupFeeExempt: false, status: "active", cancelAtPeriodEnd };
}

function aboRoute({ store, retrieveSubscription, audit = () => {} }) {
  const kontoStatus = [];
  const handler = makeStripeWebhookRoute({
    config: withConfigNamespaces({ paymentEnabled: true, stripeWebhookSecret: ABO_SECRET }),
    store,
    audit,
    accounts: { setStatus: async (tenant, status) => kontoStatus.push([tenant, status]) },
    sessions: { invalidateByTenant: async () => {} },
    billing: { retrieveSubscription },
    provision: async () => {},
  });
  return { handler, kontoStatus };
}

function aboEreignis({ id, tenantId, subscriptionId, cancelAtPeriodEnd, created = ABO_CREATED_S }) {
  return JSON.stringify({
    id,
    type: SUBSCRIPTION_EVENT.UPDATED,
    created,
    data: {
      object: {
        id: subscriptionId,
        status: "active",
        cancel_at_period_end: cancelAtPeriodEnd,
        metadata: { tenant_ref: tenantId, plan_slug: "starter" },
      },
    },
  });
}

function aboEndeEreignis({ id, tenantId, subscriptionId }) {
  return JSON.stringify({
    id,
    type: SUBSCRIPTION_EVENT.DELETED,
    created: ABO_CREATED_S,
    data: { object: { id: subscriptionId, status: "canceled", metadata: { tenant_ref: tenantId } } },
  });
}

test("Kündigung nach Fortsetzen in derselben Sekunde: gespeicherter Kündigungsstand folgt Stripe (true)", async () => {
  const store = await aboStore("t_f9_abnahme", "sub_f9_abnahme");
  const { handler } = aboRoute({ store, retrieveSubscription: async () => stripeAbo(true) });
  const ziel = { tenantId: "t_f9_abnahme", subscriptionId: "sub_f9_abnahme" };
  const fortsetzen = await postSignedBody(handler, aboEreignis({ id: "evt_f9_a1", cancelAtPeriodEnd: false, ...ziel }), ABO_SECRET);
  const kuendigen = await postSignedBody(handler, aboEreignis({ id: "evt_f9_a2", cancelAtPeriodEnd: true, ...ziel }), ABO_SECRET);
  assert.deepEqual(fortsetzen.body, { received: true });
  assert.deepEqual(kuendigen.body, { received: true });
  assert.equal(
    store.tenantSubscription("t_f9_abnahme").cancelAtPeriodEnd,
    true,
    "Fortsetzen-Ereignis derselben Sekunde überschreibt die spätere Kündigung",
  );
});

test("[NIE1] deleted, danach updated derselben Sekunde lässt den Tenant gesperrt, auch wenn Stripe ein laufendes Abo meldet", async () => {
  const store = await aboStore("t_f9_nie1", "sub_f9_nie1");
  const { handler, kontoStatus } = aboRoute({ store, retrieveSubscription: async () => stripeAbo(false) });
  const ziel = { tenantId: "t_f9_nie1", subscriptionId: "sub_f9_nie1" };
  await postSignedBody(handler, aboEndeEreignis({ id: "evt_f9_n1a", ...ziel }), ABO_SECRET);
  const res = await postSignedBody(handler, aboEreignis({ id: "evt_f9_n1b", cancelAtPeriodEnd: false, ...ziel }), ABO_SECRET);
  assert.deepEqual(res.body, { received: true });
  assert.deepEqual(kontoStatus, [["t_f9_nie1", "suspended"]], "kein Freischalten nach dem Abo-Ende");
  assert.notEqual(store.tenantSuspendedAt("t_f9_nie1"), null, "Sperrzeitpunkt bleibt gesetzt");
});

test("[NIE2] scheiternder Abruf: updated mit Kündigung wird wie heute gespeichert und mit received:true beantwortet", async () => {
  const store = await aboStore("t_f9_nie2", "sub_f9_nie2");
  const retrieveSubscription = async () => {
    throw new Error("stripe nicht erreichbar");
  };
  const { handler } = aboRoute({ store, retrieveSubscription });
  const body = aboEreignis({ id: "evt_f9_n2", tenantId: "t_f9_nie2", subscriptionId: "sub_f9_nie2", cancelAtPeriodEnd: true });
  const res = await postSignedBody(handler, body, ABO_SECRET);
  assert.deepEqual(res.body, { received: true });
  assert.equal(store.tenantSubscription("t_f9_nie2").cancelAtPeriodEnd, true, "Stand aus dem Ereignis bleibt");
});

test("[NIE3] updated mit Kündigung hebt die Sperre eines gesperrten Tenants nicht auf, auch wenn Stripe nicht gekündigt meldet", async () => {
  const store = await aboStore("t_f9_nie3", "sub_f9_nie3", { gesperrt: true });
  const { handler, kontoStatus } = aboRoute({ store, retrieveSubscription: async () => stripeAbo(false) });
  const body = aboEreignis({ id: "evt_f9_n3", tenantId: "t_f9_nie3", subscriptionId: "sub_f9_nie3", cancelAtPeriodEnd: true });
  const res = await postSignedBody(handler, body, ABO_SECRET);
  assert.deepEqual(res.body, { received: true });
  assert.deepEqual(kontoStatus, [], "Konto wird nicht freigeschaltet");
  assert.notEqual(store.tenantSuspendedAt("t_f9_nie3"), null, "Sperrzeitpunkt bleibt gesetzt");
});

test("[NIE4] verworfenes Fortsetzen derselben Sekunde nach Kündigung: Kündigungsstand folgt dem Abruf (false)", async () => {
  const store = await aboStore("t_f9_nie4", "sub_f9_nie4");
  let stripeStand = true;
  const { handler } = aboRoute({ store, retrieveSubscription: async () => stripeAbo(stripeStand) });
  const ziel = { tenantId: "t_f9_nie4", subscriptionId: "sub_f9_nie4" };
  const kuendigen = await postSignedBody(handler, aboEreignis({ id: "evt_f9_n4a", cancelAtPeriodEnd: true, ...ziel }), ABO_SECRET);
  stripeStand = false;
  const fortsetzen = await postSignedBody(handler, aboEreignis({ id: "evt_f9_n4b", cancelAtPeriodEnd: false, ...ziel }), ABO_SECRET);
  assert.deepEqual(kuendigen.body, { received: true });
  assert.deepEqual(fortsetzen.body, { received: true });
  assert.equal(store.tenantSubscription("t_f9_nie4").cancelAtPeriodEnd, false, "Stand bei Stripe: fortgesetzt");
});

test("[NIE5] gleichzeitige Zustellung: verzögerte ältere Abrufantwort überschreibt die neuere nicht", async () => {
  const store = await aboStore("t_f9_nie5", "sub_f9_nie5");
  let abrufe = 0;
  const retrieveSubscription = async () => {
    abrufe += 1;
    if (abrufe > 1) return stripeAbo(false);
    for (let runde = 0; runde < VERZOEGERUNG_RUNDEN; runde += 1) await new Promise((resolve) => setImmediate(resolve));
    return stripeAbo(true);
  };
  const { handler } = aboRoute({ store, retrieveSubscription });
  const ziel = { tenantId: "t_f9_nie5", subscriptionId: "sub_f9_nie5" };
  const frueher = aboEreignis({ id: "evt_f9_n5a", cancelAtPeriodEnd: true, ...ziel });
  const spaeter = aboEreignis({ id: "evt_f9_n5b", cancelAtPeriodEnd: false, created: ABO_CREATED_S + 1, ...ziel });
  await Promise.all([postSignedBody(handler, frueher, ABO_SECRET), postSignedBody(handler, spaeter, ABO_SECRET)]);
  assert.equal(store.tenantSubscription("t_f9_nie5").cancelAtPeriodEnd, false, "neuerer Stand bei Stripe gewinnt");
});

test("[NIE6] updated für unbekannten Tenant: received:true, Audit unknown_tenant, kein Tenant angelegt", async () => {
  const store = await aboStore("t_f9_nie6", "sub_f9_nie6");
  const { audit, calls } = makeAuditSpy();
  const { handler } = aboRoute({ store, audit, retrieveSubscription: async () => stripeAbo(true) });
  const body = aboEreignis({ id: "evt_f9_n6", tenantId: "t_f9_gibtsnicht", subscriptionId: "sub_f9_nie6_fremd", cancelAtPeriodEnd: false });
  const vorher = store.tenantSubscription("t_f9_nie6");
  const res = await postSignedBody(handler, body, ABO_SECRET);
  assert.deepEqual(res.body, { received: true });
  assert.equal(
    calls.some(([event, , detail]) => event === "stripe_webhook_ignored" && String(detail).includes("unknown_tenant")),
    true,
    "Audit stripe_webhook_ignored mit unknown_tenant",
  );
  assert.equal(store.tenantExists("t_f9_gibtsnicht"), false, "kein Schreiben am unbekannten Tenant");
  assert.deepEqual(store.tenantSubscription("t_f9_nie6"), vorher, "anderer Tenant unberührt");
});

const EIGENE_DECKE_CENTS = 1234;

function aboEreignisOhneTenantRef({ id, subscriptionId, cancelAtPeriodEnd }) {
  return JSON.stringify({
    id,
    type: SUBSCRIPTION_EVENT.UPDATED,
    created: ABO_CREATED_S,
    data: { object: { id: subscriptionId, status: "active", cancel_at_period_end: cancelAtPeriodEnd, metadata: {} } },
  });
}

function deckeVon(store, tenantId) {
  return store.load().tenantBudgets.find((row) => row.tenantId === tenantId) ?? null;
}

async function deckeNachVerworfenemEreignis(tenantId, subscriptionId, retrieveSubscription) {
  const store = await aboStore(tenantId, subscriptionId);
  const { handler } = aboRoute({ store, retrieveSubscription });
  const ziel = { tenantId, subscriptionId, cancelAtPeriodEnd: false };
  await postSignedBody(handler, aboEreignis({ id: `${subscriptionId}_e1`, ...ziel }), ABO_SECRET);
  store.setTenantBudget(tenantId, { budgetCents: EIGENE_DECKE_CENTS, hardCapCents: EIGENE_DECKE_CENTS });
  const res = await postSignedBody(handler, aboEreignis({ id: `${subscriptionId}_e2`, ...ziel }), ABO_SECRET);
  assert.deepEqual(res.body, { received: true });
  return deckeVon(store, tenantId);
}

test("Ereignis ohne tenant_ref: Kündigungsstand des Abo-Halters folgt dem Abruf bei Stripe", async () => {
  const store = await aboStore("t_f9_ohneref", "sub_f9_ohneref");
  const { handler } = aboRoute({ store, retrieveSubscription: async () => stripeAbo(true) });
  const body = aboEreignisOhneTenantRef({ id: "evt_f9_or", subscriptionId: "sub_f9_ohneref", cancelAtPeriodEnd: false });
  const res = await postSignedBody(handler, body, ABO_SECRET);
  assert.deepEqual(res.body, { received: true });
  assert.equal(store.tenantSubscription("t_f9_ohneref").cancelAtPeriodEnd, true, "Stand bei Stripe: gekündigt");
});

test("Ereignis ohne tenant_ref für unbekannte Abo-ID: received:true, kein Tenant berührt", async () => {
  const store = await aboStore("t_f9_unbekannt", "sub_f9_unbekannt");
  const { handler } = aboRoute({ store, retrieveSubscription: async () => stripeAbo(true) });
  const body = aboEreignisOhneTenantRef({ id: "evt_f9_ub", subscriptionId: "sub_f9_gibtsnicht", cancelAtPeriodEnd: false });
  const res = await postSignedBody(handler, body, ABO_SECRET);
  assert.deepEqual(res.body, { received: true });
  assert.equal(store.tenantSubscription("t_f9_unbekannt").cancelAtPeriodEnd, false);
});

test("Zahlung gescheitert (Sperre): Kündigungsstand wird nicht aus dem Abruf übernommen", async () => {
  const store = await aboStore("t_f9_zahlung", "sub_f9_zahlung");
  const { handler, kontoStatus } = aboRoute({ store, retrieveSubscription: async () => stripeAbo(true) });
  const body = JSON.stringify({
    id: "evt_f9_pf",
    type: SUBSCRIPTION_EVENT.PAYMENT_FAILED,
    created: ABO_CREATED_S,
    data: { object: { subscription: "sub_f9_zahlung", customer: "cus_f9", metadata: { tenant_ref: "t_f9_zahlung" } } },
  });
  const res = await postSignedBody(handler, body, ABO_SECRET);
  assert.deepEqual(res.body, { received: true });
  assert.deepEqual(kontoStatus, [["t_f9_zahlung", "suspended"]]);
  assert.equal(store.tenantSubscription("t_f9_zahlung").cancelAtPeriodEnd, false, "nur ACTIVATE/CANCEL_SCHEDULED gleichen ab");
});

test("verworfenes updated nach Abo-Ende derselben Sekunde setzt den Kündigungsstand nicht aus dem Abruf", async () => {
  const store = await aboStore("t_f9_ende", "sub_f9_ende");
  const { handler } = aboRoute({ store, retrieveSubscription: async () => stripeAbo(true) });
  const ziel = { tenantId: "t_f9_ende", subscriptionId: "sub_f9_ende" };
  await postSignedBody(handler, aboEndeEreignis({ id: "evt_f9_ea", ...ziel }), ABO_SECRET);
  const res = await postSignedBody(handler, aboEreignis({ id: "evt_f9_eb", cancelAtPeriodEnd: false, ...ziel }), ABO_SECRET);
  assert.deepEqual(res.body, { received: true });
  assert.equal(store.tenantSubscription("t_f9_ende").subscriptionId, null, "Abo-Referenz bleibt gelöscht");
  assert.equal(store.tenantSubscription("t_f9_ende").cancelAtPeriodEnd, false, "kein Abgleich ohne laufendes Abo");
});

test("verworfenes älteres Ereignis verschiebt die Ordnung nicht: späteres Duplikat der neuesten Sekunde bleibt verworfen", async () => {
  const store = await aboStore("t_f9_anker", "sub_f9_anker");
  const retrieveSubscription = async () => {
    throw new Error("stripe nicht erreichbar");
  };
  const { handler } = aboRoute({ store, retrieveSubscription });
  const ziel = { tenantId: "t_f9_anker", subscriptionId: "sub_f9_anker" };
  const neuer = ABO_CREATED_S + 1;
  await postSignedBody(handler, aboEreignis({ id: "evt_f9_k1", cancelAtPeriodEnd: false, created: neuer, ...ziel }), ABO_SECRET);
  await postSignedBody(handler, aboEreignis({ id: "evt_f9_k2", cancelAtPeriodEnd: true, ...ziel }), ABO_SECRET);
  await postSignedBody(handler, aboEreignis({ id: "evt_f9_k3", cancelAtPeriodEnd: true, created: neuer, ...ziel }), ABO_SECRET);
  assert.equal(store.tenantSubscription("t_f9_anker").cancelAtPeriodEnd, false, "nur das zuerst angewendete Ereignis zählt");
});

test("scheiternder Abruf bei verworfenem Ereignis: kein Schreiben, eigene Tenant-Decke bleibt", async () => {
  const retrieveSubscription = async () => {
    throw new Error("stripe nicht erreichbar");
  };
  const decke = await deckeNachVerworfenemEreignis("t_f9_dwirft", "sub_f9_dwirft", retrieveSubscription);
  assert.equal(decke.hardCapCents, EIGENE_DECKE_CENTS);
});

test("Abruf ohne Wahrheitswert bei verworfenem Ereignis: kein Schreiben, eigene Tenant-Decke bleibt", async () => {
  const retrieveSubscription = async () => ({ planSlug: "starter", status: "active" });
  const decke = await deckeNachVerworfenemEreignis("t_f9_dleer", "sub_f9_dleer", retrieveSubscription);
  assert.equal(decke.hardCapCents, EIGENE_DECKE_CENTS);
});

test("Abruf mit unverändertem Kündigungsstand bei verworfenem Ereignis: kein Schreiben, eigene Tenant-Decke bleibt", async () => {
  const decke = await deckeNachVerworfenemEreignis("t_f9_dgleich", "sub_f9_dgleich", async () => stripeAbo(false));
  assert.equal(decke.hardCapCents, EIGENE_DECKE_CENTS);
});

async function abrufZumAltenAboUeberholt({ tenantId, standAlt, standNeu }) {
  const altId = `sub_${tenantId}_alt`;
  const neuId = `sub_${tenantId}_neu`;
  const store = await aboStore(tenantId, altId);
  let freigeben;
  const freigabe = new Promise((resolve) => (freigeben = resolve));
  let abrufGestartet;
  const gestartet = new Promise((resolve) => (abrufGestartet = resolve));
  const retrieveSubscription = async (subscriptionId) => {
    if (subscriptionId !== altId) return stripeAbo(standNeu);
    abrufGestartet();
    await freigabe;
    return stripeAbo(standAlt);
  };
  const { handler } = aboRoute({ store, retrieveSubscription });
  const altEreignis = aboEreignis({ id: `evt_${tenantId}_alt`, tenantId, subscriptionId: altId, cancelAtPeriodEnd: true });
  const neuEreignis = aboEreignis({ id: `evt_${tenantId}_neu`, tenantId, subscriptionId: neuId, cancelAtPeriodEnd: false });
  const altAntwort = postSignedBody(handler, altEreignis, ABO_SECRET);
  await gestartet;
  const neuRes = await postSignedBody(handler, neuEreignis, ABO_SECRET);
  freigeben();
  const altRes = await altAntwort;
  return { stand: store.tenantSubscription(tenantId), neuId, altRes, neuRes };
}

test("Abo-Wechsel während des Abrufs zum alten Abo: Kündigungsstand des neuen Abos bleibt (false)", async () => {
  const { stand } = await abrufZumAltenAboUeberholt({ tenantId: "t_f9_a2_abnahme", standAlt: true, standNeu: false });
  assert.equal(stand.cancelAtPeriodEnd, false, "Abruf zum alten Abo überschreibt den Kündigungsstand des neuen Abos");
});

test("[NIE1] Tenant hält nach dem Abruf dasselbe Abo: Kündigungsstand aus dem Abruf wird gespeichert", async () => {
  const store = await aboStore("t_f9_a2_nie1", "sub_f9_a2_nie1");
  const retrieveSubscription = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    return stripeAbo(true);
  };
  const { handler } = aboRoute({ store, retrieveSubscription });
  const body = aboEreignis({ id: "evt_f9_a2_n1", tenantId: "t_f9_a2_nie1", subscriptionId: "sub_f9_a2_nie1", cancelAtPeriodEnd: false });
  const res = await postSignedBody(handler, body, ABO_SECRET);
  assert.deepEqual(res.body, { received: true });
  assert.equal(store.tenantSubscription("t_f9_a2_nie1").cancelAtPeriodEnd, true, "Stand bei Stripe: gekündigt");
});

test("[NIE2] Ereignis zum neuen Abo setzt die Abo-Referenz und speichert den Stand aus seinem eigenen Abruf", async () => {
  const { stand, neuId } = await abrufZumAltenAboUeberholt({ tenantId: "t_f9_a2_nie2", standAlt: true, standNeu: true });
  assert.equal(stand.subscriptionId, neuId, "Abo-Referenz zeigt auf das neue Abo");
  assert.equal(stand.cancelAtPeriodEnd, true, "Stand aus dem Abruf des neuen Abos");
});

test("[NIE3] Abo-Wechsel während des Abrufs zum alten Abo: beide Ereignisse werden mit received:true beantwortet", async () => {
  const { altRes, neuRes } = await abrufZumAltenAboUeberholt({ tenantId: "t_f9_a2_nie3", standAlt: true, standNeu: false });
  assert.deepEqual(neuRes.body, { received: true }, "Ereignis zum neuen Abo");
  assert.deepEqual(altRes.body, { received: true }, "Ereignis zum alten Abo");
});

function abrufProtokoll() {
  const abrufe = [];
  const retrieveSubscription = async (subscriptionId) => {
    abrufe.push(subscriptionId);
    return stripeAbo(true);
  };
  return { abrufe, retrieveSubscription };
}

test("verworfenes updated nach Abo-Ende derselben Sekunde löst keinen Abruf bei Stripe aus", async () => {
  const store = await aboStore("t_f9_a2_ohneabruf", "sub_f9_a2_ohneabruf");
  const { abrufe, retrieveSubscription } = abrufProtokoll();
  const { handler } = aboRoute({ store, retrieveSubscription });
  const ziel = { tenantId: "t_f9_a2_ohneabruf", subscriptionId: "sub_f9_a2_ohneabruf" };
  await postSignedBody(handler, aboEndeEreignis({ id: "evt_f9_a2_oa", ...ziel }), ABO_SECRET);
  const res = await postSignedBody(handler, aboEreignis({ id: "evt_f9_a2_ob", cancelAtPeriodEnd: false, ...ziel }), ABO_SECRET);
  assert.deepEqual(res.body, { received: true });
  assert.deepEqual(abrufe, [], "kein Abruf für ein Abo, das der Tenant nicht mehr hält");
});

test("updated für unbekannten Tenant löst keinen Abruf bei Stripe aus", async () => {
  const store = await aboStore("t_f9_a2_fremd", "sub_f9_a2_fremd");
  const { abrufe, retrieveSubscription } = abrufProtokoll();
  const { handler } = aboRoute({ store, retrieveSubscription });
  const body = aboEreignis({ id: "evt_f9_a2_fr", tenantId: "t_f9_a2_niemand", subscriptionId: "sub_f9_a2_niemand", cancelAtPeriodEnd: false });
  const res = await postSignedBody(handler, body, ABO_SECRET);
  assert.deepEqual(res.body, { received: true });
  assert.deepEqual(abrufe, [], "kein Abruf ohne aufgelösten Tenant");
});
