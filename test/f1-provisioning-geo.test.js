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
  CENTS_PER_EUR,
  MICRO_CENTS_PER_CENT,
  NUMBER_STATUS,
  PROVIDER_RATE_SCALE,
  PROVISION_NUMBER_JOB,
  PROVISIONING_JOB_STATUS,
  USAGE_EVENT_KIND,
} from "../src/store/defaults.js";

const CAPS = { maxNumbers: 5, maxNumbersPerTenant: 1 };
// Der Default-Tenant der Fixturen dieser Datei (seedRequested, GAP-11). DID-19 stellt ihm
// einen zweiten Tenant zur Seite.
const TENANT_ID = "t_user1";

// Die Laender, in denen heute tatsaechlich gekauft wird: DE ist der
// provisioningCountry-Fallback, FR/GB/US sind die Tabellen-Eintraege, US zusaetzlich das
// LIVE gesetzte FORCE_NUMBER_COUNTRY-Kaufland (tasks/i18n-tests/13-live-env-befund.md).
// Die Liste steht bewusst hier im Test: COUNTRY_SEARCH_PARAMS ist modul-privat, ein
// Zugriff darauf braeche die Kapselung von provisioning-geo.js. EINE Liste fuer beide
// Achsen (DID-09 Suchparameter / GAP-11 Hold), deshalb ganz oben (G5/G10).
const ACTIVE_PURCHASE_COUNTRIES = Object.freeze(["DE", "FR", "GB", "US"]);

// Registriert den Tenant und fragt EINE Nummer an -> numberId. EINE Quelle fuer die
// Einzel- (seedRequested) UND die Zwei-Laender-Fixture von DID-19 (G5).
function requestFor(s, tenantId, country) {
  registerTenant(s, tenantId);
  return requestNumber(s, { tenantId, country, ...CAPS }).number.id;
}

