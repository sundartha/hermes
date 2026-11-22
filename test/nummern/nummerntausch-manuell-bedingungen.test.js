import { test } from "node:test";
import assert from "node:assert/strict";

const { withConfigNamespaces } = await import("../config-namespaces-helper.js");
const { makePgTestStore } = await import("../pg-helpers.js");
const { runNummerntausch } = await import("../../src/worker/nummerntausch.js");

const TENANT = "t_tausch_manuell";
const ALT = `num_${TENANT}`;
const NEU = "+12025550188";
const LOGZEILE = /ergebnis=(\S+)$/;

function anbieter() {
  const spur = { bestellungen: 0 };
  return {
    spur,
    async searchNumbers() {
      return [{ e164: NEU }];
    },
    async orderNumber() {
      spur.bestellungen += 1;
      throw new Error("Telnyx lehnt ab");
    },
    async releaseNumber() {},
  };
}

async function lauf(store, telnyx) {
  const zeilen = [];
  const logger = { log: (zeile) => zeilen.push(zeile), warn() {}, error() {} };
  await runNummerntausch({
    store,
    config: withConfigNamespaces({ provisioningEnabled: true, maxNumbers: 50, maxNumbersPerTenant: 1, paymentEnabled: true }),
    numberProvisioning: () => telnyx,
    sipRegistrar: { ensureRegistration: async ({ numberId }) => ({ phoneNumberId: `phnum_${numberId}`, angelegt: true }) },
    inboundTrunkSchreiber: null,
    logger,
  });
  return zeilen.filter((zeile) => zeile.startsWith("[nummerntausch]")).map((zeile) => zeile.match(LOGZEILE)[1]);
}

