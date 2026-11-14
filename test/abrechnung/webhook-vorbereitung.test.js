import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  applyStripeWebhook,
  interpretStripeEvent,
  paymentMethodIdOf,
  periodFieldsOf,
  verifyStripeSignature,
  SUBSCRIPTION_EVENT,
} from "../../src/billing/webhook.js";
import { MONEY_EVENT } from "../../src/billing/money-events.ts";

const IGNORIERT = { action: "ignore", tenantRef: null, subscriptionId: null };

const SIGNIERT = Buffer.from('{"id":"evt_1"}');
const GEHEIM = "signierschluessel-nur-im-test";

function kopfzeile(zeit, hex) {
  return `t=${zeit},v1=${hex}`;
}

function hexVon(zeit, koerper, geheim) {
  return crypto.createHmac("sha256", geheim).update(`${zeit}.${koerper.toString("utf8")}`).digest("hex");
}

test("Signatur: passender, abweichender und kuerzerer Wert", () => {
  const echt = hexVon(1000, SIGNIERT, GEHEIM);
  const falsch = hexVon(1000, SIGNIERT, "anderer-schluessel");
  const lauf = (hex, secret = GEHEIM) =>
    verifyStripeSignature({ rawBody: SIGNIERT, signatureHeader: kopfzeile(1000, hex), secret, nowS: 1000 });
  assert.equal(lauf(echt), true);
  assert.equal(lauf(falsch), false);
  assert.equal(lauf(echt.slice(2)), false);
  assert.equal(lauf(echt, ""), false);
});

test("Ereignis ohne Koerper oder ohne Status wird ignoriert", () => {
  assert.deepEqual(interpretStripeEvent(null), IGNORIERT);
  assert.deepEqual(interpretStripeEvent(undefined), IGNORIERT);
  assert.deepEqual(interpretStripeEvent({ type: SUBSCRIPTION_EVENT.CREATED }), IGNORIERT);
  assert.deepEqual(interpretStripeEvent({ type: SUBSCRIPTION_EVENT.CREATED, data: {} }), IGNORIERT);
  assert.deepEqual(interpretStripeEvent({ type: "unbekannt.ereignis", data: { object: { id: "x" } } }), IGNORIERT);
});

test("Abo-Ereignis: Mandant, Plan und Zeitraum aus Metadaten und Position", () => {
  const mit = interpretStripeEvent({
    type: SUBSCRIPTION_EVENT.UPDATED,
    data: {
      object: {
        id: "sub_1",
        status: "active",
        customer: "cus_1",
        metadata: { tenant_ref: "t_1", plan_slug: "pro" },
        items: { data: [{ current_period_start: 10, current_period_end: 20 }] },
        current_period_start: 1,
        current_period_end: 2,
      },
    },
  });
  assert.equal(mit.tenantRef, "t_1");
  assert.equal(mit.planSlug, "pro");
  assert.equal(mit.currentPeriodStart, 10);
  assert.equal(mit.currentPeriodEnd, 20);
  const ohne = interpretStripeEvent({
    type: SUBSCRIPTION_EVENT.UPDATED,
    data: { object: { id: "sub_2", status: "trialing", current_period_start: 1, current_period_end: 2 } },
  });
  assert.equal(ohne.tenantRef, null);
  assert.equal(ohne.planSlug, null);
  assert.equal(ohne.currentPeriodStart, 1);
  assert.equal(ohne.currentPeriodEnd, 2);
});

test("Zeitraum: fehlende Position, leere Liste und halbe Position", () => {
  assert.deepEqual(periodFieldsOf({ current_period_start: 1, current_period_end: 2 }), {
    currentPeriodStart: 1,
    currentPeriodEnd: 2,
  });
  assert.deepEqual(periodFieldsOf({ items: {}, current_period_start: 1, current_period_end: 2 }), {
    currentPeriodStart: 1,
    currentPeriodEnd: 2,
  });
  assert.deepEqual(periodFieldsOf({ items: { data: [] }, current_period_start: 1, current_period_end: 2 }), {
    currentPeriodStart: 1,
    currentPeriodEnd: 2,
  });
  assert.deepEqual(
    periodFieldsOf({ items: { data: [{ current_period_end: 20 }] }, current_period_start: 1, current_period_end: 2 }),
    { currentPeriodStart: 1, currentPeriodEnd: 20 },
  );
});

