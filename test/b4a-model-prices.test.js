import { test } from "node:test";
import assert from "node:assert/strict";
import { config, resolveModelPrices } from "../src/config.js";
import { modelPriceScheduleBannerLine } from "../src/boot.js";
import { stalePriceFindings, MODEL_PRICE_MAX_AGE_DAYS } from "../src/boot-guard.js";
import { MODEL_PRICE_RATE_FIELDS } from "../src/store/defaults.js";

const HAIKU = "claude-haiku-4-5";
const SONNET = "claude-sonnet-5";
const SOURCE = "https://example.invalid/pricing.md";
const ANCHOR_DAY = "2026-08-08";
const LAST_DAY_OLD_RATE = "2026-08-31";
const SWITCH_DAY = "2026-09-01";
const MS_PER_DAY = 86_400_000;

function entry(overrides = {}) {
  return {
    validFrom: ANCHOR_DAY,
    inPerMTok: 1.0,
    cacheWritePerMTok: 1.25,
    cacheReadPerMTok: 0.1,
    outPerMTok: 5.0,
    asOf: ANCHOR_DAY,
    source: SOURCE,
    ...overrides,
  };
}

const SCHEDULES = Object.freeze({
  [HAIKU]: [entry()],
  [SONNET]: [
    entry({ inPerMTok: 2.0, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2, outPerMTok: 10.0 }),
    entry({
      validFrom: SWITCH_DAY,
      inPerMTok: 3.0,
      cacheWritePerMTok: 3.75,
      cacheReadPerMTok: 0.3,
      outPerMTok: 15.0,
    }),
  ],
});

const ratesOf = (price) => MODEL_PRICE_RATE_FIELDS.map((field) => price[field]);

test("B4A-RES-1: am Ankertag gelten die ANKER-Staffeln beider Modelle (vier Raten je Modell)", () => {
  const prices = resolveModelPrices(SCHEDULES, ANCHOR_DAY);
  assert.deepEqual(ratesOf(prices[HAIKU]), [1.0, 1.25, 0.1, 5.0]);
  assert.deepEqual(ratesOf(prices[SONNET]), [2.0, 2.5, 0.2, 10.0]);
});

test("B4A-RES-2: die terminierte Umschaltung ist BEWIESEN - am 31.08. die alte, am 01.09. die neue Staffel", () => {
  assert.deepEqual(
    ratesOf(resolveModelPrices(SCHEDULES, LAST_DAY_OLD_RATE)[SONNET]),
    [2.0, 2.5, 0.2, 10.0],
    "bis einschliesslich 31.08. gilt die Anker-Staffel",
  );
  const afterSwitch = resolveModelPrices(SCHEDULES, SWITCH_DAY)[SONNET];
  assert.deepEqual(ratesOf(afterSwitch), [3.0, 3.75, 0.3, 15.0]);
  assert.equal(afterSwitch.nextValidFrom, null, "danach ist keine weitere Staffel hinterlegt");
});

test("B4A-RES-3: nextValidFrom ist die Datenquelle der Banner-Zeile (Diagnose, kein Rechner liest sie)", () => {
  const prices = resolveModelPrices(SCHEDULES, ANCHOR_DAY);
  assert.equal(prices[SONNET].nextValidFrom, SWITCH_DAY);
  assert.equal(prices[HAIKU].nextValidFrom, null);
});

test("B4A-RES-4: eine fehlende Rate wirft benannt - Modell-ID UND Feldname stehen in der Meldung", () => {
  const broken = { ...entry() };
  delete broken.cacheWritePerMTok;
  assert.throws(
    () => resolveModelPrices({ [HAIKU]: [broken] }, ANCHOR_DAY),
    (err) =>
      err.message.includes(HAIKU) &&
      err.message.includes("cacheWritePerMTok") &&
      err.message.includes("vier Raten sind Pflicht"),
  );
});

test("B4A-RES-5: NaN / negativ / String als Rate wirft je Fall (T5-Raender)", () => {
  for (const rate of [NaN, -1, "1.0", Infinity, null]) {
    assert.throws(
      () => resolveModelPrices({ [HAIKU]: [entry({ inPerMTok: rate })] }, ANCHOR_DAY),
      /keine gueltige Rate inPerMTok/,
      `Rate ${String(rate)} muss den Boot abbrechen - sonst rechnet tokenCostUsd NaN`,
    );
  }
  assert.throws(
    () => resolveModelPrices({ [HAIKU]: [entry({ validFrom: "08.08.2026" })] }, ANCHOR_DAY),
    /ohne gueltiges validFrom/,
    "ein formfremdes validFrom bricht ebenfalls ab (der String-Vergleich waere sonst sinnlos)",
  );
});

