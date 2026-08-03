// P5 Herkunfts-Achse der Tarifierung (Katalog-IDs ORIG-01/02/03, umgesetzt statt SOLL-rot).
// Der Tarif verzweigt nicht mehr allein am Ziel, sondern am LEG: Inlandssatz nur, wenn Ziel
// UND Absender dieselbe bekannte Inlands-Vorwahl tragen.
//
// Die Katalog-IDs stehen bewusst IM Namensrumpf (nicht am Namensanfang): so treffen die
// Tests das Katalogmuster NICHT und laufen in der Regressionssuite (npm test), wie es
// Auflage A3 fuer gruen gewordene Katalogtests vorsieht. Die Rueckverfolgbarkeit bleibt
// per grep auf "ORIG-0x" erhalten.
//
// W2-B3 (2026-07-26): der OUT-12-Test unten traegt seine Katalog-ID am NAMENSANFANG und
// laeuft damit im Gate-Lauf (npm run test:gates) - so schreibt es Regel R-B der Welle W2
// vor (tasks/i18n-tests/18-w2-scope.md). Der aeltere ORIG-Block darueber behaelt seine
// mittigen IDs und bleibt im Regressionslauf; beide Konventionen stehen bewusst nebeneinander.
//
// Offline, Fake-Store nach dem Muster test/metering-unit.test.js: kein Spawn, keine DB,
// kein Netz (P12 F.I.R.S.T.).
import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import { makeOutboundGates, tariffCentsPerMin } from "../src/telephony/outbound-gates.js";
import { callTariffCentsPerMin, makeMetering } from "../src/billing/metering.js";
import { RESERVE_LEAD_MINUTES, USAGE_EVENT_KIND, emptyUsage } from "../src/store/defaults.js";

const TENANT_A = "t_origin";
const DE_OWN_DID = "+4930111222333"; // eigene DID mit Inlands-Vorwahl
const US_OWN_DID = "+15005550006"; // eigene DID OHNE Inlands-Vorwahl (die ausgelieferte Default-DID)
const DE_TARGET = "+4915112345678"; // +49 steht in VOICE_TARIFF_DOMESTIC_PREFIXES
const US_TARGET = "+15551234567"; // keine Inlands-Vorwahl
const FR_TARGET = "+33612345678"; // +33 steht in VOICE_TARIFF_DOMESTIC_PREFIXES, aber != +49
const TOLL_FREE_TARGET = "+18005550123"; // 1-800: fuer den ANRUFER gebuehrenfrei, fuer uns nicht

// Faengt die Geld-Nebeneffekte auf (recordUsageEvent / addVoiceUsageCostCents), ohne Store.
function fakeStore() {
  const usageEvents = [];
  const voiceCostCents = [];
  return {
    usageEvents,
    voiceCostCents,
    recordUsageEvent(ev) {
      usageEvents.push(ev);
    },
    // KS-P5: die Fassade liefert den Usage-Bucket - reconcileVoiceBudget liest
    // daraus die Achsen-Stempel (Bucket-Brigade). Ohne Rueckgabewert wuerfe der Aufruf.
    addVoiceUsageCostCents(tenantId, costCents) {
      voiceCostCents.push({ tenantId, costCents });
      return emptyUsage();
    },
    recordCallEstimatedCostCents() {},
    // KS-P3 (b): compute_reserve liest den Guthaben-Snapshot als Eingabe der
    // guthaben-abgeleiteten Notbremse. Fuer die Satz-Aussage dieser Datei ist der Wert
    // gleichgueltig, er muss nur lesbar sein.
    tenantBudgetSnapshot: () => ({ capCents: 100000, spentCents: 0, remainingCents: 100000 }),
  };
}

// Genau 1 abgerechnete Minute, damit costCents direkt der Minutensatz ist.
function makeCall(overrides = {}) {
  return {
    id: "call_origin",
    tenantId: TENANT_A,
    direction: "outbound",
    to: DE_TARGET,
    from: US_OWN_DID,
    answeredAt: "2026-01-01T00:00:00.000Z",
    endedAt: "2026-01-01T00:01:00.000Z",
    ...overrides,
  };
}

const voiceCostOf = (store) =>
  store.usageEvents.filter((e) => e.kind === USAGE_EVENT_KIND.VOICE_MINUTE).map((e) => e.costCents);

// ---- Vorbedingung ----------------------------------------------------------------
// In-Prozess-Tests lesen das ECHTE src/config.js (also eine lokale .env). Waeren beide
// Saetze gleich, bewiese keine Assertion darunter noch etwas.
test("Vorbedingung: Inlandssatz und Default-Satz sind verschieden", () => {
  assert.notEqual(
    config.billing.voiceTariffDomesticCents,
    config.billing.voiceTariffDefaultCents,
    "ohne Unterschied zwischen den beiden Saetzen ist jede Tarif-Assertion inhaltsleer",
  );
  assert.ok(
    config.billing.voiceTariffDomesticPrefixes.includes("+49"),
    "die Fixture-Nummern setzen +49 als bekannte Inlands-Vorwahl voraus",
  );
});

