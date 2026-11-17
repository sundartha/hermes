import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore } from "../pg-helpers.js";
import { runNummerntausch } from "../../src/worker/nummerntausch.js";
import { NummerGekauftIdOffen } from "../../src/telephony/provisioning-geo.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";

const TENANT = "t_tausch_id_offen";
const GEKAUFT = "+12025550177";
const LOGZEILE = /ergebnis=(\S+)$/;

function anbieter(bestellung) {
  const spur = { bestellungen: [] };
  return {
    spur,
    async searchNumbers() {
      return [{ e164: GEKAUFT }];
    },
    async orderNumber({ e164, idempotencyKey }) {
      spur.bestellungen.push(idempotencyKey);
      return bestellung(spur.bestellungen.length, e164);
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

async function mitAlterNummer() {
  const { store } = await makePgTestStore();
  const state = store.load();
  state.tenants.push({ id: TENANT, status: "active" });
  state.numbers.push({
    id: `num_${TENANT}`,
    tenantId: TENANT,
    e164: "+4915799990077",
    provider: "telnyx",
    status: "active",
    providerNumberId: "pnum_alt",
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  return { store, state };
}

const ersatz = (state) => state.numbers.find((nummer) => nummer.id !== `num_${TENANT}`);

test("Kriterium 1: gekauft, ID offen -> naechster Tausch-Lauf kauft nicht erneut, Ergebnis manuell, Nummer bleibt provisioning", async () => {
  const { store, state } = await mitAlterNummer();
  const telnyx = anbieter((_anzahl, e164) => {
    throw new NummerGekauftIdOffen(e164, new Error("Zeitueberschreitung"));
  });
  await lauf(store, telnyx);
  assert.equal(ersatz(state).status, "provisioning");
  assert.equal(ersatz(state).e164, GEKAUFT);

  const ergebnisse = await lauf(store, telnyx);

  assert.deepEqual(ergebnisse, ["manuell"]);
  assert.equal(telnyx.spur.bestellungen.length, 1);
  assert.equal(ersatz(state).status, "provisioning");
});

test("Kriterium 2: provisioning ohne bestaetigten Kauf wird auf requested zurueckgesetzt und neu gekauft", async () => {
  const { store, state } = await mitAlterNummer();
  const telnyx = anbieter((anzahl, e164) => {
    if (anzahl === 1) throw new Error("Telnyx lehnt ab");
    return { e164, providerNumberId: "pnum_2" };
  });
  await lauf(store, telnyx);
  ersatz(state).status = "provisioning";

  const ergebnisse = await lauf(store, telnyx);

  assert.deepEqual(ergebnisse, ["ersatz_aktiv"]);
  assert.equal(telnyx.spur.bestellungen.length, 2);
  assert.equal(ersatz(state).status, "active");
});

test("Kriterium 2: Ersatz im Zustand failed mit gemerkter Nummer wird weiter neu gekauft", async () => {
  const { store, state } = await mitAlterNummer();
  const telnyx = anbieter((anzahl, e164) => {
    if (anzahl === 1) throw new Error("Telnyx lehnt ab");
    return { e164, providerNumberId: "pnum_2" };
  });
  await lauf(store, telnyx);
  Object.assign(ersatz(state), { status: "failed", e164: GEKAUFT });

  const ergebnisse = await lauf(store, telnyx);

  assert.deepEqual(ergebnisse, ["ersatz_aktiv"]);
  assert.equal(telnyx.spur.bestellungen.length, 2);
});
