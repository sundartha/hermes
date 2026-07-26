// F1 Geo-Provisioning (Phase P7): per-Job-countryCode aus dem Number-Record + Telnyx-
// Geo-Suche. Rein offline (Fakes, kein Netz, kein Server, kein pglite - eigene Datei).
// Prueft: searchParamsForCountry (FR->+33, DE/unbekannt->config-Fallback) UND den
// Drain-Pfad (FR-Request -> +33-Suche; ZWEIMAL drainen -> genau EIN Kauf, R1;
// 0 Treffer -> sauberer Fehler, R5). Die Suchparameter-Tabelle ist die einzige
// Aenderung am Geld-Pfad - die drei Idempotenz-Schloesser bleiben unangetastet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeMemoryQueue } from "../src/queue/adapters/memory/queue.js";
import { handleProvisionJob } from "../src/worker/provisioning.js";
import { searchParamsForCountry, holdAmountForCountry } from "../src/telephony/provisioning-geo.js";
import { config } from "../src/config.js";
import { fakeProvisioner } from "./helpers.js";
import { withConfigNamespaces } from "./config-namespaces-helper.js";
import { makeMetering } from "../src/billing/metering.js";
import {
  makeDefaultState,
  registerTenant,
  requestNumber,
  findNumber,
  recordProvisioningJob,
  setTenantStripe,
} from "../src/store/state-ops.js";
import {
  NUMBER_STATUS,
  PROVISION_NUMBER_JOB,
  PROVISIONING_JOB_STATUS,
  USAGE_EVENT_KIND,
} from "../src/store/defaults.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
// Der eine Tenant aller Fixturen dieser Datei (seedRequested, enqueueProvision, GAP-11).
const TENANT_ID = "t_user1";

// Seedet eine 'requested' Number mit explizitem Land (Default DE).
function seedRequested(country = "DE") {
  const s = makeDefaultState();
  registerTenant(s, TENANT_ID);
  const { number } = requestNumber(s, { tenantId: TENANT_ID, country, ...CAPS });
  return { s, numberId: number.id };
}

// Spiegelt den Drain aus server.js (runProvisioningDrain): leitet die Suchparameter
// PRO JOB aus number.country ab (searchParamsForCountry) und reicht sie an den Worker
// durch. Ohne store.save (reine Fn). drain wirft NICHT (Adapter faengt handler-Fehler).
// onHold (optional): wird mit dem pro Job abgeleiteten holdAmountCents aufgerufen, damit
// Tests den durchgereichten Hold-Wert pruefen koennen (Spiegel von server.js, P9).
function drainWithGeo(queue, s, deps, defaultHoldCents, onHold) {
  return queue.drain(async (queuedJob) => {
    const record = s.provisioningJobs.find((j) => j.idempotencyKey === queuedJob.idempotencyKey);
    const number = findNumber(s, queuedJob.payload.numberId);
    const geo = searchParamsForCountry(number?.country);
    const holdAmountCents =
      defaultHoldCents !== undefined
        ? holdAmountForCountry(number?.country, defaultHoldCents)
        : undefined;
    if (onHold) onHold(holdAmountCents);
    const opts = { ...geo, ...(holdAmountCents !== undefined ? { holdAmountCents } : {}) };
    try {
      await handleProvisionJob(s, queuedJob, deps, opts);
      if (record) record.status = PROVISIONING_JOB_STATUS.DONE;
    } catch (err) {
      if (record) record.status = PROVISIONING_JOB_STATUS.FAILED;
      throw err;
    }
  });
}

function enqueueProvision(queue, s, numberId) {
  const idempotencyKey = `provision_${numberId}`;
  queue.enqueue({ kind: PROVISION_NUMBER_JOB, payload: { numberId }, idempotencyKey });
  recordProvisioningJob(s, { numberId, tenantId: TENANT_ID, idempotencyKey });
}

// ---- searchParamsForCountry (Tabelle) ----

test("searchParamsForCountry: FR -> +33-Suche (countryCode FR)", () => {
  const params = searchParamsForCountry("FR");
  assert.equal(params.countryCode, "FR");
});

