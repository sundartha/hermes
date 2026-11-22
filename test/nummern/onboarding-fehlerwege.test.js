import assert from "node:assert/strict";
import { test } from "node:test";

import { handleProvisionJob } from "../../src/worker/provisioning.js";
import { NummerGekauftIdOffen } from "../../src/begriffe/nummern-vergabe.js";
import { NUMBER_STATUS } from "../../src/begriffe/nummern.js";
import { fakeBilling, fakeProvisioner } from "../helpers.js";
import { makePgTestStore } from "../pg-helpers.js";

const ARGS = { countryCode: "US", connectionId: "conn_1", holdAmountCents: 500, currency: "eur" };
const KUNDE = "cus_fehlerwege";
const ZAHLUNGSMITTEL = "pm_fehlerwege";
const GEKAUFT = "+12025550188";
const NUMMER = "num_fehlerwege";

async function mitNummer(mandant = {}) {
  const { store } = await makePgTestStore();
  const state = store.load();
  state.tenants.push({ id: "t_user1", status: "active", ...mandant });
  state.numbers.push({
    id: NUMMER,
    e164: null,
    tenantId: "t_user1",
    provider: "telnyx",
    country: "DE",
    language: "de",
    status: "requested",
    providerNumberId: null,
    paymentIntentId: null,
  });
  return state;
}

const MIT_KARTE = {
  stripeCustomerId: KUNDE,
  stripePaymentMethodId: ZAHLUNGSMITTEL,
  stripePaymentMethodType: "card",
};

const nummer = (state) => state.numbers.find((eintrag) => eintrag.id === NUMMER);

async function angelegt(abo = {}) {
  return { state: await mitNummer({ ...MIT_KARTE, ...abo }), numberId: NUMMER };
}

function protokoll() {
  const zeilen = { log: [], warn: [] };
  return { zeilen, logger: { log: (zeile) => zeilen.log.push(zeile), warn: (zeile) => zeilen.warn.push(zeile) } };
}

function auftrag(numberId) {
  return { payload: { numberId } };
}

test("Registrierung wirft einen Text: Warnung nennt den Text, die Nummer bleibt aktiv", async () => {
  const { state, numberId } = await angelegt();
  const { zeilen, logger } = protokoll();
  const sipRegistrar = {
    async ensureRegistration() {
      throw "registrierung-text-fehler";
    },
  };

  await handleProvisionJob(state, auftrag(numberId), { provisioner: fakeProvisioner(), logger, sipRegistrar, opts: ARGS });

  assert.equal(nummer(state).status, NUMBER_STATUS.ACTIVE);
  assert.equal(
    zeilen.warn.some((zeile) =>
      zeile.includes(`[el-registrierung] FEHLGESCHLAGEN number=${numberId}: registrierung-text-fehler - DID bleibt nutzbar`),
    ),
    true,
  );
});

test("Registrierung wirft einen Error: Warnung nennt dessen Meldung", async () => {
  const { state, numberId } = await angelegt();
  const { zeilen, logger } = protokoll();
  const sipRegistrar = {
    async ensureRegistration() {
      throw new Error("registrierung-meldung");
    },
  };

  await handleProvisionJob(state, auftrag(numberId), { provisioner: fakeProvisioner(), logger, sipRegistrar, opts: ARGS });

  assert.equal(zeilen.warn.length, 1);
  assert.match(zeilen.warn[0], new RegExp(`number=${numberId}: registrierung-meldung - DID`));
});

test("Registrierung gelingt neu angelegt: Log nennt angelegt=true", async () => {
  const { state, numberId } = await angelegt();
  const { zeilen, logger } = protokoll();
  const sipRegistrar = { ensureRegistration: async () => ({ phoneNumberId: "phnum_a", angelegt: true }) };

  await handleProvisionJob(state, auftrag(numberId), { provisioner: fakeProvisioner(), logger, sipRegistrar, opts: ARGS });

  assert.deepEqual(zeilen.log, [`[el-registrierung] number=${numberId} angelegt=true`]);
  assert.equal(nummer(state).providerAgentPhoneNumberId, "phnum_a");
});

test("Registrierung gelingt schon vorhanden: Log nennt angelegt=false", async () => {
  const { state, numberId } = await angelegt();
  const { zeilen, logger } = protokoll();
  const sipRegistrar = { ensureRegistration: async () => ({ phoneNumberId: "phnum_b", angelegt: false }) };

  await handleProvisionJob(state, auftrag(numberId), { provisioner: fakeProvisioner(), logger, sipRegistrar, opts: ARGS });

  assert.deepEqual(zeilen.log, [`[el-registrierung] number=${numberId} angelegt=false`]);
});

