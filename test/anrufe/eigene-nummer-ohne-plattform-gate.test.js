import assert from "node:assert/strict";
import { test } from "node:test";

import { runNummerntausch } from "../../src/worker/nummerntausch.ts";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { abrufMitFrist } from "../gemeinsam/antwortfrist.mjs";
import { vorspannMandantenUmgebung } from "../gemeinsam/vorspann-fahrzeug.js";
import { makePgTestStore } from "../pg-helpers.js";
import { seedState, startServer } from "../helpers.js";

const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;
const ZIEL = "+4915112345678";
const EIGENE_NUMMER = "+4915799990011";
const PLATTFORM_NUMMER = "+13125550111";
const ALTE_NUMMER = "+4915799990001";
const MANDANT = "t_eigene_nummer";

const mandant = {
  id: MANDANT,
  status: "active",
  kycLevel: "card",
  ownerName: "Eve Example",
  country: "DE",
  defaultLanguage: "de",
};

function startMit(nummern, env = {}) {
  const stand = seedState({
    tenants: [mandant],
    numbers: nummern,
    profiles: { [MANDANT]: { maxCallsPerHour: 100 } },
  });
  stand.outageAlerts = [{ code: "drift:ownership_lost", closedAt: null, lastSeenAt: new Date().toISOString() }];
  return startServer({
    seed: stand,
    env: { ...vorspannMandantenUmgebung([MANDANT]), VOICE_TARIFF_DEFAULT_CENTS: "30", VOICE_TARIFF_DOMESTIC_CENTS: "30", ...env },
  });
}

const nummer = (felder) => ({
  provider: "telnyx",
  providerAgentPhoneNumberId: "phnum_eigene_nummer",
  status: "active",
  providerNumberId: null,
  language: "de",
  ...felder,
});

async function anrufen(srv) {
  const res = await abrufMitFrist(`${srv.localUrl}/api/calls`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Internal-Tenant": MANDANT },
    body: JSON.stringify({ to: ZIEL, objective: "Termin vereinbaren" }),
  });
  return { status: res.status, body: await res.json() };
}

test("Absender: bei offener Plattform-Nummern-Meldung geht der Anruf mit der eigenen Nummer des Mandanten raus", async () => {
  const srv = await startMit([nummer({ id: "num_e1", tenantId: MANDANT, e164: EIGENE_NUMMER })], {
    OUTBOUND_ANI_GATE_ENABLED: "true",
    PLATFORM_ANI_E164: PLATTFORM_NUMMER,
  });
  try {
    const { status } = await anrufen(srv);
    assert.equal(status, HTTP_OK);
    const [anruf] = srv.readStore().calls;
    assert.equal(anruf.from, EIGENE_NUMMER);
  } finally {
    await srv.stop();
  }
});

test("Absender: ohne eigene aktive Nummer bricht der Anruf mit 403 ab, auch wenn PLATFORM_ANI_E164 gesetzt ist", async () => {
  const srv = await startMit([], { PLATFORM_ANI_E164: PLATTFORM_NUMMER });
  try {
    const { status, body } = await anrufen(srv);
    assert.equal(status, HTTP_FORBIDDEN);
    assert.equal(body.reason, "keine_tenant_nummer");
    assert.deepEqual(srv.readStore().calls, []);
  } finally {
    await srv.stop();
  }
});

test("Start: PLATFORM_ANI_E164 wird nicht mehr gelesen, keine Warnung dazu im Log", async () => {
  const srv = await startServer({ seed: seedState({}), env: { PLATFORM_ANI_E164: "015112345678" } });
  try {
    assert.doesNotMatch(srv.stdout, /PLATFORM_ANI_E164/);
  } finally {
    await srv.stop();
  }
});

test("Nummerntausch: eine Nummer, die dem alten PLATFORM_ANI_E164 gleicht, ist wie jede Mandanten-Nummer ein Kandidat", async () => {
  const { store } = await makePgTestStore();
  const state = store.load();
  state.tenants.push({ id: "t_tausch", status: "active" });
  state.numbers.push({
    id: "num_t_tausch",
    tenantId: "t_tausch",
    e164: ALTE_NUMMER,
    provider: "telnyx",
    status: "active",
    providerNumberId: "pnum_alt",
    country: "DE",
    language: "de",
    paymentIntentId: null,
  });
  const zeilen = [];
  const anbieter = {
    searchNumbers: async () => [{ e164: "+12025550100" }],
    orderNumber: async ({ e164 }) => ({ e164, providerNumberId: "pnum_neu" }),
    releaseNumber: async () => {},
  };
  await runNummerntausch({
    store,
    config: withConfigNamespaces({
      provisioningEnabled: true,
      maxNumbers: 50,
      maxNumbersPerTenant: 1,
      platformAniE164: ALTE_NUMMER,
      paymentEnabled: true,
    }),
    numberProvisioning: () => anbieter,
    sipRegistrar: { ensureRegistration: async ({ numberId }) => ({ phoneNumberId: `phnum_${numberId}`, angelegt: true }) },
    inboundTrunkSchreiber: null,
    logger: { log: (z) => zeilen.push(z), warn() {}, error() {} },
  });
  assert.ok(zeilen.some((z) => z.startsWith("[nummerntausch] tenant=t_tausch")));
});
