import { test } from "node:test";
import assert from "node:assert/strict";
import { makePgTestStore } from "../pg-helpers.js";
import { runNummerntausch } from "../../src/worker/nummerntausch.js";
import { withConfigNamespaces } from "../config-namespaces-helper.js";
import { findActiveNumber, activeNumberFor } from "../../src/store/views.js";
import { makeMetering } from "../../src/billing/metering.js";
import { makeProvisioningOrchestrator } from "../../src/worker/provisioning-orchestrator.js";

const TENANT_A = "t_tausch_a";
const TENANT_B = "t_tausch_b";
const ALT = { a: "+4915799990001", b: "+4915799990002" };
const NEU_ENDUNG = "0100";
const KAUFLAND = "US";
const VERSUCHE_JE_NUMMER = 3;
const PLATTFORMDECKE_EIN_PLATZ = 1;
const GROSSE_DECKE = 50;
const LOGZEILE = /^\[nummerntausch\] tenant=(\S+) alt=(\S+) neu=(\S+) ergebnis=(\S+)$/;

const NUMMER = { AKTIV: "active", ANGEFRAGT: "requested", BESTELLT: "provisioning", FEHLGESCHLAGEN: "failed" };

function konfiguration(abweichung = {}) {
  return withConfigNamespaces({
    provisioningEnabled: true,
    maxNumbers: GROSSE_DECKE,
    maxNumbersPerTenant: 1,
    platformAniE164: "",
    paymentEnabled: true,
    ...abweichung,
  });
}

function attrappe({ bestellungScheitert = () => false } = {}) {
  const spur = { suchen: [], bestellungen: [], freigaben: [] };
  return {
    spur,
    async searchNumbers({ countryCode }) {
      spur.suchen.push(countryCode);
      return [{ e164: `+1202555${NEU_ENDUNG}` }];
    },
    async orderNumber({ e164, idempotencyKey }) {
      spur.bestellungen.push(idempotencyKey);
      if (bestellungScheitert(spur.bestellungen.length)) throw new Error("Telnyx lehnt ab");
      return { e164, providerNumberId: `pnum_${spur.bestellungen.length}` };
    },
    async releaseNumber(providerNumberId) {
      spur.freigaben.push(providerNumberId);
    },
  };
}

function registrierung() {
  const aufrufe = [];
  return {
    aufrufe,
    async ensureRegistration({ e164, numberId }) {
      aufrufe.push({ e164, numberId });
      return { phoneNumberId: `phnum_${numberId}`, angelegt: true };
    },
  };
}

function logZeilen() {
  const zeilen = [];
  const logger = { log: (zeile) => zeilen.push(zeile), warn() {}, error() {} };
  return { logger, tausch: () => zeilen.filter((zeile) => zeile.startsWith("[nummerntausch]")) };
}

async function mandant(tenantId, e164 = null, nummer = {}) {
  const { store } = aktuellerSpeicher;
  const state = store.load();
  if (!state.tenants.some((eintrag) => eintrag.id === tenantId))
    state.tenants.push({ id: tenantId, status: "active" });
  if (e164)
    state.numbers.push({
      id: `num_${tenantId}`,
      tenantId,
      e164,
      provider: "telnyx",
      status: NUMMER.AKTIV,
      providerNumberId: `pnum_alt_${tenantId}`,
      country: "DE",
      language: "de",
      paymentIntentId: null,
      ...nummer,
    });
  return state;
}

let aktuellerSpeicher = null;

async function neuerLauf() {
  aktuellerSpeicher = await makePgTestStore();
  return aktuellerSpeicher.store;
}

async function tausche(store, anbieter, optionen = {}) {
  const protokoll = logZeilen();
  const sipRegistrar = optionen.sipRegistrar ?? registrierung();
  await runNummerntausch({
    store,
    config: optionen.config ?? konfiguration(),
    numberProvisioning: () => anbieter,
    sipRegistrar,
    inboundTrunkSchreiber: null,
    logger: protokoll.logger,
  });
  return { zeilen: protokoll.tausch(), sipRegistrar };
}

const aktiveNummern = (state, tenantId) =>
  state.numbers.filter((nummer) => nummer.tenantId === tenantId && nummer.status === NUMMER.AKTIV);
const ersatzNummern = (state, tenantId) =>
  state.numbers.filter((nummer) => nummer.tenantId === tenantId && nummer.id !== `num_${tenantId}`);
