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
