import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../../src/store.js";
import express from "express";
import { makeSelfServiceRoutes } from "../../src/self-service-routes.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const KUENDIGUNG = [
  ["cancellationMailPending", ["t_a"], { pending: true, receivedAt: "x" }],
  ["setCancellationMailPending", ["t_a", { pending: false }], { id: "t_a" }],
  ["tenantsPendingCancellationMail", [], [{ id: "t_a" }]],
  ["setTenantSubscription", ["t_a", { cancelAtPeriodEnd: true }], { id: "t_a" }],
];

function attrappe(tabelle) {
  const aufrufe = [];
  const speicher = {};
  for (const [name, , ergebnis] of tabelle) {
    speicher[name] = (...args) => {
      aufrufe.push([name, ...args]);
      return ergebnis;
    };
  }
  return { speicher, aufrufe };
}

test("kuendigung: jede Bereichsfunktion liefert ein Promise mit Argumenten und Ergebnis der Speicherfunktion", async () => {
  const { speicher, aufrufe } = attrappe(KUENDIGUNG);
  const funktionen = speicherBereiche(speicher).kuendigung;
  assert.deepEqual(Object.keys(funktionen), KUENDIGUNG.map(([name]) => name));
  for (const [name, args, ergebnis] of KUENDIGUNG) {
    const antwort = funktionen[name](...args);
    assert.ok(antwort instanceof Promise, name);
    assert.deepEqual(await antwort, ergebnis, name);
  }
  assert.deepEqual(aufrufe, KUENDIGUNG.map(([name, args]) => [name, ...args]));
});

test("kuendigung: Speicherfunktionen werden erst beim Aufruf gelesen und ein Wurf wird zur Ablehnung", async () => {
  const { speicher } = attrappe(KUENDIGUNG);
  const funktionen = speicherBereiche(speicher).kuendigung;
  speicher.cancellationMailPending = () => "spaet";
  assert.equal(await funktionen.cancellationMailPending("t_a"), "spaet");
  speicher.cancellationMailPending = () => {
    throw new Error("kaputt");
  };
  await assert.rejects(funktionen.cancellationMailPending("t_a"), /kaputt/);
});

function asynchronerSpeicher(anfang) {
  const aufrufe = [];
  let abo = anfang;
  const antwort = (name, wert) => async (...args) => {
    aufrufe.push([name, ...args]);
    return wert;
  };
  return {
    aufrufe,
    cancellationMailPending: antwort("cancellationMailPending", { pending: true, receivedAt: "2026-08-12T10:15:00.000Z" }),
    setCancellationMailPending: antwort("setCancellationMailPending", null),
    tenantSubscription: async (...args) => {
      aufrufe.push(["tenantSubscription", ...args]);
      return abo;
    },
    setTenantSubscription: async (...args) => {
      aufrufe.push(["setTenantSubscription", ...args]);
      abo = { ...abo, ...args[1] };
    },
  };
}

const ABO = { planSlug: "starter", currentPeriodEnd: 1896134400, cancelAtPeriodEnd: false, subscriptionId: "sub_1" };
const NEUES_ENDE = 1900000000;

