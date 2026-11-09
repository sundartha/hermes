import { test } from "node:test";
import assert from "node:assert/strict";
import { starteHermesMitPglite, LOGIN_SUB } from "../abrechnung/server-mit-testdatenbank.js";

const HTTP_OK = 200;
const HTTP_BAD_GATEWAY = 502;
const NUMMERN_OBERGRENZE = 100;
const MONATSMIETE_CENTS = 120;
const ZIEL = "+4917312345679";
const AUFWAERM_ZIEL = "+4917312345680";
const JSON_KOPF = { "content-type": "application/json" };
const MANDANT_GEBUCHT = "t_absender_gebucht";
const MANDANT_UNGEBUCHT = "t_absender_ungebucht";
const ALTE_NUMMERN = { [MANDANT_GEBUCHT]: "+4915799990011", [MANDANT_UNGEBUCHT]: "+4915799990012" };
const ERSATZ_NUMMERN = ["+12025550141", "+12025550142", "+12025550143"];
const MONATSBELEG = "number_month";

const laufendesHermes = await starteHermesMitPglite({ alarmPostfach: "", anrufstartAbgelehnt: true });
const { config } = await import("../../src/config.js");
const store = await import("../../src/store.js");
const { runNummerntausch } = await import("../../src/worker/nummerntausch.js");

const hermes = laufendesHermes();
const { sessionCookie } = await hermes.anmelden();
const BETREIBER = await hermes.betreiberDarfAnrufen();

function deutscheNummer(tenantId) {
  return {
    id: `num_${tenantId}`,
    tenantId,
    e164: ALTE_NUMMERN[tenantId],
    provider: "telnyx",
    status: "active",
    providerNumberId: `pnum_${tenantId}`,
    country: "DE",
    language: "de",
    paymentIntentId: null,
    monthlyCostCents: MONATSMIETE_CENTS,
  };
}

function mandantenMitDeutscherNummer() {
  const state = store.load();
  const betreiberNummer = state.numbers.find((nummer) => nummer.tenantId === BETREIBER);
  Object.assign(betreiberNummer, { providerNumberId: "pnum_betreiber", country: "DE", monthlyCostCents: MONATSMIETE_CENTS });
  for (const tenantId of Object.keys(ALTE_NUMMERN)) {
    state.tenants.push({ id: tenantId, status: "active", kycLevel: "card", ownerName: "Tausch Tester" });
    state.numbers.push(deutscheNummer(tenantId));
  }
}

function anbieterAttrappe() {
  const frei = [...ERSATZ_NUMMERN];
  return {
    searchNumbers: async () => [{ e164: frei.shift() }],
    orderNumber: async ({ e164 }) => ({ e164, providerNumberId: `pnum_neu_${e164}` }),
  };
}

const registrierung = {
  async ensureRegistration({ numberId }) {
    return { phoneNumberId: `phnum_${numberId}` };
  },
};

const nummernVon = (tenantId) => store.load().numbers.filter((nummer) => nummer.tenantId === tenantId);

function paarVon(tenantId) {
  const [alt, ersatz] = nummernVon(tenantId);
  return { alt, ersatz };
}

async function tauschen() {
  mandantenMitDeutscherNummer();
  store.save();
  await store.drainFlushes();
  Object.assign(config.provisioning, {
    provisioningEnabled: true,
    maxNumbers: NUMMERN_OBERGRENZE,
    maxNumbersPerTenant: 1,
  });
  const ergebnisse = await runNummerntausch({
    store,
    config,
    numberProvisioning: anbieterAttrappe,
    sipRegistrar: registrierung,
    inboundTrunkSchreiber: null,
    logger: { log() {}, warn() {}, error() {} },
  });
  for (const tenantId of [BETREIBER, ...Object.keys(ALTE_NUMMERN)])
    paarVon(tenantId).ersatz.monthlyCostCents = MONATSMIETE_CENTS;
  store.save();
  await store.drainFlushes();
  return ergebnisse;
}

const tauschErgebnisse = await tauschen();

function anrufen(ziel = ZIEL, senden = hermes.anfrage) {
  return senden("/api/calls", {
    method: "POST",
    headers: { ...JSON_KOPF, "x-internal-identity": LOGIN_SUB },
    body: JSON.stringify({ to: ziel, objective: "Termin vereinbaren" }),
  });
}

await anrufen(AUFWAERM_ZIEL, hermes.aufwaermen);

