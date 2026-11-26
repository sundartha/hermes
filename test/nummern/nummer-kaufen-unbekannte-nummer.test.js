import { test } from "node:test";
import assert from "node:assert/strict";
import { handleProvisionJob } from "../../src/worker/provisioning.ts";
import { NUMBER_STATUS } from "../../src/begriffe/nummern.ts";
import { NummerGekauftIdOffen } from "../../src/begriffe/nummern-vergabe.js";

const E164 = "+12025550101";

test("Nummernkauf: verschwindet die Nummer beim Kauf aus dem Zustand, meldet markNumberGekauft sie beim Namen", async () => {
  const zustand = {
    tenants: [{ id: "t_user1", status: "active" }],
    numbers: [
      {
        id: "num_1",
        e164: null,
        tenantId: "t_user1",
        provider: "telnyx",
        country: "US",
        status: NUMBER_STATUS.REQUESTED,
        providerNumberId: null,
        paymentIntentId: null,
      },
    ],
    numberAssignments: [],
  };
  const provisioner = {
    async searchNumbers() {
      return [{ e164: E164 }];
    },
    async orderNumber() {
      zustand.numbers.length = 0;
      throw new NummerGekauftIdOffen(E164, new Error("Bestellung ohne Nummern-ID"));
    },
  };
  const logger = { warn() {}, error() {}, info() {} };
  await assert.rejects(
    handleProvisionJob(zustand, { payload: { numberId: "num_1" } }, { provisioner, billing: null, logger, opts: { countryCode: "US", connectionId: "conn_1", holdAmountCents: 500, currency: "eur" } }),
    new Error("markNumberGekauft: Nummer num_1 nicht gefunden"),
  );
});