test("Freigabe nach gescheitertem Einzug wirft einen Text: Warnung nennt Nummer, Anbieter-ID und Text", async () => {
  const { state, numberId } = await angelegt();
  const { zeilen, logger } = protokoll();
  const provisioner = fakeProvisioner({
    async releaseNumber() {
      throw "freigabe-text-fehler";
    },
  });
  const billing = fakeBilling({
    async captureHold() {
      throw new Error("Einzug gescheitert");
    },
  });

  await assert.rejects(
    handleProvisionJob(state, auftrag(numberId), { provisioner, billing, logger, opts: ARGS }),
    /Einzug gescheitert/,
  );

  assert.equal(
    zeilen.warn.some((zeile) =>
      zeile.includes(`(number=${numberId} provider=num_ext_1): freigabe-text-fehler`),
    ),
    true,
  );
  assert.equal(nummer(state).status, NUMBER_STATUS.FAILED);
});

test("Freigabe nach gescheitertem Einzug wirft einen Error: Warnung nennt dessen Meldung, Hold wird freigegeben", async () => {
  const { state, numberId } = await angelegt();
  const { zeilen, logger } = protokoll();
  const provisioner = fakeProvisioner({
    async releaseNumber() {
      throw new Error("freigabe-meldung");
    },
  });
  const billing = fakeBilling({
    async captureHold() {
      throw new Error("Einzug gescheitert");
    },
  });

  await assert.rejects(
    handleProvisionJob(state, auftrag(numberId), { provisioner, billing, logger, opts: ARGS }),
    /Einzug gescheitert/,
  );

  assert.equal(zeilen.warn.length, 1);
  assert.match(zeilen.warn[0], /Orphan, Reconcile noetig \(number=\S+ provider=num_ext_1\): freigabe-meldung$/);
  assert.deepEqual(billing.log.at(-1), ["cancelHold", "pi_fake_1"]);
});

test("Kauf gekauft, ID offen: Warnung nennt Nummer, E164 und Ursache, die Nummer behält die E164 und bleibt in Bereitstellung", async () => {
  const { state, numberId } = await angelegt();
  const { zeilen, logger } = protokoll();
  const provisioner = fakeProvisioner({
    async orderNumber() {
      throw new NummerGekauftIdOffen(GEKAUFT, new Error("Bestellung ohne Nummern-ID"));
    },
  });
  const billing = fakeBilling();

  await assert.rejects(
    handleProvisionJob(state, auftrag(numberId), { provisioner, billing, logger, opts: ARGS }),
    NummerGekauftIdOffen,
  );

  assert.deepEqual(zeilen.warn, [
    `[nummer-gekauft-id-offen] number=${numberId} e164=${GEKAUFT}: Telnyx orderNumber: Nummer gekauft, Nummern-ID offen (Bestellung ohne Nummern-ID) - Hold bleibt, manuelle Klaerung`,
  ]);
  assert.equal(nummer(state).e164, GEKAUFT);
  assert.equal(nummer(state).status, NUMBER_STATUS.PROVISIONING);
  assert.equal(
    billing.log.some((eintrag) => eintrag[0] === "cancelHold"),
    false,
  );
});

test("Einzugs-Hold nutzt Kunde und Zahlungsmittel des Mandanten", async () => {
  const { state, numberId } = await angelegt();
  const billing = fakeBilling();

  await handleProvisionJob(state, auftrag(numberId), { provisioner: fakeProvisioner(), billing, opts: ARGS });

  const [name, hold] = billing.log[0];
  assert.equal(name, "placeHold");
  assert.equal(hold.customerId, KUNDE);
  assert.equal(hold.paymentMethodId, ZAHLUNGSMITTEL);
  assert.equal(hold.tenantRef, "t_user1");
  assert.equal(hold.idempotencyKey, `hold_${numberId}`);
  assert.deepEqual(billing.log.at(-1), ["captureHold", "pi_fake_1", 500]);
});

test("Mandant ohne Einrichtungsgebühr: der Hold wird freigegeben statt eingezogen", async () => {
  const { state, numberId } = await angelegt({ stripeNumberSetupFeeExempt: true });
  const billing = fakeBilling();

  await handleProvisionJob(state, auftrag(numberId), { provisioner: fakeProvisioner(), billing, opts: ARGS });

  assert.deepEqual(
    billing.log.map((eintrag) => eintrag[0]),
    ["placeHold", "cancelHold"],
  );
});

test("Mandant ohne Zahlungsmittel: Kauf bricht ab, Nummer scheitert, kein Anbieteraufruf", async () => {
  const state = await mitNummer();
  const provisioner = fakeProvisioner();
  const billing = fakeBilling();

  await assert.rejects(
    handleProvisionJob(state, auftrag(NUMMER), { provisioner, billing, opts: ARGS }),
    /kein hinterlegtes Zahlungsmittel/,
  );

  assert.deepEqual(provisioner.log, []);
  assert.deepEqual(billing.log, []);
  assert.equal(nummer(state).status, NUMBER_STATUS.FAILED);
});

test("Kauf ohne Abrechnung braucht kein Zahlungsmittel: Nummer wird aktiv", async () => {
  const state = await mitNummer();

  await handleProvisionJob(state, auftrag(NUMMER), { provisioner: fakeProvisioner(), opts: ARGS });

  assert.equal(nummer(state).status, NUMBER_STATUS.ACTIVE);
});
