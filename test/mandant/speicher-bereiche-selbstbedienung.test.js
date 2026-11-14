import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";

import { speicherBereiche } from "../../src/store.js";
import { makeSelfServiceRoutes } from "../../src/self-service-routes.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { makePgTestStore } from "../pg-helpers.js";

const NOW_MS = Date.parse("2026-11-14T08:00:00.000Z");
const OFFEN_MS = 60_000;

function zustand() {
  return {
    tenants: [
      { id: "t_a", defaultLanguage: "fr", country: "FR", ownerName: "" },
      { id: "t_b", ownerName: "Vorhanden Schon" },
    ],
    numbers: [{ tenantId: "t_a", status: "active", language: "es" }],
    settings: {},
    calls: [],
  };
}

function speicherMit(state) {
  const speicherungen = [];
  const speicher = {
    load: () => state,
    save: () => speicherungen.push("save"),
  };
  return { speicher, speicherungen };
}

test("mandant: tenantLanguage liefert die Sprache aus dem Zustand als Promise", async () => {
  const state = zustand();
  const { speicher } = speicherMit(state);
  const bereiche = speicherBereiche(speicher);
  const antwort = bereiche.mandant.tenantLanguage("t_a");
  assert.ok(antwort instanceof Promise);
  assert.equal(await antwort, "es");
  state.settings.t_a = { language: "it" };
  assert.equal(await bereiche.mandant.tenantLanguage("t_a"), "it");
  assert.equal(await bereiche.mandant.tenantLanguage("t_b"), "de");
});

test("mandant: tenantGeo liefert Land und Sprache des Mandanten, ohne Mandanten null", async () => {
  const { speicher } = speicherMit(zustand());
  const bereiche = speicherBereiche(speicher);
  const antwort = bereiche.mandant.tenantGeo("t_a");
  assert.ok(antwort instanceof Promise);
  assert.deepEqual(await antwort, { country: "FR", defaultLanguage: "fr" });
  assert.deepEqual(await bereiche.mandant.tenantGeo("t_x"), { country: null, defaultLanguage: null });
});

async function pgAufbau() {
  const { store } = await makePgTestStore();
  const state = store.load();
  state.tenants.push({ id: "t_a", status: "active", ownerName: "" });
  state.tenants.push({ id: "t_b", status: "active", ownerName: "Vorhanden Schon" });
  const speicherungen = [];
  const echtesSave = store.save;
  store.save = (...args) => {
    speicherungen.push("save");
    return echtesSave.apply(store, args);
  };
  return { store, state, speicherungen, bereiche: speicherBereiche(store) };
}

function mandantVon(state, id) {
  return state.tenants.find((tenant) => tenant.id === id);
}

test("mandant: identitaetSetzen traegt den Namen ein und speichert nur bei Aenderung", async () => {
  const { state, speicherungen, bereiche } = await pgAufbau();
  const antwort = bereiche.mandant.identitaetSetzen("t_a", { firstName: "Ada", lastName: "Lovelace" });
  assert.ok(antwort instanceof Promise);
  await antwort;
  assert.equal(mandantVon(state, "t_a").ownerName, "Ada Lovelace");
  assert.deepEqual(speicherungen, ["save"]);
  await bereiche.mandant.identitaetSetzen("t_a", { firstName: "Neu", lastName: "Name" });
  await bereiche.mandant.identitaetSetzen("t_b", { firstName: "Neu", lastName: "Name" });
  assert.equal(mandantVon(state, "t_a").ownerName, "Ada Lovelace");
  assert.equal(mandantVon(state, "t_b").ownerName, "Vorhanden Schon");
  assert.deepEqual(speicherungen, ["save"]);
});

test("mandant: identitaetSetzen wartet auf die Speichersperre, bevor es schreibt", async () => {
  const { store, state, bereiche } = await pgAufbau();
  let freigeben;
  const gehalten = new Promise((aufloesen) => {
    freigeben = aufloesen;
  });
  const sperre = store.withStoreLock(() => gehalten);
  const antwort = bereiche.mandant.identitaetSetzen("t_a", { firstName: "Ada", lastName: "Lovelace" });
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  assert.equal(mandantVon(state, "t_a").ownerName, "");
  freigeben();
  await sperre;
  await antwort;
  assert.equal(mandantVon(state, "t_a").ownerName, "Ada Lovelace");
});

function anrufMit(consults) {
  return { id: "c_1", status: "active", answeredAt: "2026-11-14T07:00:00.000Z", consults };
}