test("B4A-RES-6: keine faellige Staffel (alles in der Zukunft bzw. leeres Array) wirft benannt", () => {
  assert.throws(
    () => resolveModelPrices({ [HAIKU]: [entry({ validFrom: SWITCH_DAY })] }, ANCHOR_DAY),
    /keine gueltige Preisstaffel/,
  );
  assert.throws(
    () => resolveModelPrices({ [HAIKU]: [] }, ANCHOR_DAY),
    /keine gueltige Preisstaffel/,
  );
});

test("B4A-RES-7: eine LEERE Staffel-Tabelle wirft benannt (Preis 0 waere fail-open, Regel 1)", () => {
  assert.throws(() => resolveModelPrices({}, ANCHOR_DAY), /keine Preisstaffel hinterlegt/);
});

test("B4A-RES-8: ein hinterlegtes, nirgends konfiguriertes Modell ist KEIN Ausloeser (N-1)", () => {
  const prices = resolveModelPrices(
    { ...SCHEDULES, "modell-das-niemand-faehrt": [entry()] },
    ANCHOR_DAY,
  );
  assert.equal(prices["modell-das-niemand-faehrt"].inPerMTok, 1.0, "der Eintrag ist einfach da");
  assert.equal(Object.keys(prices).length, 3);
});

test("B4A-RES-9: absteigend notierte Staffeln liefern dieselbe Auswahl wie aufsteigende (keine Sortier-Konvention)", () => {
  const descending = { [SONNET]: [...SCHEDULES[SONNET]].reverse() };
  assert.deepEqual(
    ratesOf(resolveModelPrices(descending, ANCHOR_DAY)[SONNET]),
    ratesOf(resolveModelPrices(SCHEDULES, ANCHOR_DAY)[SONNET]),
  );
});

test("B4A-TAB-1: jeder ausgelieferte Eintrag traegt alle vier Raten endlich und >= 0, plus asOf/source/validFrom", () => {
  const prices = config.llm.modelPricesUsd;
  const ids = Object.keys(prices);
  assert.ok(ids.length > 0, "ohne Eintrag gibt es keine Preisquelle fuer den Budget-Guard");
  for (const id of ids) {
    const price = prices[id];
    for (const field of MODEL_PRICE_RATE_FIELDS)
      assert.ok(
        Number.isFinite(price[field]) && price[field] >= 0,
        `${id}.${field} muss eine endliche, nicht negative Rate sein (sonst NaN am Gate)`,
      );
    assert.equal(typeof price.validFrom, "string");
    assert.equal(typeof price.asOf, "string");
    assert.ok(price.source.length > 0, `${id} ohne Quellenangabe waere eine Zahl ohne Beleg`);
  }
});

test("B4A-TAB-2: die AUFGELOESTE Tabelle ist NICHT eingefroren (guardedConfig-Proxy-Falle)", () => {
  assert.equal(
    Object.isFrozen(config.llm.modelPricesUsd),
    false,
    "Object.freeze am Blatt liesse guardedConfig bei JEDEM Zugriff TypeError werfen",
  );
  assert.doesNotThrow(() => config.llm.modelPricesUsd[config.llm.claudeModel].inPerMTok);
});

test("B4A-BAN-1: die Banner-Zeile nennt je konfiguriertem Modell die gewaehlte und die naechste validFrom", () => {
  const line = modelPriceScheduleBannerLine({
    claudeModel: HAIKU,
    briefingModel: SONNET,
    modelPricesUsd: resolveModelPrices(SCHEDULES, ANCHOR_DAY),
  });
  assert.equal(
    line,
    `Preisstaffeln: ${HAIKU} ab ${ANCHOR_DAY} (naechste: keine) | ${SONNET} ab ${ANCHOR_DAY} (naechste: ${SWITCH_DAY})`,
  );
});

const STALE_PRICES = { [HAIKU]: { asOf: ANCHOR_DAY, source: SOURCE } };
const daysAfterAnchor = (days) =>
  new Date(Date.parse(ANCHOR_DAY) + days * MS_PER_DAY).toISOString().slice(0, ANCHOR_DAY.length);

test("B4A-STALE-1: eine Preisliste aelter als die Hoechstdauer erzeugt GENAU EINEN nicht-fatalen Befund", () => {
  const findings = stalePriceFindings(STALE_PRICES, daysAfterAnchor(MODEL_PRICE_MAX_AGE_DAYS + 1));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].fatal, false, "ein Kalendertag darf die Telefonie nicht lahmlegen");
  assert.ok(findings[0].message.includes(HAIKU) && findings[0].message.includes(SOURCE));
});

test("B4A-STALE-2: einen Tag VOR der Hoechstdauer schweigt der Guard (T5-Rand)", () => {
  assert.deepEqual(
    stalePriceFindings(STALE_PRICES, daysAfterAnchor(MODEL_PRICE_MAX_AGE_DAYS - 1)),
    [],
  );
});