test("searchParamsForCountry: DE -> globaler config-Fallback (byte-identisch)", () => {
  const params = searchParamsForCountry("DE");
  assert.equal(params.countryCode, config.provisioning.provisioningCountry);
  assert.equal(params.connectionId, config.telephony.telnyxConnectionId);
});

test("searchParamsForCountry: unbekannt/leer -> config-Fallback (kein Crash, R7)", () => {
  for (const c of ["ZZ", "", null, undefined]) {
    const params = searchParamsForCountry(c);
    assert.equal(params.countryCode, config.provisioning.provisioningCountry, `Fallback fuer ${c}`);
  }
});

test("searchParamsForCountry: case-insensitiv (fr -> FR)", () => {
  assert.equal(searchParamsForCountry("fr").countryCode, "FR");
});

// AM5: US als Test-Land (entkoppelt vom config.provisioning.provisioningCountry-Default; connectionId
// faellt weiter auf den globalen config-Wert).
test("searchParamsForCountry: US -> +1-Suche (countryCode US, case-insensitiv)", () => {
  assert.equal(searchParamsForCountry("US").countryCode, "US");
  assert.equal(searchParamsForCountry("us").countryCode, "US");
  assert.equal(searchParamsForCountry("US").connectionId, config.telephony.telnyxConnectionId);
});

// ---- holdAmountForCountry (Hold pro Land, P9) ----

const DEFAULT_HOLD = 1234; // beliebiger Default-Cent-Wert (steht fuer numberSetupFeeCents)

test("holdAmountForCountry: DE (kein Eintrag) -> Default-Hold (byte-identisch)", () => {
  assert.equal(holdAmountForCountry("DE", DEFAULT_HOLD), DEFAULT_HOLD);
});

test("holdAmountForCountry: Land ohne holdAmountCents (FR/GB) -> Default-Hold", () => {
  assert.equal(holdAmountForCountry("FR", DEFAULT_HOLD), DEFAULT_HOLD);
  assert.equal(holdAmountForCountry("GB", DEFAULT_HOLD), DEFAULT_HOLD);
});

test("holdAmountForCountry: unbekannt/leer/null/undefined -> Default-Hold", () => {
  for (const c of ["ZZ", "", null, undefined]) {
    assert.equal(holdAmountForCountry(c, DEFAULT_HOLD), DEFAULT_HOLD, `Default fuer ${c}`);
  }
});

test("holdAmountForCountry: case-insensitiv -> Default-Hold (fr ohne eigenen Tarif)", () => {
  assert.equal(holdAmountForCountry("fr", DEFAULT_HOLD), DEFAULT_HOLD);
});

// Zwei UNTERSCHIEDLICHE Sentinel-Defaults: stimmt das Ergebnis bei BEIDEN mit dem
// Aufrufer-Default ueberein, kann es kein zufaellig gleicher Tabellenwert sein.
const SENTINEL_HOLD_A = 500;
const SENTINEL_HOLD_B = 777;

// PAY-17: US ist heute PREIS-GLEICH zu DE. Die Land-Differenzierung existiert fuer die
// SUCHPARAMETER (Test oben: US -> countryCode US), fuer den PREIS aber nicht - kein
// Tabellen-Eintrag traegt holdAmountCents.
test("PAY-17: holdAmountForCountry liefert fuer US denselben Betrag wie fuer DE (kein eigener US-Preis)", () => {
  assert.equal(holdAmountForCountry("US", SENTINEL_HOLD_A), holdAmountForCountry("DE", SENTINEL_HOLD_A));
  assert.equal(
    holdAmountForCountry("US", SENTINEL_HOLD_B),
    SENTINEL_HOLD_B,
    "US traegt keinen eigenen Tarif - der Wert stammt zu 100 % vom Aufrufer-Default",
  );
});