test("rueckfrage: verwaisteSchliessen laesst offene Rueckfragen verfallen und speichert genau einmal", async () => {
  const state = zustand();
  state.calls.push(
    anrufMit([
      { id: "q_1", status: "open", askedAt: "2026-11-14T07:30:00.000Z" },
      { id: "q_2", status: "answered", askedAt: "2026-11-14T07:31:00.000Z" },
      { id: "q_3", status: "open", askedAt: "2026-11-14T07:59:50.000Z" },
    ]),
  );
  const { speicher, speicherungen } = speicherMit(state);
  const antwort = speicherBereiche(speicher).rueckfrage.verwaisteSchliessen("c_1", {
    nowMs: NOW_MS,
    openMs: OFFEN_MS,
  });
  assert.ok(antwort instanceof Promise);
  await antwort;
  const [anruf] = state.calls;
  assert.deepEqual(
    anruf.consults.map((consult) => consult.status),
    ["expired", "answered", "expired"],
  );
  assert.deepEqual(
    anruf.consults.map((consult) => consult.orphanedAt !== undefined),
    [false, false, true],
  );
  assert.deepEqual(speicherungen, ["save"]);
});

test("rueckfrage: verwaisteSchliessen speichert nicht, wenn nichts offen ist oder der Anruf fehlt", async () => {
  const state = zustand();
  state.calls.push(anrufMit([{ id: "q_2", status: "answered", askedAt: "2026-11-14T07:31:00.000Z" }]));
  const { speicher, speicherungen } = speicherMit(state);
  const bereiche = speicherBereiche(speicher);
  await bereiche.rueckfrage.verwaisteSchliessen("c_1", { nowMs: NOW_MS, openMs: OFFEN_MS });
  await bereiche.rueckfrage.verwaisteSchliessen("c_fehlt", { nowMs: NOW_MS, openMs: OFFEN_MS });
  assert.deepEqual(speicherungen, []);
});

async function mitSelbstbedienung({ store, zahlung }, lauf) {
  const mw = (_req, _res, next) => next();
  const router = makeSelfServiceRoutes({
    store,
    webAuthMw: mw,
    webAuthPendingMw: mw,
    audit: () => {},
    config: withConfigNamespaces({
      paymentEnabled: zahlung,
      paymentCurrency: "eur",
      numberSetupFeeCents: 300,
    }),
    billing: {},
    accounts: null,
  });
  const app = express();
  app.request.tenant = { tenantId: "t_a", sub: "sub_a", status: "active" };
  app.use(router);
  const server = await new Promise((aufloesen) => {
    const s = app.listen(0, "127.0.0.1", () => aufloesen(s));
  });
  try {
    await lauf(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((aufloesen) => server.close(aufloesen));
  }
}

function routenSpeicher(state, ueberschreibung = {}) {
  return {
    load: () => state,
    tenantStripe: () => ({ customerId: "cus_1", paymentMethodId: "pm_1" }),
    tenantSubscription: () => ({ planSlug: "business" }),
    ...ueberschreibung,
  };
}

test("billing/status: die Nummern-Einrichtungsgebuehr kommt mit Zahlung aus der Konfiguration, ohne Zahlung ist sie 0", async () => {
  const gebuehr = async (zahlung) => {
    let koerper = null;
    await mitSelbstbedienung({ store: routenSpeicher(zustand()), zahlung }, async (basis) => {
      koerper = await (await abrufMitFrist(`${basis}/api/self-service/billing/status`)).json();
    });
    return koerper.numberSetupFeeCents;
  };
  assert.equal(await gebuehr(true), 300);
  assert.equal(await gebuehr(false), 0);
});

test("newsletter/confirm und unsubscribe: die Seite traegt die Sprache des Mandanten aus dem Speicher", async () => {
  const state = zustand();
  state.tenants[0].defaultLanguage = "en";
  state.numbers = [];
  const store = routenSpeicher(state, {
    confirmNewsletterRecipientByToken: () => ({ tenantId: "t_a", email: "a@example.com" }),
    unsubscribeNewsletterRecipientByToken: () => ({ tenantId: "t_a", email: "a@example.com" }),
  });
  await mitSelbstbedienung({ store, zahlung: false }, async (basis) => {
    for (const pfad of ["/newsletter/confirm?token=abc", "/newsletter/unsubscribe?token=abc"]) {
      const antwort = await abrufMitFrist(`${basis}${pfad}`);
      assert.equal(antwort.status, 200, pfad);
      assert.match(await antwort.text(), /<html lang="en">/, pfad);
    }
  });
});