async function mitSelbstbedienung({ store, mailer = null }, lauf) {
  const mails = [];
  const anbieter = [];
  const billing = {
    scheduleCancellation: async (auftrag) => {
      anbieter.push(["schedule", auftrag.subscriptionId]);
      return { cancelAtPeriodEnd: true, currentPeriodEnd: NEUES_ENDE };
    },
    unscheduleCancellation: async (auftrag) => {
      anbieter.push(["unschedule", auftrag.subscriptionId]);
      return { cancelAtPeriodEnd: false, currentPeriodEnd: NEUES_ENDE };
    },
  };
  const mw = (_req, _res, next) => next();
  const router = makeSelfServiceRoutes({
    store,
    webAuthMw: mw,
    webAuthPendingMw: mw,
    audit: () => {},
    config: withConfigNamespaces({ paymentEnabled: true, publicUrl: "https://sundartha.example" }),
    billing,
    accounts: { accountByTenant: async () => ({ email: "kunde@example.test" }) },
    auditStore: { record: async () => {} },
    mailer: mailer ?? { sendMail: async (mail) => void mails.push(mail) },
  });
  const app = express();
  app.request.tenant = { tenantId: "t_a", sub: "sub_a", status: "active" };
  app.use(express.json());
  app.use(router);
  const server = await new Promise((r) => {
    const s = app.listen(0, "127.0.0.1", () => r(s));
  });
  try {
    await lauf({ base: `http://127.0.0.1:${server.address().port}`, mails, anbieter });
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test("Kuendigung: Abo und Mailvermerk werden ueber den Bereich gelesen, Anbieter-Ergebnis und Quittung ueber den Bereich geschrieben", async () => {
  const store = asynchronerSpeicher(ABO);
  await mitSelbstbedienung({ store }, async (app) => {
    const antwort = await abrufMitFrist(`${app.base}/api/self-service/billing/cancel`, { method: "POST" });
    assert.equal(antwort.status, 200);
    assert.deepEqual(await antwort.json(), { cancelAtPeriodEnd: true, currentPeriodEnd: NEUES_ENDE });
    assert.deepEqual(app.anbieter, [["schedule", "sub_1"]]);
    assert.equal(app.mails.length, 1);
    assert.equal(app.mails[0].to, "kunde@example.test");
  });
  assert.deepEqual(store.aufrufe.map(([name]) => name), [
    "tenantSubscription",
    "setTenantSubscription",
    "setCancellationMailPending",
    "cancellationMailPending",
    "tenantSubscription",
    "setCancellationMailPending",
  ]);
  assert.deepEqual(store.aufrufe[1], ["setTenantSubscription", "t_a", { cancelAtPeriodEnd: true, currentPeriodEnd: NEUES_ENDE }]);
  assert.deepEqual(store.aufrufe[5], ["setCancellationMailPending", "t_a", { pending: false }]);
});

test("Kuendigung: ist nichts mehr zu bestaetigen, geht keine Mail hinaus und nichts wird quittiert", async () => {
  const store = asynchronerSpeicher(ABO);
  store.cancellationMailPending = async () => ({ pending: false, receivedAt: null });
  await mitSelbstbedienung({ store }, async (app) => {
    const antwort = await abrufMitFrist(`${app.base}/api/self-service/billing/cancel`, { method: "POST" });
    assert.equal(antwort.status, 200);
    assert.deepEqual(app.mails, []);
  });
  assert.deepEqual(store.aufrufe.map(([name]) => name), [
    "tenantSubscription",
    "setTenantSubscription",
    "setCancellationMailPending",
  ]);
});

test("Kuendigung: ein Abo, das schon zum Periodenende gekuendigt ist, ruft den Anbieter nicht und schreibt nichts", async () => {
  const store = asynchronerSpeicher({ ...ABO, cancelAtPeriodEnd: true });
  await mitSelbstbedienung({ store }, async (app) => {
    const antwort = await abrufMitFrist(`${app.base}/api/self-service/billing/cancel`, { method: "POST" });
    assert.equal(antwort.status, 200);
    assert.deepEqual(await antwort.json(), { cancelAtPeriodEnd: true, currentPeriodEnd: ABO.currentPeriodEnd });
    assert.deepEqual(app.anbieter, []);
  });
  assert.deepEqual(store.aufrufe, [["tenantSubscription", "t_a"]]);
});

test("Fortsetzen: das Abo wird ueber den Bereich gelesen und die Rueknahme ueber den Bereich geschrieben", async () => {
  const store = asynchronerSpeicher({ ...ABO, cancelAtPeriodEnd: true });
  await mitSelbstbedienung({ store }, async (app) => {
    const antwort = await abrufMitFrist(`${app.base}/api/self-service/billing/resume`, { method: "POST" });
    assert.equal(antwort.status, 200);
    assert.deepEqual(app.anbieter, [["unschedule", "sub_1"]]);
  });
  assert.deepEqual(store.aufrufe, [
    ["tenantSubscription", "t_a"],
    ["setTenantSubscription", "t_a", { cancelAtPeriodEnd: false, currentPeriodEnd: NEUES_ENDE }],
  ]);
});