test("Zahlungsmethode: Text, Objekt mit Kennung, sonst null", () => {
  assert.equal(paymentMethodIdOf("pm_1"), "pm_1");
  assert.equal(paymentMethodIdOf({ id: "pm_2" }), "pm_2");
  assert.equal(paymentMethodIdOf({}), null);
  assert.equal(paymentMethodIdOf(null), null);
  assert.equal(paymentMethodIdOf(undefined), null);
});

function geldSpeicher({ kunde = "cus_g" } = {}) {
  return {
    findTenantByCustomer: (id) => (id === kunde ? { id: "t_g" } : null),
    findTenantBySubscription: () => null,
    tenantExists: () => true,
    setTenantSubscription: () => undefined,
    setBillingHold: () => Promise.resolve(),
  };
}

function einsatz(store) {
  const audits = [];
  return { audits, deps: { store, accounts: {}, sessions: {}, audit: (art, _req, detail) => audits.push([art, detail]), req: {} } };
}

test("Geldereignis ohne Kennung und ohne Kunden: Audit nennt Art, unknown und Grund", async () => {
  const { audits, deps } = einsatz(geldSpeicher());
  const ergebnis = await applyStripeWebhook({ type: MONEY_EVENT.DISPUTE_CREATED, data: { object: { customer: "" } } }, deps);
  assert.deepEqual(audits[0], ["stripe_money_event", `type=${MONEY_EVENT.DISPUTE_CREATED} event=unknown action=warn`]);
  assert.deepEqual(audits[1], [
    "stripe_money_event_ignored",
    `type=${MONEY_EVENT.DISPUTE_CREATED} event=unknown no_tenant`,
  ]);
  assert.deepEqual(ergebnis, { action: "money_event", tenant: null, alarm: null });
});

test("Geldereignis ueber Kunden: Mandant gefunden, Alarm mit Art und Mandant", async () => {
  const { deps } = einsatz(geldSpeicher());
  const ergebnis = await applyStripeWebhook(
    { id: "evt_g", type: MONEY_EVENT.DISPUTE_CREATED, data: { object: { customer: "cus_g" } } },
    deps,
  );
  assert.equal(ergebnis.tenant, "t_g");
  assert.deepEqual(ergebnis.alarm, {
    prefix: "[Hermes] Zahlungsereignis: ",
    detail: `type=${MONEY_EVENT.DISPUTE_CREATED} tenant=t_g`,
  });
});

test("Unbekannter Mandant aus Metadaten: Audit nennt Mandant und Grund", async () => {
  const speicher = { ...geldSpeicher(), tenantExists: () => false };
  const { audits, deps } = einsatz(speicher);
  await applyStripeWebhook(
    { id: "evt_u", type: SUBSCRIPTION_EVENT.DELETED, data: { object: { id: "sub_u", metadata: { tenant_ref: "t_weg" } } } },
    deps,
  );
  assert.deepEqual(audits, [["stripe_webhook_ignored", "action=suspend tenant=t_weg unknown_tenant"]]);
});

function endeSpeicher(fehler) {
  return {
    tenantExists: () => true,
    findTenantBySubscription: () => null,
    tenantSubscription: () => ({ subscriptionId: "sub_e", cancelAtPeriodEnd: true }),
    setTenantSubscription: () => undefined,
    setSuspendedAtIfAbsent: () => Promise.resolve(),
    tenantIdpSubject: () => null,
    tenantsPendingContractEndCleanup: () => [],
    setContractEndCleanupPending: () => Promise.reject(fehler),
  };
}