async function aktiveNummerImDashboard() {
  const antwort = await hermes.anfrage("/api/state", { headers: { "x-internal-identity": LOGIN_SUB } });
  assert.equal(antwort.status, HTTP_OK);
  return (await antwort.json()).agent.number;
}

async function monatsabrechnungAnstossen(tenantId) {
  await hermes.db.query(
    "UPDATE tenant SET status = 'active' WHERE id IN (SELECT tenant_id FROM account WHERE sub = $1)",
    [LOGIN_SUB],
  );
  return hermes.anfrage("/api/onboard/retry", {
    method: "POST",
    headers: { ...JSON_KOPF, cookie: sessionCookie },
    body: JSON.stringify({ tenantId }),
  });
}

async function mitZahlung(ablauf) {
  const vorher = config.billing.paymentEnabled;
  config.billing.paymentEnabled = true;
  try {
    return await ablauf();
  } finally {
    config.billing.paymentEnabled = vorher;
  }
}

const monatsbelegeVon = (tenantId) =>
  store.load().usageEvents.filter((ereignis) => ereignis.kind === MONATSBELEG && ereignis.tenantId === tenantId);

test("Kriterium 6: der Tausch hat fuer jeden Mandanten eine aktive Ersatznummer hinter der alten Nummer abgelegt", () => {
  assert.deepEqual(
    tauschErgebnisse.map((eintrag) => eintrag.ergebnis),
    ["ersatz_aktiv", "ersatz_aktiv", "ersatz_aktiv"],
  );
  const { alt, ersatz } = paarVon(BETREIBER);
  const reihenfolge = store.load().numbers.map((nummer) => nummer.id);
  assert.ok(reihenfolge.indexOf(alt.id) < reihenfolge.indexOf(ersatz.id), "alte Nummer steht vor der Ersatznummer");
  assert.equal(alt.status, "active");
  assert.equal(ersatz.status, "active");
  assert.ok(ersatz.e164.startsWith("+1"));
});

test("Kriterium 6: ein Anruf ueber POST /api/calls geht nach dem Tausch von der Ersatznummer aus", async () => {
  const { ersatz } = paarVon(BETREIBER);

  const antwort = await anrufen();

  assert.equal(antwort.status, HTTP_BAD_GATEWAY, "der Anrufstart scheitert erst beim Anbieter, nach resolve_outbound");
  const anruf = store.load().calls.find((eintrag) => eintrag.to === ZIEL);
  assert.equal(anruf.from, ersatz.e164);
});

test("Kriterium 6: das Dashboard zeigt ueber GET /api/state die Ersatznummer als aktive Nummer", async () => {
  const { ersatz } = paarVon(BETREIBER);

  assert.equal(await aktiveNummerImDashboard(), ersatz.e164);
});

test("Kriterium 7: ist die alte Nummer im Monat schon gebucht, bucht die Monatsabrechnung fuer die Ersatznummer keinen Beleg", async () => {
  const { alt } = paarVon(MANDANT_GEBUCHT);
  store.recordUsageEvent({
    tenantId: MANDANT_GEBUCHT,
    numberId: alt.id,
    kind: MONATSBELEG,
    quantity: 1,
    costCents: MONATSMIETE_CENTS,
    occurredAt: new Date().toISOString(),
  });
  await store.drainFlushes();

  await mitZahlung(() => monatsabrechnungAnstossen(MANDANT_GEBUCHT));

  assert.deepEqual(monatsbelegeVon(MANDANT_GEBUCHT).map((ereignis) => ereignis.numberId), [alt.id]);
});

test("Kriterium 7: wechselt der Monat bei zwei aktiven Nummern, entsteht genau ein Beleg je Mandant", async () => {
  assert.equal(monatsbelegeVon(MANDANT_UNGEBUCHT).length, 0);

  await mitZahlung(async () => {
    await monatsabrechnungAnstossen(MANDANT_UNGEBUCHT);
    await monatsabrechnungAnstossen(MANDANT_UNGEBUCHT);
  });

  assert.equal(monatsbelegeVon(MANDANT_UNGEBUCHT).length, 1);
});

test("Kriterium 6: ohne aktive Ersatznummer bleibt die alte Nummer der Absender und die aktive Nummer im Dashboard", async () => {
  const { alt, ersatz } = paarVon(BETREIBER);
  ersatz.status = "failed";
  store.save();
  await store.drainFlushes();

  assert.equal(await aktiveNummerImDashboard(), alt.e164);
});
