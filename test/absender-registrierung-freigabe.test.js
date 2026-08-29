// OUTBOUND-E5 (F3): das ZURUECKGEBEN einer EL-Nummernregistrierung bei der DID-Freigabe
// (release-reconcile.js#performNumberRelease, ueber releaseTenantNumbersOnErase). Reine
// In-Process-Unit mit Fake-Store/-Provisioner/-Audit/-Registrar (Muster
// test/tenant-erasure-number-release.test.js) - kein Spawn, kein pglite, kein Netz.
import { test } from "node:test";
import assert from "node:assert/strict";
import { releaseTenantNumbersOnErase } from "../src/release-reconcile.js";
import { NUMBER_STATUS, PROVIDER } from "../src/store/defaults.js";
import { fakeProvisioner } from "./helpers.js";

const fakeAudit = () => ({
  records: [],
  record(entry) {
    this.records.push(entry);
    return Promise.resolve();
  },
});
const fakeLogger = () => ({ log: () => {}, warn: () => {} });
// Fake-Store ueber der Facade-Kontraktflaeche { load, save, withStoreLock } - EINE
// mutable Referenz, so wirken Mutationen ueber alle load()-Aufrufe hinweg.
const fakeStore = (state) => ({ load: () => state, save: () => {}, withStoreLock: (fn) => fn() });

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

const seed = (over = {}) => ({
  tenants: [{ id: "t1" }],
  numbers: [
    {
      id: "n1",
      tenantId: "t1",
      status: NUMBER_STATUS.ACTIVE,
      provider: PROVIDER.TELNYX,
      providerNumberId: "ext_1",
      e164: "+493012345",
      providerAgentPhoneNumberId: "phnum_freigabe_test",
    },
  ],
  numberAssignments: [{ id: "a1", numberId: "n1", tenantId: "t1", assignedAt: "x", releasedAt: null }],
  calls: [],
  platformNumberUse: [],
  ...over,
});

// F1: Freigabe einer DID mit Registrierung -> genau EIN Loeschversuch, Nummer released,
// Feld auf der Nummer geleert.
test("F1: Freigabe mit Registrierung -> genau EIN Loeschversuch, Nummer released, Feld geleert", async () => {
  const state = seed();
  const sipRegistrar = fakeSipRegistrar();
  const result = await releaseTenantNumbersOnErase({
    store: fakeStore(state),
    provisioner: fakeProvisioner(),
    audit: fakeAudit(),
    logger: fakeLogger(),
    sipRegistrar,
    tenantId: "t1",
  });
  assert.equal(result.released, 1);
  assert.equal(result.aborted, 0);
  assert.deepEqual(sipRegistrar.removeCalls, ["phnum_freigabe_test"], "genau EIN Loeschversuch, mit der richtigen Kennung");
  assert.equal(state.numbers[0].status, NUMBER_STATUS.RELEASED);
  assert.equal(state.numbers[0].providerAgentPhoneNumberId, null, "Kennung geleert - keine Zeile zeigt auf eine geloeschte Registrierung");
});

// F2: der EL-Loeschversuch schlaegt fehl -> die Freigabe laeuft TROTZDEM durch (kein
// neuer Abbruchgrund, keine zusaetzliche Audit-Zeile - der Anbieter-DELETE ist strikt
// fail-soft).
test("F2: EL-Loeschversuch schlaegt fehl -> Freigabe laeuft trotzdem durch, keine zusaetzliche Audit-Zeile", async () => {
  const state = seed();
  const audit = fakeAudit();
  const sipRegistrar = fakeSipRegistrar({
    removeRegistration: async () => ({ accepted: false, status: 500 }),
  });
  const result = await releaseTenantNumbersOnErase({
    store: fakeStore(state),
    provisioner: fakeProvisioner(),
    audit,
    logger: fakeLogger(),
    sipRegistrar,
    tenantId: "t1",
  });
  assert.equal(result.released, 1, "die Freigabe zaehlt trotz EL-Fehlschlag als released");
  assert.equal(result.aborted, 0, "kein neuer Abbruchgrund");
  assert.equal(state.numbers[0].status, NUMBER_STATUS.RELEASED);
  assert.equal(audit.records.length, 1, "GENAU die eine Audit-Zeile der Freigabe selbst - keine zweite fuer den EL-Fehlschlag");
});

