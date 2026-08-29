// E5-01 (Review-Blocker Runde 3): sipRegistrar auf dem PRODUKTIONSAUFRUFER-Pfad. Bis hierher
// injizierte KEIN Produktionsaufrufer (web-login.js, contract-end-cleanup.js) den Registrar -
// nur test/absender-registrierung-freigabe.test.js injizierte ihn SELBST direkt in
// releaseTenantNumbersOnErase, ein Mechanismus-Beleg fuer einen Weg, den die Produktion nicht
// ging. Dieser Test faehrt stattdessen ueber attemptContractEndCleanup - den EINEN
// Produktions-Einstiegspunkt, den sowohl scheduleContractEndCleanup (wireWebLogin) als auch
// billing/webhook.js (SUSPEND-Zweig) rufen - und prueft zusaetzlich die neue gemeinsame
// Konstruktions-Naht sipRegistrarWennAktiv (nummern-registrierung.js). Reine In-Process-Units,
// kein Netz, kein Spawn (F.I.R.S.T.) - Muster test/312k-p4-contract-end-cleanup.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { attemptContractEndCleanup } from "../src/billing/contract-end-cleanup.js";
import { sipRegistrarWennAktiv } from "../src/elevenlabs/nummern-registrierung.js";
import { NUMBER_STATUS, PROVIDER } from "../src/store/defaults.js";
import { fakeProvisioner } from "./helpers.js";

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

function fakeSipRegistrar(overrides = {}) {
  const removeCalls = [];
  return {
    removeCalls,
    async removeRegistration(phoneNumberId) {
      removeCalls.push(phoneNumberId);
      if (overrides.removeRegistration) return overrides.removeRegistration(phoneNumberId);
      return { accepted: true, status: 200 };
    },
  };
}

// ---- attemptContractEndCleanup: sipRegistrar wird durchgereicht ---------------------

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

// Positiv-Kontrolle: ohne injizierten sipRegistrar (Bestand vor diesem Fix, bzw. Schalter
// aus) laeuft die Freigabe unveraendert durch, 0 EL-Aufrufe.
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

// ---- sipRegistrarWennAktiv: die gemeinsame Konstruktions-Naht ------------------------

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
