import { test } from "node:test";
import assert from "node:assert/strict";
import { handleProvisionJob } from "../../src/worker/provisioning.js";
import { fakeProvisioner, fakeBilling } from "../helpers.js";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  findNumber,
  setTenantStripe,
} from "../../src/store/state-ops.js";
import { NUMBER_STATUS } from "../../src/begriffe/nummern.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
const OPTIONEN = {
  countryCode: "US",
  connectionId: "conn_9",
  holdAmountCents: 500,
  currency: "eur",
};

function seedRequested() {
  const s = makeDefaultState();
  registerTenant(s, "t_user1");
  setTenantStripe(s, "t_user1", {
    customerId: "cus_1",
    paymentMethodId: "pm_1",
    paymentMethodType: "card",
  });
  const { number } = requestNumber(s, { tenantId: "t_user1", ...CAPS });
  return { s, numberId: number.id };
}

test("Nummernkauf-Auftrag: Landescode, Anschluss und Haltebetrag kommen mit den Abhaengigkeiten in einem dritten Argument", async () => {
  const { s, numberId } = seedRequested();
  const provisioner = fakeProvisioner();
  const billing = fakeBilling();

  const ergebnis = await handleProvisionJob(
    s,
    { payload: { numberId } },
    { provisioner, billing, opts: OPTIONEN },
  );

  assert.equal(handleProvisionJob.length, 3);
  assert.equal(ergebnis.number.status, NUMBER_STATUS.ACTIVE);
  assert.equal(findNumber(s, numberId).e164, "+12025550101");
  assert.deepEqual(provisioner.log.slice(0, 1), ["search:US"]);
  assert.equal(provisioner.orderCalls[0].connectionId, "conn_9");
  const [aufruf, halt] = billing.log[0];
  assert.equal(aufruf, "placeHold");
  assert.equal(halt.amountCents, 500);
});

test("Nummernkauf-Auftrag: nicht angeforderte Nummer wird uebersprungen, ohne Anbieteraufruf", async () => {
  const { s, numberId } = seedRequested();
  const provisioner = fakeProvisioner();
  await handleProvisionJob(s, { payload: { numberId } }, { provisioner, opts: OPTIONEN });
  provisioner.log.length = 0;

  const aktiv = await handleProvisionJob(
    s,
    { payload: { numberId } },
    { provisioner, opts: OPTIONEN },
  );
  const unbekannt = await handleProvisionJob(
    s,
    { payload: { numberId: "num_gibt_es_nicht" } },
    { provisioner, opts: OPTIONEN },
  );

  assert.deepEqual(aktiv, { skipped: true, status: NUMBER_STATUS.ACTIVE });
  assert.deepEqual(unbekannt, { skipped: true, status: null });
  assert.deepEqual(provisioner.log, []);
});