// Die Laender, in denen heute tatsaechlich gekauft wird: DE ist der
// provisioningCountry-Fallback, FR/GB/US sind die Tabellen-Eintraege, US zusaetzlich das
// LIVE gesetzte FORCE_NUMBER_COUNTRY-Kaufland (tasks/i18n-tests/13-live-env-befund.md).
// Die Liste steht bewusst hier im Test: COUNTRY_SEARCH_PARAMS ist modul-privat, ein
// Zugriff darauf braeche die Kapselung von provisioning-geo.js.
const ACTIVE_PURCHASE_COUNTRIES = Object.freeze(["DE", "FR", "GB", "US"]);

// GAP-11 (b), SOLL/rot: fuer jedes AKTIV bespielte Kauf-Land ist ein EXPLIZITER
// Laenderpreis zu pflegen. Heute faellt jedes Land auf den globalen Default zurueck -
// weicht der reale Telnyx-Preis ab, driftet der Hold unbemerkt vom Ist (R3). Die
// Hold==Capture==Ledger-Haelfte derselben ID steht als gruener Test am Dateiende.
test("GAP-11 (SOLL, rot): jedes bespielte Kauf-Land traegt einen EXPLIZITEN holdAmountCents", () => {
  const ohneEigenenPreis = ACTIVE_PURCHASE_COUNTRIES.filter(
    (c) =>
      holdAmountForCountry(c, SENTINEL_HOLD_A) === SENTINEL_HOLD_A &&
      holdAmountForCountry(c, SENTINEL_HOLD_B) === SENTINEL_HOLD_B,
  );
  assert.deepEqual(
    ohneEigenenPreis,
    [],
    "diese Kauf-Laender fallen auf den globalen Default zurueck, statt einen bestaetigten " +
      "Laenderpreis zu tragen - der Hold kann dort lautlos vom realen Provider-Preis abweichen",
  );
});

// ---- Drain-Pfad (per-Job-countryCode) ----

test("FR-Request -> Suche mit countryCode FR (per-Job aus number.country)", async () => {
  const { s, numberId } = seedRequested("FR");
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner();
  enqueueProvision(queue, s, numberId);

  await drainWithGeo(queue, s, { provisioner: prov });

  assert.ok(prov.log.includes("search:FR"), `Suche mit FR erwartet, log=${prov.log.join(",")}`);
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.ACTIVE);
});

test("DE-Request -> Suche mit config-Fallback-countryCode (byte-identisch)", async () => {
  const { s, numberId } = seedRequested("DE");
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner();
  enqueueProvision(queue, s, numberId);

  await drainWithGeo(queue, s, { provisioner: prov });

  assert.ok(prov.log.includes(`search:${config.provisioning.provisioningCountry}`), `log=${prov.log.join(",")}`);
});

test("R1: ZWEIMAL drainen -> genau EIN Kauf (Idempotenz unangetastet)", async () => {
  const { s, numberId } = seedRequested("FR");
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner();
  enqueueProvision(queue, s, numberId);

  await drainWithGeo(queue, s, { provisioner: prov }); // requested -> active
  const processedAgain = await drainWithGeo(queue, s, { provisioner: prov }); // re-drain

  assert.equal(processedAgain, 0, "Job 'done' -> kein erneuter Lauf");
  assert.equal(prov.log.filter((l) => l.startsWith("order")).length, 1, "order GENAU einmal");
  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.ACTIVE);
});

test("P9: Drain reicht per-Land-Hold durch (FR/DE ohne Tarif -> Default-Hold)", async () => {
  for (const country of ["FR", "DE"]) {
    const { s, numberId } = seedRequested(country);
    const queue = makeMemoryQueue();
    const prov = fakeProvisioner();
    enqueueProvision(queue, s, numberId);

    let seenHold;
    await drainWithGeo(queue, s, { provisioner: prov }, DEFAULT_HOLD, (h) => (seenHold = h));

    assert.equal(seenHold, DEFAULT_HOLD, `${country}: ohne eigenen Tarif -> Default-Hold`);
    assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.ACTIVE);
  }
});