// ---- ORIG-01: die Signatur -------------------------------------------------------
test("Herkunfts-Achse (ORIG-01): tariffCentsPerMin nimmt Ziel UND Herkunft entgegen", () => {
  assert.equal(
    tariffCentsPerMin.length,
    2,
    "zwei Positionsstellen (Ziel, Herkunft) - ein Objekt-Parameter haette length === 1",
  );
});

test("Inland nur bei GLEICHER bekannter Inlands-Vorwahl an beiden Enden", () => {
  const domestic = config.billing.voiceTariffDomesticCents;
  const abroad = config.billing.voiceTariffDefaultCents;
  assert.equal(tariffCentsPerMin(DE_TARGET, DE_OWN_DID), domestic, "+49 -> +49 ist Inland");
  assert.equal(tariffCentsPerMin(DE_TARGET, US_OWN_DID), abroad, "+1 -> +49 ist Ausland");
  assert.equal(tariffCentsPerMin(US_TARGET, DE_OWN_DID), abroad, "+49 -> +1 ist Ausland");
  assert.equal(
    tariffCentsPerMin(FR_TARGET, DE_OWN_DID),
    abroad,
    "zwei VERSCHIEDENE bekannte Inlands-Vorwahlen sind kein Inlands-Leg",
  );
  assert.equal(
    tariffCentsPerMin(US_TARGET, US_OWN_DID),
    abroad,
    "gleiches Land OHNE gemessenen Inlandssatz (+1) bleibt Ausland - der guenstige Satz ist " +
      "fuer +49/+33/+44 erhoben, nicht fuer 'irgendwo gleich'",
  );
});

test("fail-closed: fehlende/unbrauchbare Herkunft -> teuerster Satz", () => {
  const abroad = config.billing.voiceTariffDefaultCents;
  assert.equal(tariffCentsPerMin(DE_TARGET, undefined), abroad);
  assert.equal(tariffCentsPerMin(DE_TARGET, null), abroad);
  assert.equal(
    tariffCentsPerMin(DE_TARGET),
    abroad,
    "vergessenes Argument ergibt nie den Inlandssatz",
  );
});

// OUT-12 (Charakterisierung, gruen): eine Toll-Free-Nummer bekommt KEINE Sonderbehandlung -
// +1 steht in keiner Inlands-Vorwahlliste, also gilt der Worst-Case-Satz. Bewusst OHNE
// roten SOLL-Zwilling (Abweichung zur R1-Regel der kanonischen Liste, begruendet): "fail-safe
// teuer statt fail-open billig" ist die getroffene Produktentscheidung derselben Achse (PAY-22);
// ein guenstigerer Toll-Free-Satz waere ein erfundenes Soll, solange kein Satz GEMESSEN ist.
// Der Test faengt genau die gefaehrliche Richtung: ein stiller Kipp auf den billigen Satz.
test("OUT-12 (Charakterisierung, gruen) - Toll-Free-Ziele werden zum Worst-Case-Tarif gerechnet, wie jedes andere +1-Ziel", () => {
  const abroad = config.billing.voiceTariffDefaultCents;
  assert.equal(tariffCentsPerMin(TOLL_FREE_TARGET, DE_OWN_DID), abroad);
  assert.equal(tariffCentsPerMin(TOLL_FREE_TARGET, US_OWN_DID), abroad);
  assert.equal(
    tariffCentsPerMin(TOLL_FREE_TARGET, US_OWN_DID),
    tariffCentsPerMin(US_TARGET, US_OWN_DID),
    "keine Toll-Free-Sonderbehandlung gegenueber einer gewoehnlichen US-Nummer",
  );
});

// PAY-22: die ZIEL-Achse desselben Praedikats. Der fail-closed-Test darueber deckt die
// HERKUNFT ab (from fehlt/unbrauchbar); leer/unbekannt am ZIEL ist der zweite Weg in
// denselben Zweig und bisher ungepinnt. Fail-safe teuer statt fail-open billig - die
// gefaehrliche Richtung waere ein stiller Kipp auf den Inlandssatz. Dass beide Saetze
// ueberhaupt verschieden sind, sichert der Vorbedingungs-Test am Dateikopf (G5).
test("PAY-22: leere/unbekannte Zielvorwahl faellt auf den teuren Default-Tarif", () => {
  const abroad = config.billing.voiceTariffDefaultCents;
  assert.equal(tariffCentsPerMin("", DE_OWN_DID), abroad, "leeres Ziel");
  assert.equal(tariffCentsPerMin("+999", DE_OWN_DID), abroad, "erfundene Vorwahl");
  assert.equal(tariffCentsPerMin(undefined, DE_OWN_DID), abroad, "fehlendes Ziel");
});

// ---- ORIG-02: Buchung outbound ---------------------------------------------------
test("Herkunfts-Achse (ORIG-02): DE-Ziel von einer US-DID bucht den Auslandssatz", () => {
  const store = fakeStore();
  const { recordVoiceMinuteMeter } = makeMetering({ store, config });
  recordVoiceMinuteMeter(makeCall({ to: DE_TARGET, from: US_OWN_DID }));
  assert.deepEqual(voiceCostOf(store), [config.billing.voiceTariffDefaultCents]);
});

