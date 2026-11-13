import assert from "node:assert/strict";
import { test } from "node:test";

import { speicherBereiche } from "../src/store.js";
import { makeSelfServiceRoutes } from "../src/self-service-routes.js";
import { abrufMitFrist } from "./gemeinsam/antwortfrist.mjs";
import { startRouterApp } from "./operator-route-app.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";

const MANDANT = [
  ["tenantContext", ["t_a"], { ownerName: "Anna" }],
  ["exportTenantData", ["t_a"], { calls: [] }],
  ["tenantPrivateNumber", ["t_a"], "+4915112345678"],
  ["setPrivateNumber", ["t_a", "+4915112345678"], undefined],
  ["tenantStripe", ["t_a"], { customerId: "cus_1" }],
  ["setTenantStripe", ["t_a", { customerId: "cus_2" }], undefined],
  ["tenantSubscription", ["t_a"], { planSlug: "starter" }],
  ["setTenantSubscription", ["t_a", { subscriptionId: "sub_1" }], undefined],
  ["setCancellationMailPending", ["t_a", { pending: true }], undefined],
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

test("mandant: jede Bereichsfunktion liefert ein Promise mit Argumenten und Ergebnis der Speicherfunktion", async () => {
  const { speicher, aufrufe } = attrappe(MANDANT);
  const funktionen = speicherBereiche(speicher).mandant;
  assert.deepEqual(Object.keys(funktionen), MANDANT.map(([name]) => name));
  for (const [name, args, ergebnis] of MANDANT) {
    const antwort = funktionen[name](...args);
    assert.ok(antwort instanceof Promise, name);
    assert.deepEqual(await antwort, ergebnis, name);
  }
  assert.deepEqual(aufrufe, MANDANT.map(([name, args]) => [name, ...args]));
});

test("mandant: Speicherfunktionen werden erst beim Aufruf gelesen und ein Wurf wird zur Ablehnung", async () => {
  const { speicher } = attrappe(MANDANT);
  const funktionen = speicherBereiche(speicher).mandant;
  speicher.tenantStripe = () => "spaet";
  assert.equal(await funktionen.tenantStripe("t_a"), "spaet");
  speicher.tenantStripe = () => {
    throw new Error("kaputt");
  };
  await assert.rejects(funktionen.tenantStripe("t_a"), /kaputt/);
});

const NUMMER = "+4915112345678";

async function starteSelbstbedienung(store) {
  const audits = [];
  const mw = (req, _res, next) => {
    req.tenant = { tenantId: "t_a", sub: "sub_a", status: "active" };
    next();
  };
  const router = makeSelfServiceRoutes({
    store,
    webAuthMw: mw,
    webAuthPendingMw: mw,
    audit: (aktion, _req, detail) => audits.push([aktion, detail]),
    config: withConfigNamespaces({
      paymentEnabled: true,
      paymentCurrency: "eur",
      numberSetupFeeCents: 0,
    }),
    billing: {},
    accounts: null,
  });
  const app = await startRouterApp(router);
  return { ...app, audits };
}

function post(app, pfad, body) {
  return abrufMitFrist(`${app.base}${pfad}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function mitApp(store, lauf) {
  const app = await starteSelbstbedienung(store);
  try {
    await lauf(app);
  } finally {
    await app.close();
  }
}

test("private-number: Speichern meldet gesetzt, die Nummer geht unveraendert an den Speicher", async () => {
  const gesetzt = [];
  const store = {
    setPrivateNumber: (tenant, nummer) => gesetzt.push([tenant, nummer]),
    tenantPrivateNumber: () => NUMMER,
  };
  await mitApp(store, async (app) => {
    const antwort = await post(app, "/api/self-service/private-number", { privateNumber: NUMMER });
    assert.equal(antwort.status, 200);
    assert.deepEqual(await antwort.json(), { ok: true, hasPrivateNumber: true });
    assert.deepEqual(gesetzt, [["t_a", NUMMER]]);
    assert.deepEqual(app.audits, [["self_service_private_number", "outcome=set"]]);
  });
});

test("private-number: Loeschen meldet nicht gesetzt", async () => {
  const store = { setPrivateNumber: () => {}, tenantPrivateNumber: () => null };
  await mitApp(store, async (app) => {
    const antwort = await post(app, "/api/self-service/private-number", { privateNumber: "" });
    assert.deepEqual(await antwort.json(), { ok: true, hasPrivateNumber: false });
    assert.deepEqual(app.audits, [["self_service_private_number", "outcome=cleared"]]);
  });
});

test("private-number: abgelehnte Nummer ergibt 400 invalid_private_number", async () => {
  const store = {
    setPrivateNumber: () => {
      throw new Error("ungueltig");
    },
    tenantPrivateNumber: () => assert.fail("nach Ablehnung wird nicht gelesen"),
  };
  await mitApp(store, async (app) => {
    const antwort = await post(app, "/api/self-service/private-number", { privateNumber: "x" });
    assert.equal(antwort.status, 400);
    assert.deepEqual(await antwort.json(), { error: "invalid_private_number" });
    assert.deepEqual(app.audits, [["self_service_private_number", "outcome=rejected"]]);
  });
});

test("private-number: ein Wurf beim Lesen nach dem Speichern wird zum Serverfehler statt zum haengenden Aufruf", async () => {
  const store = {
    setPrivateNumber: () => {},
    tenantPrivateNumber: () => {
      throw new Error("lesen kaputt");
    },
  };
  await mitApp(store, async (app) => {
    const antwort = await post(app, "/api/self-service/private-number", { privateNumber: NUMMER });
    assert.equal(antwort.status, 500);
  });
});

function abrechnungsSpeicher(ueberschreibung = {}) {
  return {
    load: () => ({ tenants: [], numbers: [] }),
    tenantStripe: () => ({ customerId: "cus_1", paymentMethodId: "pm_1" }),
    tenantSubscription: () => ({ planSlug: "business" }),
    ...ueberschreibung,
  };
}

test("billing/status: Karte, Plan und Waehrung kommen aus den Mandanten-Bereichsfunktionen", async () => {
  await mitApp(abrechnungsSpeicher(), async (app) => {
    const antwort = await abrufMitFrist(`${app.base}/api/self-service/billing/status`);
    assert.equal(antwort.status, 200);
    const koerper = await antwort.json();
    assert.equal(koerper.hasCard, true);
    assert.equal(koerper.planSlug, "business");
    assert.equal(koerper.status, "active");
    assert.equal(koerper.paymentEnabled, true);
    assert.equal(koerper.currency, "eur");
  });
});

test("billing/status: ohne Karte und ohne Plan", async () => {
  const store = abrechnungsSpeicher({ tenantStripe: () => ({}), tenantSubscription: () => ({ planSlug: null }) });
  await mitApp(store, async (app) => {
    const koerper = await (await abrufMitFrist(`${app.base}/api/self-service/billing/status`)).json();
    assert.equal(koerper.hasCard, false);
    assert.equal(koerper.planSlug, null);
  });
});

test("billing/status: ein Wurf beim Lesen wird zum Serverfehler statt zum haengenden Aufruf", async () => {
  const store = abrechnungsSpeicher({
    tenantSubscription: () => {
      throw new Error("abo kaputt");
    },
  });
  await mitApp(store, async (app) => {
    const antwort = await abrufMitFrist(`${app.base}/api/self-service/billing/status`);
    assert.equal(antwort.status, 500);
  });
});
