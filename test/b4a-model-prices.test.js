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

test("[NIE1] eine Preisstaffel ist erst ab dem 91. Tag veraltet, nicht frueher und nicht spaeter", () => {
  assert.equal(MODEL_PRICE_MAX_AGE_DAYS, 90);
  assert.deepEqual(
    stalePriceFindings(STALE_PRICES, "2026-11-06"),
    [],
    "Tag 90 nach dem Anker schweigt",
  );
  assert.equal(
    stalePriceFindings(STALE_PRICES, "2026-11-07").length,
    1,
    "Tag 91 nach dem Anker meldet",
  );
});

test("[NIE3] die Tageswerte aus config.js bleiben 86 400 000 ms", () => {
  const DAY = 86_400_000;
  assert.deepEqual(
    [
      config.billing.costAlertDebounceMs,
      config.billing.priceDriftMinIntervalMs,
      config.safety.perTargetWindowMs,
      config.provisioning.provisioningRetryMinIntervalMs,
    ],
    [DAY, DAY, DAY, DAY],
  );
});

const DEEPSEEK = "deepseek-v4-pro";
const DEEPSEEK_AS_OF = "2026-08-07";
const BEFORE_SWITCH_DAY = "2026-08-20";
const AFTER_SWITCH_DAY = "2026-10-30";
const dayAfter = (isoDay, days) =>
  new Date(Date.parse(isoDay) + days * MS_PER_DAY).toISOString().slice(0, ANCHOR_DAY.length);

async function configOn(t, isoDay, loadFresh) {
  t.mock.timers.enable({ apis: ["Date"], now: Date.parse(`${isoDay}T12:00:00Z`) });
  const fresh = await loadFresh();
  const today = fresh.todayIsoDate();
  t.mock.timers.reset();
  return { today, prices: fresh.config.llm.modelPricesUsd };
}

function staleEdge(prices, modelId, asOf) {
  const single = { [modelId]: prices[modelId] };
  return [
    stalePriceFindings(single, dayAfter(asOf, MODEL_PRICE_MAX_AGE_DAYS)).length,
    stalePriceFindings(single, dayAfter(asOf, MODEL_PRICE_MAX_AGE_DAYS + 1)).length,
  ];
}

test("B4A-TAB-3: am 20.08. gilt die Anker-Staffel von claude-sonnet-5 und jede ausgelieferte Staffel veraltet erst am 91. Tag nach ihrem Abruf", async (t) => {
  const { today, prices } = await configOn(
    t,
    BEFORE_SWITCH_DAY,
    () => import("../src/config.js?b4a-stichtag-vor-umschaltung"),
  );
  assert.equal(today, BEFORE_SWITCH_DAY);
  assert.deepEqual(Object.keys(prices).sort(), [HAIKU, SONNET, DEEPSEEK].sort());
  assert.deepEqual(ratesOf(prices[SONNET]), [2.0, 2.5, 0.2, 10.0]);
  assert.equal(prices[SONNET].nextValidFrom, SWITCH_DAY);
  assert.deepEqual(staleEdge(prices, HAIKU, ANCHOR_DAY), [0, 1]);
  assert.deepEqual(staleEdge(prices, SONNET, ANCHOR_DAY), [0, 1]);
  assert.deepEqual(staleEdge(prices, DEEPSEEK, DEEPSEEK_AS_OF), [0, 1]);
});

test("B4A-TAB-4: am 30.10. gilt die Umschalt-Staffel von claude-sonnet-5 und auch sie veraltet erst am 91. Tag nach ihrem Abruf", async (t) => {
  const { today, prices } = await configOn(
    t,
    AFTER_SWITCH_DAY,
    () => import("../src/config.js?b4a-stichtag-nach-umschaltung"),
  );
  assert.equal(today, AFTER_SWITCH_DAY);
  assert.deepEqual(ratesOf(prices[SONNET]), [3.0, 3.75, 0.3, 15.0]);
  assert.equal(prices[SONNET].nextValidFrom, null);
  assert.deepEqual(staleEdge(prices, SONNET, ANCHOR_DAY), [0, 1]);
});

test("B4A-RES-10: ein validFrom mit Vor- oder Nachsatz und ein leerer Staffel-Eintrag brechen benannt ab", () => {
  for (const validFrom of [`${ANCHOR_DAY}x`, `x${ANCHOR_DAY}`, `${ANCHOR_DAY}T00:00`]) {
    assert.throws(
      () => resolveModelPrices({ [HAIKU]: [entry({ validFrom })] }, ANCHOR_DAY),
      /ohne gueltiges validFrom/,
      `validFrom ${validFrom} ist kein Kalendertag`,
    );
  }
  for (const empty of [null, undefined]) {
    assert.throws(
      () => resolveModelPrices({ [HAIKU]: [empty] }, ANCHOR_DAY),
      /modelPricesUsd: Staffel 'claude-haiku-4-5' ohne gueltiges validFrom/,
    );
  }
});

test("B4A-RES-11: eine Rate von genau 0 ist gueltig und wird ausgeliefert", () => {
  const prices = resolveModelPrices({ [HAIKU]: [entry({ cacheReadPerMTok: 0 })] }, ANCHOR_DAY);
  assert.equal(prices[HAIKU].cacheReadPerMTok, 0);
});

test("B4A-RES-12: nach der Umschaltung gilt bei absteigender Notation die juengste faellige Staffel", () => {
  const descending = { [SONNET]: [...SCHEDULES[SONNET]].reverse() };
  assert.deepEqual(
    ratesOf(resolveModelPrices(descending, SWITCH_DAY)[SONNET]),
    [3.0, 3.75, 0.3, 15.0],
  );
});

test("B4A-RES-13: zwei Staffeln mit demselben validFrom - es gilt die zuerst notierte", () => {
  const prices = resolveModelPrices(
    { [HAIKU]: [entry({ inPerMTok: 1.0 }), entry({ inPerMTok: 9.0 })] },
    ANCHOR_DAY,
  );
  assert.equal(prices[HAIKU].inPerMTok, 1.0);
});

test("B4A-RES-14: nextValidFrom ist die frueheste kuenftige Staffel, egal in welcher Reihenfolge notiert", () => {
  const future = ["2026-10-01", "2026-09-15", "2026-12-01"];
  const prices = resolveModelPrices(
    { [HAIKU]: [entry(), ...future.map((validFrom) => entry({ validFrom }))] },
    LAST_DAY_OLD_RATE,
  );
  assert.equal(prices[HAIKU].nextValidFrom, "2026-09-15");
});

test("B4A-RES-15: ohne faellige Staffel nennt die Meldung Modell, Tag und Ursache im Wortlaut", () => {
  assert.throws(
    () => resolveModelPrices({ [HAIKU]: [entry({ validFrom: SWITCH_DAY })] }, ANCHOR_DAY),
    {
      message:
        "modelPricesUsd: Modell 'claude-haiku-4-5' hat am 2026-08-08 keine gueltige Preisstaffel " +
        "(kein validFrom liegt in der Vergangenheit)",
    },
  );
});