const ohneTelnyxAnfrage = (anbieter) =>
  assert.deepEqual(anbieter.spur, { suchen: [], bestellungen: [], freigaben: [] });

test("Kriterium 5: Mandant mit +49-Nummer bekommt eine aktive +1-Nummer mit Registrierung, ohne Hold, eine Logzeile", async () => {
  const store = await neuerLauf();
  const state = await mandant(TENANT_A, ALT.a);
  const anbieter = attrappe();

  const { zeilen, sipRegistrar } = await tausche(store, anbieter);

  const [ersatz] = ersatzNummern(state, TENANT_A);
  assert.equal(ersatz.status, NUMMER.AKTIV);
  assert.ok(ersatz.e164.startsWith("+1"));
  assert.equal(ersatz.country, KAUFLAND);
  assert.equal(ersatz.language, "de");
  assert.equal(ersatz.paymentIntentId, null, "kein Hold, keine Zahlungsabsicht");
  assert.equal(ersatz.providerAgentPhoneNumberId, `phnum_${ersatz.id}`);
  assert.deepEqual(sipRegistrar.aufrufe, [{ e164: ersatz.e164, numberId: ersatz.id }]);
  assert.deepEqual(anbieter.spur.suchen, [KAUFLAND]);
  assert.equal(state.numbers.find((nummer) => nummer.id === `num_${TENANT_A}`).status, NUMMER.AKTIV, "alte Nummer bleibt aktiv");
  assert.equal(zeilen.length, 1);
  const [, mandantId, alt, neu] = zeilen[0].match(LOGZEILE);
  assert.equal(mandantId, TENANT_A);
  assert.equal(alt, "…0001");
  assert.equal(neu, `…${NEU_ENDUNG}`);
  assert.ok(!zeilen[0].includes(ALT.a), "keine volle Rufnummer im Log");
});

test("Kriterium 8: Kauf scheitert, alte Nummer bleibt, der naechste Mandant wird getauscht", async () => {
  const store = await neuerLauf();
  const state = await mandant(TENANT_A, ALT.a);
  await mandant(TENANT_B, ALT.b);
  const anbieter = attrappe({ bestellungScheitert: (anzahl) => anzahl === 1 });

  const { zeilen } = await tausche(store, anbieter);

  assert.deepEqual(
    zeilen.map((zeile) => zeile.match(LOGZEILE).slice(1, 2).concat(zeile.match(LOGZEILE)[4])),
    [
      [TENANT_A, "kauf_fehlgeschlagen"],
      [TENANT_B, "ersatz_aktiv"],
    ],
  );
  assert.equal(state.numbers.find((nummer) => nummer.id === `num_${TENANT_A}`).status, NUMMER.AKTIV);
  assert.equal(aktiveNummern(state, TENANT_B).length, 2);
});

for (const zustand of [NUMMER.ANGEFRAGT, NUMMER.BESTELLT, NUMMER.FEHLGESCHLAGEN]) {
  test(`Kriterium 8: Ersatz-Datensatz im Zustand ${zustand} wird mit demselben Bestellschluessel wieder aufgenommen`, async () => {
    const store = await neuerLauf();
    const state = await mandant(TENANT_A, ALT.a);
    const anbieter = attrappe({ bestellungScheitert: (anzahl) => anzahl === 1 });
    await tausche(store, anbieter);
    const [ersatz] = ersatzNummern(state, TENANT_A);
    ersatz.status = zustand;

    const { zeilen } = await tausche(store, anbieter);

    assert.equal(ersatzNummern(state, TENANT_A).length, 1, "kein zweiter Datensatz");
    assert.equal(ersatz.status, NUMMER.AKTIV);
    assert.deepEqual(anbieter.spur.bestellungen, [`order_${ersatz.id}`, `order_${ersatz.id}`]);
    assert.match(zeilen[0], /ergebnis=ersatz_aktiv$/);
  });
}

test("Kriterium 8: nach 3 Versuchen je alter Nummer ergebnis=manuell ohne Telnyx-Anfrage", async () => {
  const store = await neuerLauf();
  const state = await mandant(TENANT_A, ALT.a);
  const scheiternd = attrappe({ bestellungScheitert: () => true });
  for (let start = 0; start < VERSUCHE_JE_NUMMER; start += 1) await tausche(store, scheiternd);
  const nachDreiVersuchen = attrappe();

  const { zeilen } = await tausche(store, nachDreiVersuchen);

  assert.equal(scheiternd.spur.bestellungen.length, VERSUCHE_JE_NUMMER);
  ohneTelnyxAnfrage(nachDreiVersuchen);
  assert.match(zeilen[0], /ergebnis=manuell$/);
  assert.equal(ersatzNummern(state, TENANT_A).length, 1);
});