async function endeLauf(fehler, t) {
  const zeilen = [];
  t.mock.method(console, "error", (...teile) => zeilen.push(teile.join(" ")));
  const { deps } = einsatz(endeSpeicher(fehler));
  const ergebnis = await applyStripeWebhook(
    { id: "evt_e", type: SUBSCRIPTION_EVENT.DELETED, data: { object: { id: "sub_e", metadata: { tenant_ref: "t_e" } } } },
    {
      ...deps,
      accounts: { setStatus: () => Promise.resolve() },
      sessions: { invalidateByTenant: () => Promise.resolve() },
    },
  );
  return { zeilen, ergebnis };
}

test("Vertragsende: Fehler beim Aufraeumen wird mit Meldung geloggt, Sperre bleibt", async (t) => {
  const { zeilen, ergebnis } = await endeLauf(new Error("speicher kaputt"), t);
  assert.deepEqual(ergebnis, { suspended: true });
  assert.deepEqual(zeilen, ["[contract-end] Aufraeumen fehlgeschlagen tenant=t_e: speicher kaputt"]);
});

test("Vertragsende: Fehler ohne Error-Objekt wird als Text geloggt", async (t) => {
  const { zeilen, ergebnis } = await endeLauf("nur-text", t);
  assert.deepEqual(ergebnis, { suspended: true });
  assert.deepEqual(zeilen, ["[contract-end] Aufraeumen fehlgeschlagen tenant=t_e: nur-text"]);
});

function kuendigungsLauf(zeitraumEnde) {
  const gesetzt = [];
  const store = {
    ...geldSpeicher(),
    tenantSubscription: () => ({ subscriptionId: "sub_k" }),
    setTenantSubscription: (tenant, patch) => gesetzt.push([tenant, patch]),
  };
  const { audits, deps } = einsatz(store);
  const object = {
    id: "sub_k",
    status: "active",
    cancel_at_period_end: true,
    metadata: { tenant_ref: "t_k" },
  };
  if (zeitraumEnde != null) object.current_period_end = zeitraumEnde;
  return applyStripeWebhook({ id: "evt_k", type: SUBSCRIPTION_EVENT.UPDATED, data: { object } }, deps).then((ergebnis) => ({
    audits,
    gesetzt,
    ergebnis,
  }));
}

test("Kuendigung zum Periodenende: Audit nennt das Periodenende", async () => {
  const { audits, gesetzt, ergebnis } = await kuendigungsLauf(1893456000);
  assert.deepEqual(ergebnis, { cancelScheduled: true });
  assert.deepEqual(audits, [["stripe_webhook_cancel_scheduled", "tenant=t_k current_period_end=1893456000"]]);
  assert.equal(gesetzt[0][1].currentPeriodEnd, 1893456000);
});

test("Kuendigung zum Periodenende ohne Periodenende: Audit nennt unknown", async () => {
  const { audits, ergebnis } = await kuendigungsLauf(null);
  assert.deepEqual(ergebnis, { cancelScheduled: true });
  assert.deepEqual(audits, [["stripe_webhook_cancel_scheduled", "tenant=t_k current_period_end=unknown"]]);
});

test("Vertragsende ohne eigenen Audit-Speicher: Aufraeumen laeuft durch und WorkOS-Loeschung gilt als erledigt", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const abgelegt = [];
  const speicher = {
    ...endeSpeicher(null),
    tenantIdpSubject: () => "user_e",
    setContractEndCleanupPending: (tenant, offen) => {
      abgelegt.push([tenant, offen]);
      return Promise.resolve();
    },
  };
  const { deps } = einsatz(speicher);
  const geloescht = [];
  const ergebnis = await applyStripeWebhook(
    { id: "evt_w", type: SUBSCRIPTION_EVENT.DELETED, data: { object: { id: "sub_e", metadata: { tenant_ref: "t_e" } } } },
    {
      ...deps,
      accounts: { setStatus: () => Promise.resolve() },
      sessions: { invalidateByTenant: () => Promise.resolve() },
      workos: { deleteUser: (subject) => Promise.resolve(geloescht.push(subject)) },
    },
  );
  assert.deepEqual(ergebnis, { suspended: true });
  assert.deepEqual(geloescht, ["user_e"]);
  assert.deepEqual(abgelegt, [["t_e", { numberReleasePending: true, workosDeletePending: false }]]);
});
