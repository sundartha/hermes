import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore } from "../pg-helpers.js";
import { runNummerntausch } from "../../src/worker/nummerntausch.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const TENANT = "t_ohne_registrierer";
const ALT_E164 = "+4915799990003";
const NEU_ENDUNG = "0200";
const GROSSE_DECKE = 50;
const NUMMER_AKTIV = "active";
const NUMMER_FREIGEGEBEN = "released";

function konfiguration() {
  return withConfigNamespaces({
    provisioningEnabled: true,
    maxNumbers: GROSSE_DECKE,
    maxNumbersPerTenant: 1,
    platformAniE164: "",
    paymentEnabled: true,
  });
}

function attrappe() {
  const spur = { suchen: [], bestellungen: [], freigaben: [] };
  return {
    spur,
    async searchNumbers({ countryCode }) {
      spur.suchen.push(countryCode);
      return [{ e164: `+1202555${NEU_ENDUNG}` }];
    },
    async orderNumber({ e164, idempotencyKey }) {
      spur.bestellungen.push(idempotencyKey);
      return { e164, providerNumberId: `pnum_${spur.bestellungen.length}` };
    },
    async releaseNumber(providerNumberId) {
      spur.freigaben.push(providerNumberId);
    },
  };
}

function registrierer() {
  return {
    async ensureRegistration({ numberId }) {
      return { phoneNumberId: `phnum_${numberId}`, angelegt: true };
    },
    async removeRegistration() {},
  };
}

function auditSenke() {
  const eintraege = [];
  return {
    eintraege,
    async record(eintrag) {
      eintraege.push(eintrag);
    },
  };
}

function logZeilen() {
  const zeilen = [];
  const logger = { log: (zeile) => zeilen.push(zeile), warn() {}, error() {} };
  return { logger, tausch: () => zeilen.filter((zeile) => zeile.startsWith("[nummerntausch]")) };
}

async function mandantMitAlterNummer() {
  const { store } = await makePgTestStore();
  const state = store.load();
  state.tenants.push({ id: TENANT, status: "active" });
  state.numbers.push({
    id: `num_${TENANT}`,
    tenantId: TENANT,
    e164: ALT_E164,
    provider: "telnyx",
    status: NUMMER_AKTIV,
    providerNumberId: `pnum_alt_${TENANT}`,
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  return { store, state };
}

async function start(store, { sipRegistrar, audit }) {
  const anbieter = attrappe();
  const protokoll = logZeilen();
  await runNummerntausch({
    store,
    config: konfiguration(),
    numberProvisioning: () => anbieter,
    sipRegistrar,
    inboundTrunkSchreiber: null,
    audit,
    logger: protokoll.logger,
  });
  return { anbieter, zeilen: protokoll.tausch() };
}

async function ersterStartMitRegistrierer(store) {
  const { anbieter } = await start(store, { sipRegistrar: registrierer() });
  assert.equal(anbieter.spur.bestellungen.length, 1, "der erste Start kauft und registriert den Ersatz");
}

test("Kriterium 1: registrierter Ersatz zaehlt ohne Registrierer als ersatz_aktiv, Anbieter bleibt unberuehrt", async () => {
  const { store, state } = await mandantMitAlterNummer();
  await ersterStartMitRegistrierer(store);

  const { anbieter, zeilen } = await start(store, { sipRegistrar: null });

  assert.equal(zeilen.length, 1);
  assert.match(zeilen[0], /ergebnis=ersatz_aktiv$/);
  assert.deepEqual(anbieter.spur, { suchen: [], bestellungen: [], freigaben: [] });
  assert.equal(state.numbers.find((nummer) => nummer.id === `num_${TENANT}`).status, NUMMER_AKTIV);
});

test("Kriterium 2: registrierter Ersatz ohne Registrierer, mit Audit-Senke -> alte Nummer wird freigegeben", async () => {
  const { store, state } = await mandantMitAlterNummer();
  await ersterStartMitRegistrierer(store);
  const audit = auditSenke();

  const { anbieter, zeilen } = await start(store, { sipRegistrar: null, audit });

  assert.deepEqual(anbieter.spur.freigaben, [`pnum_alt_${TENANT}`]);
  assert.equal(state.numbers.find((nummer) => nummer.id === `num_${TENANT}`).status, NUMMER_FREIGEGEBEN);
  const ersatz = state.numbers.filter((nummer) => nummer.id !== `num_${TENANT}`);
  assert.equal(ersatz.length, 1);
  assert.equal(ersatz[0].status, NUMMER_AKTIV);
  assert.deepEqual(
    audit.eintraege.map((eintrag) => [eintrag.tenantId, eintrag.action]),
    [[TENANT, "did_released"]],
  );
  assert.equal(zeilen.length, 1);
  assert.match(zeilen[0], /ergebnis=getauscht$/);
});
