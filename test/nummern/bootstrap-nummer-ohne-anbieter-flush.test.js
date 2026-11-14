import assert from "node:assert/strict";
import { test } from "node:test";

import { makePgTestStore } from "../pg-helpers.js";
import { derivePlatformNumberBindings } from "../../src/boot.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { BOOTSTRAP_NUMBER_HOLD_PURPOSE } from "../../src/begriffe/bootstrap-halt.js";
import { DEFAULT_PROVIDER } from "../../src/begriffe/nummern-vergabe.js";

const BOOTSTRAP_NUMMER = "+15005550006";

test("Bootstrap-Nummer ohne Anbieter: Halt-Bindung nimmt den Standardanbieter und der Postgres-Flush bleibt grün", async () => {
  const { store } = await makePgTestStore();
  const zustand = store.load();
  zustand.tenants.push({ id: BOOTSTRAP_TENANT_ID, status: "active", firstName: "Betreiber", ownerName: "Betreiber Halt" });
  zustand.numbers.push({
    id: "num_ohne_anbieter",
    e164: BOOTSTRAP_NUMMER,
    tenantId: BOOTSTRAP_TENANT_ID,
    status: "active",
    providerNumberId: "ext_ohne_anbieter",
  });
  zustand.numberAssignments.push({
    id: "a_ohne_anbieter",
    numberId: "num_ohne_anbieter",
    tenantId: BOOTSTRAP_TENANT_ID,
    assignedAt: "x",
    releasedAt: null,
  });
  derivePlatformNumberBindings({ config: { provisioning: { platformAniE164: "" } }, store });
  await store.drainFlushes();
  const halt = zustand.platformNumberUse.find(
    (bindung) => bindung.purpose === BOOTSTRAP_NUMBER_HOLD_PURPOSE && bindung.releasedAt === null,
  );
  assert.equal(halt.provider, DEFAULT_PROVIDER);
});