const KEIN_KANDIDAT = [
  {
    name: "Mandant hat schon eine aktive +1-Nummer",
    aufbau: async () => {
      await mandant(TENANT_A, "+12025550177", { country: KAUFLAND });
    },
  },
  {
    name: "Nummer ohne providerNumberId",
    aufbau: async () => {
      await mandant(TENANT_A, ALT.a, { providerNumberId: null });
    },
  },
  {
    name: "Nummer des Bootstrap-Mandanten",
    aufbau: async () => {
      await mandant("owner", ALT.a);
    },
  },
  {
    name: "Nummer mit Plattform-Bindung",
    aufbau: async () => {
      const state = await mandant(TENANT_A, ALT.a);
      state.platformNumberUse.push({ e164: ALT.a, purpose: "outbound_ani", releasedAt: null });
    },
  },
  {
    name: "PLATFORM_ANI_E164",
    aufbau: async () => {
      await mandant(TENANT_A, ALT.a);
    },
    config: { platformAniE164: ALT.a },
  },
];

for (const fall of KEIN_KANDIDAT) {
  test(`Kriterium 10: ${fall.name} loest keine Suche, Bestellung oder Freigabe aus`, async () => {
    const store = await neuerLauf();
    await fall.aufbau();
    const anbieter = attrappe();

    const { zeilen } = await tausche(store, anbieter, { config: konfiguration(fall.config) });

    ohneTelnyxAnfrage(anbieter);
    assert.deepEqual(zeilen, []);
  });
}

test("Kriterium 10: ein zweiter Start nach erfolgreichem Tausch fragt Telnyx nichts", async () => {
  const store = await neuerLauf();
  const state = await mandant(TENANT_A, ALT.a);
  await tausche(store, attrappe());
  const zweiterStart = attrappe();

  await tausche(store, zweiterStart);

  ohneTelnyxAnfrage(zweiterStart);
  assert.equal(ersatzNummern(state, TENANT_A).length, 1);
});

test("Kriterium 11: ohne PROVISIONING_ENABLED nur dry_run, keine Anfrage, kein Datensatz", async () => {
  const store = await neuerLauf();
  const state = await mandant(TENANT_A, ALT.a);
  const anbieter = attrappe();

  const { zeilen } = await tausche(store, anbieter, {
    config: konfiguration({ provisioningEnabled: false }),
  });

  ohneTelnyxAnfrage(anbieter);
  assert.equal(zeilen.length, 1);
  assert.match(zeilen[0], /ergebnis=dry_run$/);
  assert.equal(ersatzNummern(state, TENANT_A).length, 0);
});

test("Kriterium 11: an der Plattformdecke MAX_NUMBERS ergebnis=plattformdecke ohne Markierung am Mandanten", async () => {
  const store = await neuerLauf();
  const state = await mandant(TENANT_A, ALT.a);
  const anbieter = attrappe();

  const { zeilen } = await tausche(store, anbieter, {
    config: konfiguration({ maxNumbers: PLATTFORMDECKE_EIN_PLATZ }),
  });

  ohneTelnyxAnfrage(anbieter);
  assert.match(zeilen[0], /ergebnis=plattformdecke$/);
  assert.equal(ersatzNummern(state, TENANT_A).length, 0);
  const mandantSatz = state.tenants.find((eintrag) => eintrag.id === TENANT_A);
  assert.ok(!mandantSatz.numberProvisionSkipReason, "keine Markierung am Mandanten");
});

const MONATSMIETE_CENTS = 120;
const KAPUTTE_REGISTRIERUNG = {
  aufrufe: [],
  async ensureRegistration() {
    throw new Error("ElevenLabs nicht erreichbar");
  },
};

async function getauschterMandant(store) {
  const state = await mandant(TENANT_A, ALT.a, { monthlyCostCents: MONATSMIETE_CENTS });
  await tausche(store, attrappe());
  const [ersatz] = ersatzNummern(state, TENANT_A);
  ersatz.monthlyCostCents = MONATSMIETE_CENTS;
  return { state, ersatz, alt: state.numbers.find((nummer) => nummer.id === `num_${TENANT_A}`) };
}

