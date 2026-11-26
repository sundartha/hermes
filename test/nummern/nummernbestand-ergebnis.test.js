import assert from "node:assert/strict";
import { test } from "node:test";

import express from "express";

import { makeOnboardRoutes } from "../../src/routes/api-onboard.js";
import { speicherBereiche } from "../../src/store.js";
import { makeDefaultState, registerTenant, requestNumber } from "../../src/store/state-ops.js";
import { runNummerntausch } from "../../src/worker/nummerntausch.ts";
import { mitRoutenServer, postJson } from "../anrufe/routen-server.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { operatorAuthPassThrough } from "../operator-route-app.js";
import { makePgTestStore } from "../pg-helpers.js";

const MANDANT = "t_nummernbestand";
const ALT = "num_bestand_alt";
const NEU = "+12025550188";
const WEIT = 50;

function anfragen(tenantId, [maxNumbers, maxNumbersPerTenant]) {
  const zustand = makeDefaultState();
  registerTenant(zustand, MANDANT);
  const ergebnis = requestNumber(zustand, { tenantId, maxNumbers, maxNumbersPerTenant });
  return { zustand, ergebnis };
}

test("nummernbestand: eine angenommene Anfrage liefert ok mit der angelegten Nummer als Wert", () => {
  const { zustand, ergebnis } = anfragen(MANDANT, [5, 1]);

  assert.equal(zustand.numbers.length, 1);
  assert.deepEqual(ergebnis, { ok: true, wert: { number: zustand.numbers[0] } });
});

function pruefeAbsage(tenantId, decken, { grund, vermerk }) {
  const { zustand, ergebnis } = anfragen(tenantId, decken);

  assert.deepEqual(ergebnis, { ok: false, fehler: grund });
  assert.equal(zustand.tenants.find((mandant) => mandant.id === tenantId)?.numberProvisionSkipReason, vermerk);
}

test("nummernbestand: ein unbekannter Mandant liefert den Fehler tenant_inactive", () => {
  pruefeAbsage("t_unbekannt", [5, 1], { grund: "tenant_inactive", vermerk: undefined });
});

test("nummernbestand: an der Plattformdecke liefert die Anfrage global_cap mit Vermerk", () => {
  pruefeAbsage(MANDANT, [0, 1], { grund: "global_cap", vermerk: "global_cap" });
});

test("nummernbestand: an der Mandantendecke liefert die Anfrage tenant_cap ohne Vermerk", () => {
  pruefeAbsage(MANDANT, [5, 0], { grund: "tenant_cap", vermerk: undefined });
});