test("P9: kein Geld-Pfad (Default undefined) -> kein holdAmountCents durchgereicht", async () => {
  const { s, numberId } = seedRequested("FR");
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner();
  enqueueProvision(queue, s, numberId);

  let seenHold = "unset";
  await drainWithGeo(queue, s, { provisioner: prov }, undefined, (h) => (seenHold = h));

  assert.equal(seenHold, undefined, "ohne Geld-Pfad bleibt der Hold undefined (byte-identisch)");
});

test("R5: 0 Treffer -> sauberer Fehler (failed), KEIN Kauf, KEIN Crash", async () => {
  const { s, numberId } = seedRequested("FR");
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner({
    async searchNumbers() {
      return [];
    },
  });
  enqueueProvision(queue, s, numberId);

  // drain faengt den handler-Fehler (Adapter) -> kein throw nach aussen; Fachzustand pruefen.
  await drainWithGeo(queue, s, { provisioner: prov });

  assert.equal(findNumber(s, numberId).status, NUMBER_STATUS.FAILED, "0 Treffer -> failed");
  assert.ok(!prov.log.some((l) => l.startsWith("order")), "kein Order ohne Kandidat");
});

// ---- GAP-11 (a): Hold == Capture == number_month-Beleg (eine Quelle) ----

// Protokolliert die beiden Geld-Betraege der Provisionierung (placeHold/captureHold).
function fakeSetupFeeBilling() {
  const holdAmounts = [];
  const captureAmounts = [];
  return {
    holdAmounts,
    captureAmounts,
    async placeHold({ amountCents }) {
      holdAmounts.push(amountCents);
      return { paymentIntentId: "pi_gap11" };
    },
    async captureHold(_paymentIntentId, amountCents) {
      captureAmounts.push(amountCents);
    },
    async cancelHold() {},
  };
}

// Faengt das number_month-usage_event auf (Muster test/metering-unit.test.js).
function fakeMeteringStore() {
  const usageEvents = [];
  return { usageEvents, recordUsageEvent: (ev) => usageEvents.push(ev) };
}

// Die DREI Geld-Legs einer Provisionierung teilen sich EINE Quelle (holdAmountForCountry).
// Bisher belegen das zwei benachbarte Tests getrennt (Drain reicht durch / Ledger nutzt
// dieselbe Funktion); die INVARIANTE "Hold == Capture == number_month-costCents" steht
// nirgends als EINE Assertion - genau daran driftete R3 (Capture-Mismatch).
test("GAP-11: Hold, Capture und der number_month-Beleg tragen denselben Betrag (eine Quelle)", async () => {
  const country = "DE";
  const { s, numberId } = seedRequested(country);
  setTenantStripe(s, TENANT_ID, { customerId: "cus_gap11", paymentMethodId: "pm_gap11" });
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner();
  const billing = fakeSetupFeeBilling();
  enqueueProvision(queue, s, numberId);

  await drainWithGeo(queue, s, { provisioner: prov, billing }, DEFAULT_HOLD);

  const number = findNumber(s, numberId);
  assert.equal(number.status, NUMBER_STATUS.ACTIVE, "Vorbedingung: die Nummer wurde aktiviert");
  // Spiegel des Produktionspfads: der Orchestrator ruft metering.recordNumberMonthMeter mit
  // GENAU dieser frisch aktivierten Nummer (src/worker/provisioning-orchestrator.js).
  const meteringStore = fakeMeteringStore();
  makeMetering({
    store: meteringStore,
    config: withConfigNamespaces({ numberSetupFeeCents: DEFAULT_HOLD }),
  }).recordNumberMonthMeter(number);

  const erwartet = holdAmountForCountry(country, DEFAULT_HOLD);
  const belege = meteringStore.usageEvents.filter((e) => e.kind === USAGE_EVENT_KIND.NUMBER_MONTH);
  assert.deepEqual(billing.holdAmounts, [erwartet], "gehalten wurde der Laender-Setup-Tarif");
  assert.deepEqual(billing.captureAmounts, [erwartet], "eingezogen wurde derselbe Betrag");
  assert.equal(belege.length, 1, "genau ein number_month-Beleg");
  assert.equal(belege[0].costCents, erwartet, "und das Ledger bucht denselben Betrag");
});
