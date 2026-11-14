import assert from "node:assert/strict";
import { test } from "node:test";

import { starteAnbieterServer } from "../gemeinsam/anbieter-attrappe.mjs";
import { starteBetterStackAttrappe } from "../gemeinsam/better-stack-attrappe.mjs";
import { echtWarten } from "../echt-warten.js";
import { fakeProvisioner, startServer } from "../helpers.js";
import { makePgTestStore } from "../pg-helpers.js";
import { derivePlatformNumberBindings } from "../../src/boot.js";
import { BOOTSTRAP_NUMBER_HOLD_PURPOSE } from "../../src/begriffe/bootstrap-halt.js";
import { NUMBER_STATUS } from "../../src/begriffe/nummern.js";
import { BOOTSTRAP_TENANT_ID } from "../../src/begriffe/mandant.js";
import { NUMBER_HOLD_REASON, PLATFORM_NUMBER_PURPOSE, PROVIDER } from "../../src/begriffe/nummern-vergabe.js";
import { releaseTenantNumbersOnErase } from "../../src/release-reconcile.js";
import { findNumber, makeDefaultState, unbindPlatformNumber } from "../../src/store/state-ops.js";

const BOOTSTRAP_NUMMER = "+15005550006";
const ANDERE_NUMMER = "+15005550007";
const SMS_ZIEL = "+15005550009";
const HTTP_OK = 200;
const EINMAL = 1;
const KEINE = 0;
const NACHLAUF_MS = 500;

const fakeLogger = () => ({ log: () => {}, warn: () => {} });

function speicherMitBootstrapNummer(e164) {
  const state = makeDefaultState();
  state.numbers.push({
    id: "boot_n",
    tenantId: BOOTSTRAP_TENANT_ID,
    e164,
    provider: PROVIDER.TELNYX,
    status: NUMBER_STATUS.ACTIVE,
    providerNumberId: "ext_boot",
  });
  return state;
}

function ableiten(state, store = { load: () => state, save: () => {} }) {
  return derivePlatformNumberBindings({ config: { provisioning: { platformAniE164: "" } }, store });
}

function offeneHalte(state) {
  return state.platformNumberUse.filter(
    (binding) => binding.purpose === BOOTSTRAP_NUMBER_HOLD_PURPOSE && binding.releasedAt === null,
  );
}

test("K1: Start mit leerem Speicher meldet die Heilung genau einmal an Better Stack, nicht per SMS", async (t) => {
  const vorfaelle = await starteBetterStackAttrappe();
  const sms = await starteAnbieterServer(({ req, vermerke, res }) => {
    vermerke({ pfad: req.url });
    res.writeHead(HTTP_OK, { "content-type": "application/json" }).end("{}");
  });
  t.after(() => Promise.all([vorfaelle.close(), sms.close()]));
  const srv = await startServer({
    ownerNumber: null,
    env: {
      BOOTSTRAP_E164: BOOTSTRAP_NUMMER,
      BOOTSTRAP_PROVIDER: "telnyx",
      BETTERSTACK_ALERT_URL: vorfaelle.url,
      TELNYX_API_KEY: "test",
      TELNYX_API_BASE: sms.url,
      PLATFORM_ALERT_SMS_TO: SMS_ZIEL,
    },
  });
  try {
    const meldungen = await vorfaelle.aufMeldungen(EINMAL);
    await echtWarten(NACHLAUF_MS);
    assert.equal(meldungen.length, EINMAL);
    assert.equal(meldungen[0].methode, "POST");
    assert.equal(meldungen[0].status, "alert");
    assert.match(meldungen[0].id, /^bootstrap-heal:/);
    assert.equal(sms.anfragen.length, KEINE);
  } finally {
    await srv.stop();
  }
});

test("K2: auch ohne offene Bindung alert_sms_sender haelt die Bootstrap-Nummer bei Loeschung des Mandanten, kein Provider-DELETE", async () => {
  const { store } = await makePgTestStore();
  const state = store.load();
  state.numbers.push(...speicherMitBootstrapNummer(BOOTSTRAP_NUMMER).numbers);
  ableiten(state, store);
  unbindPlatformNumber(state, { e164: BOOTSTRAP_NUMMER, purpose: PLATFORM_NUMBER_PURPOSE.ALERT_SMS_SENDER });
  const provisioner = fakeProvisioner();
  const audit = { records: [], record(eintrag) { this.records.push(eintrag); return Promise.resolve(); } };
  const ergebnis = await releaseTenantNumbersOnErase({
    store,
    provisioner,
    audit,
    logger: fakeLogger(),
    tenantId: BOOTSTRAP_TENANT_ID,
  });
  assert.deepEqual(ergebnis, { released: 0, aborted: 1 });
  assert.deepEqual(provisioner.log, []);
  assert.equal(findNumber(state, "boot_n").status, NUMBER_STATUS.ACTIVE);
  const abgebrochen = audit.records.filter((eintrag) => eintrag.action === "did_release_aborted");
  assert.equal(abgebrochen.length, EINMAL);
  assert.match(abgebrochen[0].detail, new RegExp(`grund=${NUMBER_HOLD_REASON.PLATFORM_IN_USE}`));
});

test("K3: der Start legt genau eine offene Haltezeile ohne Mandanten fuer die Bootstrap-Nummer an, auch beim zweiten Start", () => {
  const state = speicherMitBootstrapNummer(BOOTSTRAP_NUMMER);
  ableiten(state);
  ableiten(state);
  const halte = offeneHalte(state);
  assert.equal(halte.length, EINMAL);
  assert.equal(halte[0].e164, BOOTSTRAP_NUMMER);
  assert.equal(halte[0].tenantId, null);
  assert.equal(halte[0].provider, PROVIDER.TELNYX);
  assert.equal(halte[0].note, "abgeleitet aus der aktiven Bootstrap-Nummer (Halt gegen Freigabe)");
  assert.equal(BOOTSTRAP_NUMBER_HOLD_PURPOSE, "bootstrap_number_hold");
});

test("K3: wechselt die Bootstrap-Nummer, ist die alte Haltezeile geschlossen und die neue offen", () => {
  const state = speicherMitBootstrapNummer(BOOTSTRAP_NUMMER);
  ableiten(state);
  state.numbers[0].e164 = ANDERE_NUMMER;
  ableiten(state);
  const alt = state.platformNumberUse.find(
    (binding) => binding.purpose === BOOTSTRAP_NUMBER_HOLD_PURPOSE && binding.e164 === BOOTSTRAP_NUMMER,
  );
  assert.notEqual(alt.releasedAt, null);
  const halte = offeneHalte(state);
  assert.equal(halte.length, EINMAL);
  assert.equal(halte[0].e164, ANDERE_NUMMER);
});

test("K3: ohne aktive Bootstrap-Nummer gibt es keine offene Haltezeile", () => {
  const state = makeDefaultState();
  ableiten(state);
  assert.deepEqual(offeneHalte(state), []);
});