function monatsabrechnung(store) {
  const orchestrator = makeProvisioningOrchestrator({
    store,
    config: { billing: { paymentEnabled: true } },
    metering: makeMetering({ store }),
  });
  return orchestrator.settleDueNumberMonthMeters({ tenantId: TENANT_A });
}

const monatsbelege = (state) => state.usageEvents.filter((ereignis) => ereignis.kind === "number_month");

for (const reihenfolge of ["alt vor neu", "neu vor alt"]) {
  test(`Kriterium 6: Ersatznummer ist der Absender, auch wenn im Speicher ${reihenfolge}`, async () => {
    const store = await neuerLauf();
    const { state, ersatz, alt } = await getauschterMandant(store);
    if (reihenfolge === "neu vor alt") state.numbers.reverse();

    assert.equal(findActiveNumber(state, TENANT_A).id, ersatz.id);
    assert.equal(findActiveNumber(state, TENANT_A, "telnyx").id, ersatz.id);
    assert.equal(activeNumberFor(state, TENANT_A), ersatz.e164);
    assert.equal(alt.status, NUMMER.AKTIV, "alte Nummer bleibt aktiv");
  });
}

test("Kriterium 6: ohne aktive Ersatznummer bleibt die alte Nummer der Absender", async () => {
  const store = await neuerLauf();
  const { state, ersatz, alt } = await getauschterMandant(store);
  ersatz.status = NUMMER.FEHLGESCHLAGEN;

  assert.equal(findActiveNumber(state, TENANT_A).id, alt.id);
});

test("Kriterium 7: nach dem Tausch bucht die Monatsabrechnung fuer die Ersatznummer keinen Beleg", async () => {
  const store = await neuerLauf();
  const { state, ersatz, alt } = await getauschterMandant(store);
  store.recordUsageEvent({
    tenantId: TENANT_A,
    numberId: alt.id,
    kind: "number_month",
    quantity: 1,
    costCents: MONATSMIETE_CENTS,
    occurredAt: new Date().toISOString(),
  });

  const bilanz = await monatsabrechnung(store);

  assert.equal(bilanz.gebucht, 0);
  assert.deepEqual(monatsbelege(state).map((ereignis) => ereignis.numberId), [alt.id]);
  assert.ok(ersatz.id);
});

test("Kriterium 7: wechselt der Monat bei zwei aktiven Nummern, entsteht genau ein Beleg je Mandant", async () => {
  const store = await neuerLauf();
  const { state } = await getauschterMandant(store);

  const bilanz = await monatsabrechnung(store);
  const zweiterLauf = await monatsabrechnung(store);

  assert.equal(bilanz.gebucht, 1);
  assert.equal(zweiterLauf.gebucht, 0);
  assert.equal(monatsbelege(state).length, 1);
});

test("Kriterium 9: fehlt der Ersatznummer die Registrierung, bleibt die alte aktiv und nichts wird freigegeben", async () => {
  const store = await neuerLauf();
  const state = await mandant(TENANT_A, ALT.a);
  const anbieter = attrappe();

  const { zeilen } = await tausche(store, anbieter, { sipRegistrar: KAPUTTE_REGISTRIERUNG });

  assert.equal(zeilen.length, 1);
  assert.match(zeilen[0], /ergebnis=registrierung_fehlgeschlagen$/);
  assert.deepEqual(anbieter.spur.freigaben, []);
  assert.equal(state.numbers.find((nummer) => nummer.id === `num_${TENANT_A}`).status, NUMMER.AKTIV);
  const [ersatz] = ersatzNummern(state, TENANT_A);
  assert.ok(!ersatz.providerAgentPhoneNumberId);
});

test("Kriterium 9: der naechste Start holt die Registrierung nach und kauft nicht neu", async () => {
  const store = await neuerLauf();
  const state = await mandant(TENANT_A, ALT.a);
  await tausche(store, attrappe(), { sipRegistrar: KAPUTTE_REGISTRIERUNG });
  const zweiterStart = attrappe();

  const { zeilen, sipRegistrar } = await tausche(store, zweiterStart);

  ohneTelnyxAnfrage(zweiterStart);
  const [ersatz] = ersatzNummern(state, TENANT_A);
  assert.equal(ersatzNummern(state, TENANT_A).length, 1);
  assert.equal(ersatz.providerAgentPhoneNumberId, `phnum_${ersatz.id}`);
  assert.deepEqual(sipRegistrar.aufrufe, [{ e164: ersatz.e164, numberId: ersatz.id }]);
  assert.match(zeilen[0], /ergebnis=ersatz_aktiv$/);
});