async function tauschbestand() {
  const { store } = await makePgTestStore();
  const zustand = store.load();
  zustand.tenants.push({ id: MANDANT, status: "active" });
  zustand.numbers.push({
    id: ALT,
    tenantId: MANDANT,
    e164: "+4915799990088",
    provider: "telnyx",
    status: "active",
    providerNumberId: "pnum_alt",
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  const anspruch = (maxNumbers = WEIT) =>
    speicherBereiche(store).nummern.ersatzNummerAnfordern({ oldNumberId: ALT, maxNumbers });
  const ersatz = () => zustand.numbers.find((nummer) => nummer.id !== ALT);
  return { store, anspruch, ersatz };
}

test("ersatzanspruch: ein neuer und ein offener Ersatz liefern ok mit Kaufauftrag", async () => {
  const { anspruch, ersatz } = await tauschbestand();

  const neu = await anspruch();
  const offen = await anspruch();

  assert.deepEqual(neu, { ok: true, wert: { number: ersatz(), purchase: true } });
  assert.deepEqual(offen, { ok: true, wert: { number: ersatz(), purchase: true } });
});

test("ersatzanspruch: ein aktiver Ersatz liefert ok ohne Kaufauftrag", async () => {
  const { anspruch, ersatz } = await tauschbestand();
  await anspruch();
  ersatz().status = "active";

  assert.deepEqual(await anspruch(), { ok: true, wert: { number: ersatz(), purchase: false } });
});

test("ersatzanspruch: gespeichert wird nur ein Anspruch mit Kaufauftrag", async (t) => {
  const { store, anspruch, ersatz } = await tauschbestand();
  const gespeichert = t.mock.method(store, "save");

  await anspruch();
  assert.equal(gespeichert.mock.callCount(), 1);
  await anspruch();
  assert.equal(gespeichert.mock.callCount(), 2);
  ersatz().status = "active";
  await anspruch();
  assert.equal(gespeichert.mock.callCount(), 2);
});

test("ersatzanspruch: eine volle Plattform liefert beim ersten und beim wiederholten Anspruch plattformdecke", async () => {
  const { anspruch } = await tauschbestand();

  assert.deepEqual(await anspruch(1), { ok: false, fehler: "plattformdecke" });
  await anspruch();
  assert.deepEqual(await anspruch(1), { ok: false, fehler: "plattformdecke" });
});

test("ersatzanspruch: ein freigegebener Ersatz liefert den Fehler manuell", async () => {
  const { anspruch, ersatz } = await tauschbestand();
  await anspruch();
  ersatz().status = "released";

  assert.deepEqual(await anspruch(), { ok: false, fehler: "manuell" });
});

async function tauschlauf(store, maxNumbers) {
  const zeilen = [];
  let bestellungen = 0;
  await runNummerntausch({
    store,
    config: withConfigNamespaces({ provisioningEnabled: true, maxNumbers, maxNumbersPerTenant: 1, paymentEnabled: true }),
    numberProvisioning: () => ({
      searchNumbers: async () => [{ e164: NEU }],
      orderNumber: async () => {
        bestellungen += 1;
        throw new Error("Anbieter lehnt ab");
      },
      releaseNumber: async () => {},
    }),
    sipRegistrar: null,
    inboundTrunkSchreiber: null,
    logger: { log: (zeile) => zeilen.push(zeile), warn() {}, error() {} },
  });
  return { bestellungen, zeile: zeilen.find((eintrag) => eintrag.startsWith("[nummerntausch]")) };
}

test("nummerntausch: an der Plattformdecke steht plattformdecke im Protokoll und nichts wird bestellt", async () => {
  const { store } = await tauschbestand();

  assert.deepEqual(await tauschlauf(store, 1), {
    bestellungen: 0,
    zeile: `[nummerntausch] tenant=${MANDANT} alt=…0088 neu=- ergebnis=plattformdecke`,
  });
});

test("nummerntausch: ein bereits aktiver Ersatz wird nicht erneut bestellt", async () => {
  const { store, anspruch, ersatz } = await tauschbestand();
  await anspruch();
  Object.assign(ersatz(), { status: "active", e164: NEU, providerAgentPhoneNumberId: "phnum_ersatz" });

  assert.deepEqual(await tauschlauf(store, WEIT), {
    bestellungen: 0,
    zeile: `[nummerntausch] tenant=${MANDANT} alt=…0088 neu=…0188 ergebnis=ersatz_aktiv`,
  });
});

async function aufnehmen(t, { maxNumbers = 5, maxNumbersPerTenant = 1, speichern } = {}) {
  t.mock.method(console, "error", () => {});
  const { store } = await makePgTestStore();
  const gespeichert = t.mock.method(store, "save", speichern ?? store.save);
  const pruefprotokoll = [];
  const router = express.Router();
  router.use(
    makeOnboardRoutes({
      store,
      config: withConfigNamespaces({
        maxNumbers,
        maxNumbersPerTenant,
        provisioningEnabled: false,
        provisioningCountry: "DE",
        forceNumberCountry: "",
        geoEnabled: false,
        defaultTenantBudgetCents: 0,
      }),
      audit: (aktion, _anfrage, detail) => pruefprotokoll.push([aktion, detail]),
      provisioning: {},
      operatorAuth: operatorAuthPassThrough(),
    }),
  );
  const { status, text } = await mitRoutenServer(router, async (basis) => {
    const antwort = await postJson(`${basis}/api/onboard`, { tenantId: MANDANT });
    return { status: antwort.status, text: await antwort.text() };
  });
  return { status, text, speicherungen: gespeichert.mock.callCount(), zustand: store.load(), pruefprotokoll };
}

test("aufnahme: eine angenommene Anfrage antwortet unveraendert und wird gespeichert", async (t) => {
  const { status, text, speicherungen, zustand } = await aufnehmen(t);

  const numberId = zustand.numbers[0]?.id;
  assert.equal(status, 200);
  assert.equal(
    text,
    JSON.stringify({ tenantId: MANDANT, numberId, status: "requested", country: "DE", language: "de", provisioning: "disabled" }),
  );
  assert.equal(speicherungen, 1);
});

async function pruefeAblehnung(t, decken, { status, grund, speicherungen }) {
  const antwort = await aufnehmen(t, decken);

  assert.equal(antwort.status, status);
  assert.equal(antwort.text, JSON.stringify({ error: `Nummer-Anfrage abgelehnt (${grund})` }));
  assert.equal(antwort.speicherungen, speicherungen);
  assert.deepEqual(antwort.pruefprotokoll, [["onboard_denied", `tenant=${MANDANT} grund=${grund}`]]);
}

test("aufnahme: an der Plattformdecke bleibt die 429-Antwort gleich und der Vermerk wird gespeichert", async (t) => {
  await pruefeAblehnung(t, { maxNumbers: 0 }, { status: 429, grund: "global_cap", speicherungen: 1 });
});

test("aufnahme: an der Mandantendecke bleibt die 409-Antwort gleich und nichts wird gespeichert", async (t) => {
  await pruefeAblehnung(t, { maxNumbersPerTenant: 0 }, { status: 409, grund: "tenant_cap", speicherungen: 0 });
});

test("aufnahme: scheitert die Speicherung, bleibt die 503-Antwort gleich", async (t) => {
  const { status, text, pruefprotokoll } = await aufnehmen(t, {
    speichern: () => {
      throw new Error("Platte voll");
    },
  });

  assert.equal(status, 503);
  assert.equal(text, JSON.stringify({ error: "Persistenz fehlgeschlagen" }));
  assert.deepEqual(pruefprotokoll, []);
});