test("DE-Ziel von einer DE-DID bucht den Inlandssatz", () => {
  const store = fakeStore();
  const { recordVoiceMinuteMeter } = makeMetering({ store, config });
  recordVoiceMinuteMeter(makeCall({ to: DE_TARGET, from: DE_OWN_DID }));
  assert.deepEqual(voiceCostOf(store), [config.billing.voiceTariffDomesticCents]);
});

// ---- ORIG-03: Inbound hat kein gewaehltes Ziel -----------------------------------
// PAY-09 (Buchhaltung, kein eigener Test): "recordVoiceMinuteMeter bucht Inbound mit dem
// kalibrierten Inbound-Satz, unabhaengig vom Land der eigenen DID" ist woertlich die
// Aussage des Tests direkt darunter. Ein zweiter Test waere ein Duplikat (G5); die
// Katalog-ID steht deshalb hier und nicht im Testnamen - der Test bleibt damit im
// Regressionslauf.
//
// KV-P2: vormals zwei Tests (US-DID -> Default-Satz, DE-DID -> Inlandssatz), zu EINEM
// zusammengefuehrt - die Herkunfts-Achse bepreist ein GEWAEHLTES Ziel, und ein Inbound-Leg
// hat keins. Die alte Regel war eine Notloesung, die an einer US-DID den Auslands-
// Worst-Case zog (16-fach ueber dem an KV-M1 gemessenen Ist). Beide Fixtures bleiben, mit
// DERSELBEN Erwartung: das Land der eigenen DID darf das Ergebnis nicht mehr aendern.
test("Herkunfts-Achse (ORIG-03): Inbound bucht den kalibrierten Inbound-Satz - unabhaengig vom Land der eigenen DID", () => {
  const storeUs = fakeStore();
  makeMetering({ store: storeUs, config }).recordVoiceMinuteMeter(
    makeCall({ direction: "inbound", to: US_OWN_DID, from: DE_TARGET }),
  );
  assert.deepEqual(
    voiceCostOf(storeUs),
    [config.billing.voiceTariffInboundCents],
    "US-DID: kein Auslands-Worst-Case mehr fuer Inbound",
  );

  const storeDe = fakeStore();
  makeMetering({ store: storeDe, config }).recordVoiceMinuteMeter(
    makeCall({ direction: "inbound", to: DE_OWN_DID, from: US_TARGET }),
  );
  assert.deepEqual(
    voiceCostOf(storeDe),
    [config.billing.voiceTariffInboundCents],
    "DE-DID: derselbe Inbound-Satz, kein Inlandsrabatt mehr ueber die eigene DID",
  );
});

// ---- Reserve und Buchung teilen den Satz -----------------------------------------
test("Reserve und Buchung rechnen dieselbe Konstellation mit demselben Satz", async () => {
  const store = fakeStore();
  const { gates } = makeOutboundGates({ store, config });
  const computeReserve = gates.find((g) => g.name === "compute_reserve");
  assert.ok(computeReserve, "compute_reserve-Gate existiert");

  const ctx = { b: {}, to: DE_TARGET, fromNumber: US_OWN_DID, tenantId: "t_origin" };
  await computeReserve.run(ctx);
  // KS-P3 (a): die Reserve ist Satz * RESERVE_LEAD_MINUTES - der Minutensatz faellt aus
  // dem Vorlauffenster heraus, nicht mehr aus der Gespraechsdauer.
  const reservedPerMinute = ctx.reserveCents / RESERVE_LEAD_MINUTES;

  const { reconcileVoiceBudget } = makeMetering({ store, config });
  reconcileVoiceBudget(makeCall({ to: DE_TARGET, from: US_OWN_DID }));
  const [booked] = store.voiceCostCents;

  assert.equal(
    reservedPerMinute,
    config.billing.voiceTariffDefaultCents,
    "die Reserve sieht die Herkunft",
  );
  assert.equal(
    booked.costCents,
    reservedPerMinute,
    "reserviert und gebucht wird derselbe Minutensatz",
  );
});

// ---- Richtungs-Weiche ------------------------------------------------------------
test("callTariffCentsPerMin: outbound tarifiert das Leg, inbound den kalibrierten Satz", () => {
  assert.equal(
    callTariffCentsPerMin({ direction: "outbound", to: DE_TARGET, from: DE_OWN_DID }),
    config.billing.voiceTariffDomesticCents,
    "outbound: die eigene DID steht in call.from, der Satz haengt am Leg",
  );
  assert.equal(
    callTariffCentsPerMin({ direction: "inbound", to: DE_OWN_DID, from: US_TARGET }),
    config.billing.voiceTariffInboundCents,
    "inbound: kein gewaehltes Ziel - der kalibrierte Inbound-Satz gilt, unabhaengig von to/from",
  );
});