// Seedet eine 'requested' Number des Default-Tenants mit explizitem Land (Default DE).
function seedRequested(country = "DE") {
  const s = makeDefaultState();
  return { s, numberId: requestFor(s, TENANT_ID, country) };
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
  // tenantId aus dem Number-Record statt aus der Datei-Konstante: die DID-19-Fixture
  // provisioniert zwei Nummern ZWEIER Tenants ueber denselben Helfer (kein 4. Argument, F1).
  recordProvisioningJob(s, { numberId, tenantId: findNumber(s, numberId).tenantId, idempotencyKey });
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

// DID-05 (06-nummern-provisioning.md): reale Zielmaerkte OHNE Tabellen-Eintrag. Bewusst
// gegen das jeweilige Land formuliert, NICHT gegen den Literalwert "DE": der Fallback ist
// config.provisioning.provisioningCountry (Env-abhaengig, Baseline 1.1).
const LAENDER_OHNE_EINTRAG = Object.freeze(["CA", "IE", "AU", "CH", "AT", "ES", "IT"]);

test("DID-05 (SOLL, rot) - reale Laender ohne Tabellen-Eintrag kaufen im eigenen Land, nicht still im Provisioning-Default", () => {
  const stillUmgeleitet = LAENDER_OHNE_EINTRAG.filter((c) => searchParamsForCountry(c).countryCode !== c);
  assert.deepEqual(
    stillUmgeleitet,
    [],
    `diese Laender fallen unmarkiert auf ${config.provisioning.provisioningCountry} zurueck - ` +
      `ein Kunde aus diesen Laendern bekommt eine auslaendische Rufnummer, ohne dass es irgendwo auffaellt`,
  );
});

// DID-09 (06-nummern-provisioning.md): ohne expliziten Typ entscheidet der Provider-Default,
// WELCHE Nummernart gekauft wird. Die Luecke sitzt in der TABELLE, nicht im Adapter - die
// Gegenprobe dazu steht als gruener Mechanismus-Test in test/telnyx-numbers.test.js.
test("DID-09 (SOLL, rot) - jedes bespielte Kauf-Land waehlt seinen phone_number_type explizit", () => {
  const ohneTyp = ACTIVE_PURCHASE_COUNTRIES.filter((c) => searchParamsForCountry(c).type === undefined);
  assert.deepEqual(
    ohneTyp,
    [],
    "ohne filter[phone_number_type] entscheidet der Telnyx-Default, welche Nummernart gekauft wird - " +
      "in den USA ist das der Unterschied zwischen local, toll-free und mobile",
  );
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
//
// DID-11 (Buchhaltung, 06-nummern-provisioning.md): "holdAmountForCountry liefert fuer
// US/FR/GB/DE identischen Betrag" ist die Vereinigung der drei Bloecke darueber
// (DE ohne Eintrag, FR/GB ohne eigenen Tarif, unbekannt/leer) mit diesem PAY-17-Block
// (US == DE gegen ZWEI Sentinels). Ein vierter Test waere dieselbe Assertion (G5).
test("PAY-17: holdAmountForCountry liefert fuer US denselben Betrag wie fuer DE (kein eigener US-Preis)", () => {
  assert.equal(holdAmountForCountry("US", SENTINEL_HOLD_A), holdAmountForCountry("DE", SENTINEL_HOLD_A));
  assert.equal(
    holdAmountForCountry("US", SENTINEL_HOLD_B),
    SENTINEL_HOLD_B,
    "US traegt keinen eigenen Tarif - der Wert stammt zu 100 % vom Aufrufer-Default",
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

// DID-19: der Idempotency-Key haengt an der numberId (src/onboarding.js: `order_${numberId}`),
// NICHT am Land. Waere er land-abgeleitet, bekaeme bei zwei gleichzeitig laufenden
// Provisionierungen der zweite Tenant per Telnyx-Idempotenz die Nummer des ersten
// zurueck. Der Memory-Adapter drainet vertragsgemaess sequentiell - "gleichzeitig"
// heisst hier deshalb: ZWEI Nummern gleichzeitig in Arbeit, nicht zwei Drains.
const TENANT_ID_B = "t_user2";
const E164_JE_LAND = Object.freeze({ US: "+12025550123", FR: "+33123456789" });

test("DID-19 (Mechanismus, gruen) - zwei Laender in einem Lauf bekommen getrennte, number-id-gebundene Idempotency-Keys", async () => {
  const s = makeDefaultState();
  const usId = requestFor(s, TENANT_ID, "US");
  const frId = requestFor(s, TENANT_ID_B, "FR");
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner({
    async searchNumbers({ countryCode }) {
      return [{ e164: E164_JE_LAND[countryCode] }];
    },
  });
  enqueueProvision(queue, s, usId);
  enqueueProvision(queue, s, frId);

  await drainWithGeo(queue, s, { provisioner: prov });

  const keys = prov.orderCalls.map((c) => c.idempotencyKey);
  assert.equal(new Set(keys).size, 2, "zwei Nummern -> zwei verschiedene Schluessel (keine Land-Kollision)");
  for (const id of [usId, frId]) {
    assert.ok(
      keys.some((k) => k.includes(id)),
      `Schluessel traegt die numberId ${id}`,
    );
    assert.equal(findNumber(s, id).status, NUMBER_STATUS.ACTIVE);
  }
  assert.deepEqual(
    prov.orderCalls.map((c) => c.e164).sort(),
    [E164_JE_LAND.FR, E164_JE_LAND.US].sort(),
    "jede Nummer wurde in IHREM Land gekauft",
  );
  assert.equal(await drainWithGeo(queue, s, { provisioner: prov }), 0, "zweiter Drain kauft nichts nach");
  assert.equal(prov.orderCalls.length, 2, "genau EIN Kauf je Nummer");
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

// Spiegel des Produktionspfads: der Orchestrator ruft metering.recordNumberMonthMeter mit
// GENAU der frisch aktivierten Nummer und seiner Uhr (src/worker/provisioning-
// orchestrator.js). Liefert die entstandenen number_month-Belege - EINE Quelle fuer beide
// GAP-11-Haelften (ohne / mit gelerntem Preis), damit sie nicht auseinanderdriften (G5).
function numberMonthBelege(number) {
  const usageEvents = [];
  makeMetering({ store: { recordUsageEvent: (ev) => usageEvents.push(ev) } }).recordNumberMonthMeter(
    number,
    new Date().toISOString(),
  );
  return usageEvents.filter((e) => e.kind === USAGE_EVENT_KIND.NUMBER_MONTH);
}

// Die DREI Geld-Legs einer Provisionierung teilen sich EINE Quelle (holdAmountForCountry).
// Bisher belegen das zwei benachbarte Tests getrennt (Drain reicht durch / Ledger nutzt
// dieselbe Funktion); die INVARIANTE "Hold == Capture == number_month-costCents" steht
// nirgends als EINE Assertion - genau daran driftete R3 (Capture-Mismatch).
test("GAP-11: Hold und Capture tragen denselben Betrag (eine Quelle) und ohne gelernten Preis entsteht KEIN Beleg (fail-closed)", async () => {
  const country = "DE";
  const { s, numberId } = seedRequested(country);
  setTenantStripe(s, TENANT_ID, {
    customerId: "cus_gap11",
    paymentMethodId: "pm_gap11",
    paymentMethodType: "card", // GP-P2: Eignungs-Gate laesst nur hold-faehige Typen durch
  });
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner();
  const billing = fakeSetupFeeBilling();
  enqueueProvision(queue, s, numberId);

  await drainWithGeo(queue, s, { provisioner: prov, billing }, DEFAULT_HOLD);

  const number = findNumber(s, numberId);
  assert.equal(number.status, NUMBER_STATUS.ACTIVE, "Vorbedingung: die Nummer wurde aktiviert");
  const erwartet = holdAmountForCountry(country, DEFAULT_HOLD);
  assert.deepEqual(billing.holdAmounts, [erwartet], "gehalten wurde der Laender-Setup-Tarif");
  assert.deepEqual(billing.captureAmounts, [erwartet], "eingezogen wurde derselbe Betrag");
  // Die Beleg-Haelfte (P5/GAP-06): die Fixture kauft OHNE cost_information, es wurde also
  // kein Provider-Preis gelernt. Die Einrichtungsgebuehr ist ausdruecklich KEIN
  // Miet-Fallback (sonst zahlte jede Bestandsnummer sie monatlich als "Miete") -> kein
  // Beleg. Der Fall MIT gelerntem Preis steht im GAP-11-(b)-Block darunter.
  assert.deepEqual(
    numberMonthBelege(number),
    [],
    "ohne gelernten Preis wird nicht gebucht (fail-closed)",
  );
});

// ---- GAP-11 (b, neu gefasst): der Hold traegt den LIVE-Preis der Provider-Antwort ----
// (Owner-Entscheidung 2026-07-27: nichts Hartkodiertes - der Preis wird beim Provider
// angefragt. Die Laender-Tabelle bleibt die Ausnahme, der Live-Preis schlaegt sie.)

// Ein Einmalpreis von genau EINER Waehrungseinheit (z.B. 1,00 USD) in der Einheit des
// Ports: GANZZAHL Mikro-Cent der PROVIDER-Waehrung.
const ONE_CURRENCY_UNIT_MICRO_CENTS = CENTS_PER_EUR * MICRO_CENTS_PER_CENT;

// Erwarteter Bucket-Betrag, UNABHAENGIG von der Produktionsfunktion hergeleitet (Betrag
// mal Kurs, aufgerundet auf ganze Bucket-Cent) - sonst pruefte der Test die
// Implementierung gegen sich selbst.
function erwarteterBucketBetrag(providerMicroCents) {
  return Math.ceil(
    (providerMicroCents * config.billing.providerToBucketRateMicro) /
      (MICRO_CENTS_PER_CENT * PROVIDER_RATE_SCALE),
  );
}

// Provider-Preis, wie ihn der Telnyx-Adapter aus cost_information baut. Abweichungen
// (fremde Waehrung, Preis 0) kommen als overrides.
function providerPrice(overrides = {}) {
  return {
    upfrontMicroCents: ONE_CURRENCY_UNIT_MICRO_CENTS,
    monthlyMicroCents: ONE_CURRENCY_UNIT_MICRO_CENTS,
    currency: config.billing.providerCurrency,
    ...overrides,
  };
}

// Build-Operate (P13): provisioniert EINE DE-Nummer im Geld-Pfad, deren Such-Antwort
// den uebergebenen Provider-Preis traegt (price=null -> Antwort ohne Preis, Bestandsform).
async function provisionWithProviderPrice(price) {
  const { s, numberId } = seedRequested("DE");
  setTenantStripe(s, TENANT_ID, {
    customerId: "cus_p4",
    paymentMethodId: "pm_p4",
    paymentMethodType: "card", // GP-P2: Eignungs-Gate laesst nur hold-faehige Typen durch
  });
  const queue = makeMemoryQueue();
  const prov = fakeProvisioner({
    async searchNumbers() {
      const available = { e164: "+4915799990001" };
      if (price) available.price = price;
      return [available];
    },
  });
  const billing = fakeSetupFeeBilling();
  enqueueProvision(queue, s, numberId);

  await drainWithGeo(queue, s, { provisioner: prov, billing }, DEFAULT_HOLD);

  return { billing, number: findNumber(s, numberId) };
}

test("GAP-11: der Hold traegt den Preis aus der Provider-Antwort, nicht die Pauschale", async () => {
  const erwartet = erwarteterBucketBetrag(ONE_CURRENCY_UNIT_MICRO_CENTS);
  assert.notEqual(erwartet, DEFAULT_HOLD, "Vorbedingung: Live-Preis != Pauschale (sonst prueft der Test nichts)");

  const { billing, number } = await provisionWithProviderPrice(providerPrice());

  assert.equal(number.status, NUMBER_STATUS.ACTIVE, "Vorbedingung: die Nummer wurde aktiviert");
  assert.deepEqual(billing.holdAmounts, [erwartet], "gehalten wurde der angefragte Provider-Preis");
  assert.deepEqual(billing.captureAmounts, [erwartet], "eingezogen wurde derselbe Betrag (R3)");
});

test("Fallback: Antwort ohne Preis -> Pauschale (Bestandsverhalten)", async () => {
  const { billing, number } = await provisionWithProviderPrice(null);

  assert.equal(number.status, NUMBER_STATUS.ACTIVE);
  assert.deepEqual(billing.holdAmounts, [DEFAULT_HOLD], "ohne cost_information gilt die Pauschale");
  assert.ok(!("monthlyCostCents" in number), "kein Preis gelernt -> Feld bleibt ABWESEND, nicht 0");
});

test("Fallback: fremde Waehrung im Provider-Preis -> Pauschale, NIE umgerechnet", async () => {
  // Per Konstruktion eine ANDERE Waehrung als die konfigurierte (kein Literal, das eine
  // Env-Aenderung stillschweigend gueltig machen koennte).
  const fremd = `${config.billing.providerCurrency}X`;
  const { billing } = await provisionWithProviderPrice(providerPrice({ currency: fremd }));

  assert.deepEqual(billing.holdAmounts, [DEFAULT_HOLD], "fremde Waehrung wird verworfen, nicht umgerechnet");
});

test("Fallback: Provider-Preis 0 -> Pauschale (ein Hold ueber 0 ist kein Hold)", async () => {
  const { billing } = await provisionWithProviderPrice(providerPrice({ upfrontMicroCents: 0 }));

  assert.deepEqual(billing.holdAmounts, [DEFAULT_HOLD], "0 waere ein von Stripe abgelehnter Hold");
});

test("monthlyCostCents wird am aktivierten Nummern-Datensatz persistiert (Uebergabe an P5)", async () => {
  const { number } = await provisionWithProviderPrice(providerPrice());

  assert.equal(
    number.monthlyCostCents,
    erwarteterBucketBetrag(ONE_CURRENCY_UNIT_MICRO_CENTS),
    "die Monatsmiete aus derselben Antwort steht am Datensatz",
  );
});

test("GAP-11: mit gelerntem Preis traegt der number_month-Beleg genau diesen Preis, waehrend Hold und Capture weiter aus einer Quelle kommen", async () => {
  const erwartet = erwarteterBucketBetrag(ONE_CURRENCY_UNIT_MICRO_CENTS);

  const { billing, number } = await provisionWithProviderPrice(providerPrice());

  // Die Anti-Drift-Zusage (R3) bleibt: Hold == Capture, weiterhin aus EINER Quelle.
  assert.deepEqual(billing.holdAmounts, [erwartet], "gehalten wurde der Provider-Preis");
  assert.deepEqual(billing.captureAmounts, [erwartet], "eingezogen wurde derselbe Betrag");

  const belege = numberMonthBelege(number);
  assert.equal(belege.length, 1, "genau ein number_month-Beleg");
  assert.equal(
    belege[0].costCents,
    number.monthlyCostCents,
    "das Ledger bucht die gelernte MIETE (nicht die Einrichtungsgebuehr)",
  );
  assert.equal(belege[0].numberId, number.id, "der Beleg identifiziert die Nummer (Idempotenz-Anker)");
});