async function nachErstemFehlschlag() {
  const { store } = await makePgTestStore();
  const state = store.load();
  state.tenants.push({ id: TENANT, status: "active" });
  state.numbers.push({
    id: ALT,
    tenantId: TENANT,
    e164: "+4915799990088",
    provider: "telnyx",
    status: "active",
    providerNumberId: "pnum_alt",
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  const telnyx = anbieter();
  await lauf(store, telnyx);
  const ersatz = state.numbers.find((nummer) => nummer.id !== ALT);
  return { store, state, telnyx, ersatz };
}

test("Ersatznummer ist im Zustand released -> manuell, kein neuer Kauf, bleibt released", async () => {
  const { store, telnyx, ersatz } = await nachErstemFehlschlag();
  ersatz.status = "released";

  const ergebnisse = await lauf(store, telnyx);

  assert.deepEqual(ergebnisse, ["manuell"]);
  assert.equal(telnyx.spur.bestellungen, 1);
  assert.equal(ersatz.status, "released");
});

test("Spur ohne Ersatznummer im Bestand -> manuell statt Absturz", async () => {
  const { speicherBereiche } = await import("../../src/store.js");
  const { store, state, ersatz } = await nachErstemFehlschlag();
  state.numbers.splice(state.numbers.indexOf(ersatz), 1);

  const anspruch = await speicherBereiche(store).nummern.ersatzNummerAnfordern({ oldNumberId: ALT, maxNumbers: 50 });

  assert.deepEqual(anspruch, { ok: false, grund: "manuell" });
});

test("Ersatznummer requested und nicht released -> wird erneut gekauft", async () => {
  const { store, telnyx } = await nachErstemFehlschlag();

  await lauf(store, telnyx);

  assert.equal(telnyx.spur.bestellungen, 2);
});

const { starteNummerntausch } = await import("../../src/worker/nummerntausch.js");

function konfiguration() {
  return withConfigNamespaces({ provisioningEnabled: true, maxNumbers: 50, maxNumbersPerTenant: 1, paymentEnabled: true });
}

async function protokollierterLauf({ store, telnyx, sipRegistrar, config = konfiguration() }) {
  const log = [];
  const fehler = [];
  await runNummerntausch({
    store,
    config,
    numberProvisioning: () => telnyx,
    sipRegistrar,
    inboundTrunkSchreiber: null,
    logger: { log: (zeile) => log.push(zeile), warn() {}, error: (zeile) => fehler.push(zeile) },
  });
  return { log, fehler };
}

test("Scheitert der Kauf, steht der Grund des Anbieters im Fehlerprotokoll und die Kandidatenzahl im Bestandsprotokoll", async () => {
  const { store } = await makePgTestStore();
  const state = store.load();
  state.tenants.push({ id: TENANT, status: "active" });
  state.numbers.push({
    id: ALT,
    tenantId: TENANT,
    e164: "+4915799990088",
    provider: "telnyx",
    status: "active",
    providerNumberId: "pnum_alt",
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });

  const { log, fehler } = await protokollierterLauf({ store, telnyx: anbieter() });

  assert.ok(log.includes("[kundennummern] aktive_ausserhalb_plus1=1"));
  assert.equal(fehler.length, 1);
  assert.match(fehler[0], /^\[nummerntausch\] Kauf fehlgeschlagen number=\S+: Telnyx lehnt ab$/);
});

test("Scheitert die Registrierung der Ersatznummer, steht der Grund im Fehlerprotokoll", async () => {
  const { store, state, telnyx } = await nachErstemFehlschlag();
  state.numbers.find((nummer) => nummer.id !== ALT).status = "released";
  const ersatz = state.numbers.find((nummer) => nummer.id !== ALT);
  ersatz.status = "requested";
  const bestellt = { e164: NEU, providerNumberId: "pnum_neu" };
  telnyx.orderNumber = async () => bestellt;
  const sipRegistrar = {
    ensureRegistration: async () => {
      throw new Error("Registrierer abgelehnt");
    },
  };

  const { fehler } = await protokollierterLauf({ store, telnyx, sipRegistrar });

  assert.ok(fehler.some((zeile) => /Registrierung fehlgeschlagen number=\S+: Registrierer abgelehnt$/.test(zeile)));
});

test("Bricht der Tausch einer Nummer ab, steht der Grund mit der Mandanten-Kennung im Fehlerprotokoll", async () => {
  const { store } = await nachErstemFehlschlag();
  const config = {
    ...konfiguration(),
    provisioning: {
      get provisioningEnabled() {
        throw new Error("Sperre kaputt");
      },
    },
  };

  const { fehler } = await protokollierterLauf({ store, telnyx: anbieter(), config, sipRegistrar: null });

  assert.deepEqual(fehler, [`[nummerntausch] Fehler tenant=${TENANT}: Sperre kaputt`]);
});

test("Bricht der Gesamtlauf ab, steht der Grund im Fehlerprotokoll", async () => {
  const { store } = await nachErstemFehlschlag();
  store.load = () => {
    throw new Error("Speicher kaputt");
  };
  const fehler = [];

  await starteNummerntausch({
    store,
    config: withConfigNamespaces({ provisioningEnabled: true, maxNumbers: 50, maxNumbersPerTenant: 1 }),
    numberProvisioning: () => anbieter(),
    sipRegistrar: null,
    inboundTrunkSchreiber: null,
    logger: { log() {}, warn() {}, error: (zeile) => fehler.push(zeile) },
  });

  assert.deepEqual(fehler, ["[nummerntausch] Lauf abgebrochen: Speicher kaputt"]);
});

test("Fehlt der Registrierer, bleibt die Registrierung der Ersatznummer ohne Fehlerprotokoll offen", async () => {
  const { store, state, telnyx } = await nachErstemFehlschlag();
  const ersatz = state.numbers.find((nummer) => nummer.id !== ALT);
  ersatz.status = "requested";
  telnyx.orderNumber = async () => ({ e164: NEU, providerNumberId: "pnum_neu" });

  const { log, fehler } = await protokollierterLauf({ store, telnyx, sipRegistrar: null });

  assert.deepEqual(fehler, []);
  assert.ok(log.some((zeile) => /^\[nummerntausch\] .*ergebnis=registrierung_fehlgeschlagen$/.test(zeile)));
});