// F3: der E1-Riegel geht vor - eine plattform-gebundene Nummer wird NIE erreicht, also
// auch KEIN EL-Loeschversuch und KEIN Telnyx-Provider-DELETE.
test("F3: E1-Riegel (plattform-gebunden) -> HOLD, 0 EL-Loeschversuche, 0 Telnyx-Releases", async () => {
  const state = seed({
    platformNumberUse: [
      {
        id: "pnu_1",
        e164: "+493012345",
        purpose: "ani_override",
        provider: PROVIDER.TELNYX,
        tenantId: null,
        providerNumberId: null,
        boundAt: "x",
        releasedAt: null,
        note: null,
      },
    ],
  });
  const sipRegistrar = fakeSipRegistrar();
  const prov = fakeProvisioner();
  const result = await releaseTenantNumbersOnErase({
    store: fakeStore(state),
    provisioner: prov,
    audit: fakeAudit(),
    logger: fakeLogger(),
    sipRegistrar,
    tenantId: "t1",
  });
  assert.equal(result.released, 0);
  assert.equal(result.aborted, 1, "HOLD zaehlt als abgebrochen");
  assert.equal(sipRegistrar.removeCalls.length, 0, "0 EL-Loeschversuche - der Riegel greift VOR jedem Anbieter-Kontakt");
  assert.ok(!prov.log.some((zeile) => zeile.startsWith("release")), "0 Telnyx-Releases");
  assert.equal(state.numbers[0].status, NUMBER_STATUS.ACTIVE, "die Nummer bleibt aktiv");
});

// F4: Positiv-Kontrolle - eine ungebundene Nummer OHNE Registrierung wird wie im Bestand
// freigegeben, 0 EL-Aufrufe (kein sipRegistrar.removeRegistration-Aufruf, weil das Feld
// am Datensatz fehlt).
test("F4: Positiv-Kontrolle - ungebundene Nummer ohne Registrierung -> Freigabe wie im Bestand, 0 EL-Aufrufe", async () => {
  const state = seed({
    numbers: [
      {
        id: "n1",
        tenantId: "t1",
        status: NUMBER_STATUS.ACTIVE,
        provider: PROVIDER.TELNYX,
        providerNumberId: "ext_1",
        e164: "+493012345",
        // KEIN providerAgentPhoneNumberId - Muster Bestands-DID vor dieser Etappe.
      },
    ],
  });
  const sipRegistrar = fakeSipRegistrar();
  const result = await releaseTenantNumbersOnErase({
    store: fakeStore(state),
    provisioner: fakeProvisioner(),
    audit: fakeAudit(),
    logger: fakeLogger(),
    sipRegistrar,
    tenantId: "t1",
  });
  assert.equal(result.released, 1);
  assert.equal(sipRegistrar.removeCalls.length, 0, "kein Loeschversuch ohne Kennung");
  assert.equal(state.numbers[0].status, NUMBER_STATUS.RELEASED);
});

// Positiv-Kontrolle zu F1/F4: derselbe Ablauf OHNE injizierten sipRegistrar (Schalter aus,
// wie in Produktion vor dem Owner-Cutover) bleibt byte-identisch zum Bestand.
test("Positiv-Kontrolle: sipRegistrar NICHT injiziert -> Freigabe byte-identisch zum Bestand", async () => {
  const state = seed();
  const result = await releaseTenantNumbersOnErase({
    store: fakeStore(state),
    provisioner: fakeProvisioner(),
    audit: fakeAudit(),
    logger: fakeLogger(),
    tenantId: "t1",
  });
  assert.equal(result.released, 1);
  assert.equal(state.numbers[0].status, NUMBER_STATUS.RELEASED);
});
