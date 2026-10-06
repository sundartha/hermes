import test from "node:test";
import assert from "node:assert/strict";
import { attemptContractEndCleanup } from "../src/billing/contract-end-cleanup.js";
import { sipRegistrarWennAktiv } from "../src/elevenlabs/nummern-registrierung.js";
import { NUMBER_STATUS, PROVIDER } from "../src/store/defaults.js";
import { fakeProvisioner, fakeSipRegistrar } from "./helpers.js";

const TENANT = "t_e5_01";

const fakeAudit = () => ({
  records: [],
  record(entry) {
    this.records.push(entry);
    return Promise.resolve();
  },
});
const fakeLogger = () => ({ log: () => {}, warn: () => {} });

function seedState(over = {}) {
  return {
    tenants: [{ id: TENANT }],
    numbers: [
      {
        id: "n1",
        tenantId: TENANT,
        status: NUMBER_STATUS.ACTIVE,
        provider: PROVIDER.TELNYX,
        providerNumberId: "ext_1",
        e164: "+493099999",
        providerAgentPhoneNumberId: "phnum_e5_01",
      },
    ],
    numberAssignments: [{ id: "a1", numberId: "n1", tenantId: TENANT, assignedAt: "x", releasedAt: null }],
    calls: [],
    platformNumberUse: [],
    ...over,
  };
}

function fakeStore(state) {
  const findTenant = (tenantId) => state.tenants.find((tenant) => tenant.id === tenantId);
  return {
    load: () => state,
    save: () => {},
    withStoreLock: (fn) => fn(),
    tenantIdpSubject: () => null,
    setContractEndCleanupPending: (tenantId, patch) => {
      const tenant = findTenant(tenantId);
      if (tenant) Object.assign(tenant, patch);
      return tenant ?? null;
    },
    tenantsPendingContractEndCleanup: () =>
      state.tenants.filter((tenant) => tenant.numberReleasePending || tenant.workosDeletePending),
  };
}

test("E5-01: attemptContractEndCleanup reicht sipRegistrar an die Freigabe durch - genau EIN Loeschversuch mit der richtigen Kennung", async () => {
  const state = seedState();
  const sipRegistrar = fakeSipRegistrar();

  const result = await attemptContractEndCleanup({
    store: fakeStore(state),
    numberProvisioner: fakeProvisioner(),
    workos: null,
    auditStore: fakeAudit(),
    logger: fakeLogger(),
    tenantId: TENANT,
    sipRegistrar,
  });

  assert.equal(result.numberReleasePending, false);
  assert.equal(state.numbers[0].status, NUMBER_STATUS.RELEASED);
  assert.deepEqual(
    sipRegistrar.removeCalls,
    ["phnum_e5_01"],
    "der Produktionsaufrufer gibt die EL-Registrierung ueber denselben Release-Kern zurueck",
  );
});

test("E5-01 Positiv-Kontrolle: attemptContractEndCleanup OHNE sipRegistrar -> Freigabe byte-identisch zum Bestand, 0 EL-Aufrufe", async () => {
  const state = seedState();

  const result = await attemptContractEndCleanup({
    store: fakeStore(state),
    numberProvisioner: fakeProvisioner(),
    workos: null,
    auditStore: fakeAudit(),
    logger: fakeLogger(),
    tenantId: TENANT,
  });

  assert.equal(result.numberReleasePending, false);
  assert.equal(state.numbers[0].status, NUMBER_STATUS.RELEASED, "Freigabe laeuft unveraendert - der EL-Schritt ist rein additiv");
});

const BASE_CONFIG = {
  provisioning: { provisioningEnabled: true },
  voice: { elevenLabsOutbound: { enabled: true, numberRegistrationEnabled: true, apiKey: "k", agentId: "a" } },
  telephony: { telnyxSipTrunkUsername: "u", telnyxSipTrunkPassword: "p" },
};

test("sipRegistrarWennAktiv: Dreifach-Gate AN -> liefert einen Registrar (ensureRegistration/removeRegistration)", () => {
  const registrar = sipRegistrarWennAktiv(BASE_CONFIG);
  assert.ok(registrar, "Registrar wurde konstruiert");
  assert.equal(typeof registrar.ensureRegistration, "function");
  assert.equal(typeof registrar.removeRegistration, "function");
});

test("sipRegistrarWennAktiv: PROVISIONING_ENABLED aus -> undefined (kein Registrar)", () => {
  const cfg = { ...BASE_CONFIG, provisioning: { provisioningEnabled: false } };
  assert.equal(sipRegistrarWennAktiv(cfg), undefined);
});

test("sipRegistrarWennAktiv: elevenLabsOutbound.enabled aus -> undefined (kein Registrar)", () => {
  const cfg = { ...BASE_CONFIG, voice: { elevenLabsOutbound: { ...BASE_CONFIG.voice.elevenLabsOutbound, enabled: false } } };
  assert.equal(sipRegistrarWennAktiv(cfg), undefined);
});

test("sipRegistrarWennAktiv: numberRegistrationEnabled aus (Default) -> undefined (kein Registrar)", () => {
  const cfg = {
    ...BASE_CONFIG,
    voice: { elevenLabsOutbound: { ...BASE_CONFIG.voice.elevenLabsOutbound, numberRegistrationEnabled: false } },
  };
  assert.equal(sipRegistrarWennAktiv(cfg), undefined);
});
