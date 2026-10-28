import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertConfig,
  boolEnv,
  config,
  configFatalErrors,
  csvEnv,
  enumEnv,
  eurToCents,
  isoInstantEnv,
  numEnv,
} from "../../src/config.js";
import { makeConfigOverrides, CONFIG_REQUIRED_OK } from "../helpers.js";
import { fehlerausgabeVon } from "./fehlerausgabe.js";

const BUDGET_EUR_GUELTIG = 12.5;
const NEUNUNDZWANZIG_CENT_IN_EUR = 0.29;
const NEUNUNDZWANZIG_CENT = 29;
const TOTLUFT_OBERGRENZE_S = 300;
const LEERLAUF_OBERGRENZE = 50;
const ANRUFE_JE_STUNDE_FALLBACK = 6;
const BUDGET_EUR_FALLBACK = 8;
const BUDGET_EUR_MIT_NACHKOMMA = 8.5;
const MS_JE_TAG = 86_400_000;

function neueBefunde(vorher) {
  return configFatalErrors().slice(vorher);
}

function nennt(befunde, name) {
  return befunde.some((befund) => befund.includes(name));
}

const { withConfigOverrides } = makeConfigOverrides(config);

test("boolEnv: unset/leer -> fallback ohne Fatal (beide Richtungen)", () => {
  const before = configFatalErrors().length;
  assert.equal(boolEnv("X_A", undefined, { fallback: false }), false);
  assert.equal(boolEnv("X_B", undefined, { fallback: true }), true);
  assert.equal(boolEnv("X_C", "", { fallback: true }), true);
  assert.equal(configFatalErrors().length, before, "abwesend/leer darf keinen Fatal erzeugen");
});

test('boolEnv: "true"/"false" -> Bool ohne Fatal', () => {
  const before = configFatalErrors().length;
  assert.equal(boolEnv("X_T", "true", { fallback: false }), true);
  assert.equal(boolEnv("X_F", "false", { fallback: true }), false);
  assert.equal(configFatalErrors().length, before);
});

test('boolEnv: " True "/"FALSE" werden getrimmt+lowercased (kein Fatal)', () => {
  const before = configFatalErrors().length;
  assert.equal(boolEnv("X_TRIM", " True ", { fallback: false }), true);
  assert.equal(boolEnv("X_CASE", "FALSE", { fallback: true }), false);
  assert.equal(configFatalErrors().length, before);
});

test('boolEnv: "1"/"yes"/"on"/"maybe"/"0"/"no" -> Fatal + fallback', () => {
  for (const bad of ["1", "yes", "on", "maybe", "0", "no"]) {
    const before = configFatalErrors().length;
    assert.equal(boolEnv("X_BAD", bad, { fallback: false }), false, `${bad} -> Fallback`);
    assert.ok(nennt(neueBefunde(before), "X_BAD"), `${bad} muss Fatal (X_BAD) erzeugen`);
  }
});

test("boolEnv: Fatal -> assertConfig() === false und nennt die Var", () => {
  withConfigOverrides(CONFIG_REQUIRED_OK, () => {
    boolEnv("SOME_SWITCH", "kaputt", { fallback: false });
    const lines = fehlerausgabeVon(() => assert.equal(assertConfig(), false));
    assert.ok(lines.join("\n").includes("SOME_SWITCH"));
  });
});

test('Kill-Switch: OUTBOUND_FROZEN="TRUE" -> config.outboundFrozen===true (kein stiller Fail-Open)', async () => {
  const saved = process.env.OUTBOUND_FROZEN;
  try {
    process.env.OUTBOUND_FROZEN = "TRUE";
    const fresh = await import("../../src/config.js?boolenv-frozen-true");
    assert.equal(fresh.config.safety.outboundFrozen, true);
    assert.ok(
      !nennt(fresh.configFatalErrors(), "OUTBOUND_FROZEN"),
      "normalisierbarer Wert ist kein Fatal",
    );
  } finally {
    if (saved === undefined) delete process.env.OUTBOUND_FROZEN;
    else process.env.OUTBOUND_FROZEN = saved;
  }
});

test('Kill-Switch: OUTBOUND_FROZEN="1" -> Fatal + Fallback false (Boot-Refusal statt Fail-Open)', async () => {
  const saved = process.env.OUTBOUND_FROZEN;
  try {
    process.env.OUTBOUND_FROZEN = "1";
    const fresh = await import("../../src/config.js?boolenv-frozen-bad");
    assert.equal(fresh.config.safety.outboundFrozen, false);
    assert.ok(nennt(fresh.configFatalErrors(), "OUTBOUND_FROZEN"));
  } finally {
    if (saved === undefined) delete process.env.OUTBOUND_FROZEN;
    else process.env.OUTBOUND_FROZEN = saved;
  }
});

test("T-P2-01: NaN-Budget -> numEnv sammelt Fatal (nennt MAX_BUDGET_EUR)", () => {
  numEnv("MAX_BUDGET_EUR", "acht", { fallback: 8, min: 0, integer: false });
  assert.ok(
    nennt(configFatalErrors(), "MAX_BUDGET_EUR"),
    "configFatalErrors muss MAX_BUDGET_EUR nennen",
  );
});

test("T-P2-02: gueltiges Budget -> kein neuer Fatal, korrekter Float-Wert", () => {
  const before = configFatalErrors().length;
  const wert = numEnv("MAX_BUDGET_EUR", "12.5", { fallback: 8, min: 0, integer: false });
  assert.equal(wert, BUDGET_EUR_GUELTIG);
  assert.equal(configFatalErrors().length, before, "valider Wert darf keinen Fatal erzeugen");
});

test("S1-COV-1: eurToCents rundet die JS-Float-Falle korrekt (0.29 EUR -> exakt 29 Cent, nicht 28)", () => {
  assert.equal(eurToCents(NEUNUNDZWANZIG_CENT_IN_EUR), NEUNUNDZWANZIG_CENT);
  assert.equal(eurToCents(0), 0);
});

test("T-P2-03: negativer Gate-Wert -> Fatal (nennt Minimum); '0' bleibt gueltiger Not-Aus", () => {
  const beforeNeg = configFatalErrors().length;
  numEnv("MAX_CALLS_PER_HOUR", "-1", { fallback: 6, min: 0 });
  const added = neueBefunde(beforeNeg);
  assert.ok(
    added.some((befund) => befund.includes("MAX_CALLS_PER_HOUR") && befund.includes("Minimum")),
    "negativer Gate-Wert muss als Minimum-Verletzung gemeldet werden",
  );
  const before0 = configFatalErrors().length;
  const notAus = numEnv("MAX_CALLS_PER_HOUR", "0", { fallback: 6, min: 0 });
  assert.equal(notAus, 0);
  assert.equal(configFatalErrors().length, before0, "0 ist gueltiger Not-Aus, kein Fatal");
});

test("T-P2-04: deadAirTimeoutS NaN -> Fatal (kein stilles max); Clamp-Pfad bleibt", () => {
  const before = configFatalErrors().length;
  numEnv("TELNYX_DEAD_AIR_TIMEOUT_S", "lang", { fallback: 45, min: 5, max: 300 });
  assert.ok(
    nennt(neueBefunde(before), "TELNYX_DEAD_AIR_TIMEOUT_S"),
    "ein NaN-Wert muss Fatal sein (frueheres Math.min(NaN,max)-Loch geschlossen)",
  );
  const beforeClamp = configFatalErrors().length;
  const clamped = numEnv("TELNYX_DEAD_AIR_TIMEOUT_S", "600", { fallback: 45, min: 5, max: 300 });
  assert.equal(clamped, TOTLUFT_OBERGRENZE_S, "Wert ueber Obergrenze wird auf max geklemmt");
  assert.equal(configFatalErrors().length, beforeClamp, "Clamp ist kein Fatal");
});

test("T-P2-05: assertConfig faellt bei numerischem Fatal und nennt die Var", () => {
  withConfigOverrides(CONFIG_REQUIRED_OK, () => {
    numEnv("RATE_LIMIT_PER_MIN", "kaputt", { fallback: 120, min: 0 });
    const lines = fehlerausgabeVon(() => {
      assert.equal(assertConfig(), false, "numerischer Fatal -> assertConfig false");
    });
    assert.ok(
      lines.join("\n").includes("RATE_LIMIT_PER_MIN"),
      "Diagnose muss die verletzte Var nennen",
    );
  });
});

test("T-P2-06: TELNYX_LOOP_GUARD_MAX_EMPTY_TURNS absurd hoch -> auf max 50 geklemmt (kein Fatal)", () => {
  const before = configFatalErrors().length;
  const clamped = numEnv("TELNYX_LOOP_GUARD_MAX_EMPTY_TURNS", "999999", {
    fallback: 8,
    min: 3,
    max: 50,
  });
  assert.equal(
    clamped,
    LEERLAUF_OBERGRENZE,
    "Wert ueber der Obergrenze wird geklemmt statt den Loop-Guard stillzulegen",
  );
  assert.equal(configFatalErrors().length, before, "Clamp ist kein Fatal");
});

test("S1-3: config klemmt PROVISIONING_REDRIVE_MAX_AGE_MS strikt unter das 24h-Doppelkauf-Fenster", async () => {
  const saved = process.env.PROVISIONING_REDRIVE_MAX_AGE_MS;
  try {
    process.env.PROVISIONING_REDRIVE_MAX_AGE_MS = String(MS_JE_TAG);
    const atDay = await import("../../src/config.js?s1-3-day");
    assert.equal(atDay.config.provisioning.provisioningRedriveMaxAgeMs, MS_JE_TAG - 1, "24h -> auf 24h-1ms geklemmt");
    assert.ok(
      !nennt(atDay.configFatalErrors(), "PROVISIONING_REDRIVE_MAX_AGE_MS"),
      "Clamp ist KEIN Fatal",
    );
    process.env.PROVISIONING_REDRIVE_MAX_AGE_MS = String(MS_JE_TAG - 1);
    const atEdge = await import("../../src/config.js?s1-3-edge");
    assert.equal(atEdge.config.provisioning.provisioningRedriveMaxAgeMs, MS_JE_TAG - 1, "24h-1ms bleibt unveraendert");
    process.env.PROVISIONING_REDRIVE_MAX_AGE_MS = "0";
    const atZero = await import("../../src/config.js?s1-3-zero");
    assert.equal(atZero.config.provisioning.provisioningRedriveMaxAgeMs, 0, "0 (Observe-Only) bleibt 0");
  } finally {
    if (saved === undefined) delete process.env.PROVISIONING_REDRIVE_MAX_AGE_MS;
    else process.env.PROVISIONING_REDRIVE_MAX_AGE_MS = saved;
  }
});

test("T-P2-07: Int-Trailing-Muell '120abc' -> Fatal + Fallback (kein stiller Teilwert 120)", () => {
  const before = configFatalErrors().length;
  const wert = numEnv("MAX_CALLS_PER_HOUR", "120abc", { fallback: 6, min: 0 });
  assert.equal(
    wert,
    ANRUFE_JE_STUNDE_FALLBACK,
    "teil-numerischer Muell darf NICHT still auf 120 kippen, sondern Fallback",
  );
  assert.ok(
    nennt(neueBefunde(before), "MAX_CALLS_PER_HOUR"),
    "'120abc' muss einen Fatal erzeugen, der die Var nennt",
  );
});

test("T-P2-08: Float-Trailing-Muell '8.5abc' -> Fatal + Fallback (kein stiller Teilwert 8.5)", () => {
  const before = configFatalErrors().length;
  const wert = numEnv("MAX_BUDGET_EUR", "8.5abc", { fallback: 8, min: 0, integer: false });
  assert.equal(
    wert,
    BUDGET_EUR_FALLBACK,
    "teil-numerischer Float-Muell darf NICHT still auf 8.5 kippen, sondern Fallback",
  );
  assert.ok(
    nennt(neueBefunde(before), "MAX_BUDGET_EUR"),
    "'8.5abc' muss einen Fatal erzeugen, der die Var nennt",
  );
});

test("T-P2-09: Rand-Whitespace bleibt gueltig (Int '  6  ' und Float '  8.5  ' - kein neuer Fatal)", () => {
  const beforeInt = configFatalErrors().length;
  const ganzzahl = numEnv("MAX_CALLS_PER_HOUR", "  6  ", { fallback: 6, min: 0 });
  assert.equal(ganzzahl, ANRUFE_JE_STUNDE_FALLBACK, "Rand-Whitespace um eine Ganzzahl bleibt gueltig");
  assert.equal(configFatalErrors().length, beforeInt, "getrimmte gueltige Ganzzahl erzeugt keinen Fatal");
  const beforeFloat = configFatalErrors().length;
  const dezimal = numEnv("MAX_BUDGET_EUR", "  8.5  ", { fallback: 8, min: 0, integer: false });
  assert.equal(dezimal, BUDGET_EUR_MIT_NACHKOMMA, "Rand-Whitespace um eine Dezimalzahl bleibt gueltig");
  assert.equal(configFatalErrors().length, beforeFloat, "getrimmte gueltige Dezimalzahl erzeugt keinen Fatal");
});

test("T-P2-10: Trailing-Muell an einem Gate -> assertConfig verweigert Boot (nennt die Var)", () => {
  withConfigOverrides(CONFIG_REQUIRED_OK, () => {
    numEnv("RATE_LIMIT_PER_MIN", "120abc", { fallback: 120, min: 0 });
    const lines = fehlerausgabeVon(() => {
      assert.equal(assertConfig(), false, "teil-numerischer Fatal -> assertConfig false (Boot-Refusal)");
    });
    assert.ok(
      lines.join("\n").includes("RATE_LIMIT_PER_MIN"),
      "Diagnose muss die verletzte Var nennen",
    );
  });
});

const GANZZAHL_FALLBACK = 7;
const DEZIMAL_ACHTEINHALB = 8.5;
const DEZIMAL_ZWEI_STELLEN = 8.25;
const DEZIMAL_OHNE_VORKOMMA = 0.25;
const GRUNDBETRAG_ROUTEN =
  "el_convai_sip|telnyx_budget|telnyx_inbound_budget|telnyx_inbound_el_convai";

async function mitUmgebung(name, wert, laden) {
  const saved = process.env[name];
  try {
    process.env[name] = wert;
    return await laden();
  } finally {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  }
}

function befundeZu(alleBefunde, name) {
  return alleBefunde.filter((befund) => befund.startsWith(`${name}=`));
}

test("numEnv-Meldung: Ganzzahl ohne Minimum nennt nur die Art", () => {
  const before = configFatalErrors().length;
  assert.equal(numEnv("X_GANZ", "abc", { fallback: GANZZAHL_FALLBACK }), GANZZAHL_FALLBACK);
  assert.deepEqual(neueBefunde(before), [
    'X_GANZ="abc" ist keine gueltige Zahl (erwartet: Ganzzahl).',
  ]);
});

test("numEnv-Meldung: Dezimalzahl mit Minimum nennt Art und Minimum", () => {
  const before = configFatalErrors().length;
  const wert = numEnv("X_DEZ", "abc", { fallback: GANZZAHL_FALLBACK, min: 0, integer: false });
  assert.equal(wert, GANZZAHL_FALLBACK);
  assert.deepEqual(neueBefunde(before), [
    'X_DEZ="abc" ist keine gueltige Zahl (erwartet: Zahl, >= 0).',
  ]);
});

test("numEnv: ohne Angabe integer ist nur eine Ganzzahl gueltig ('2.5' -> Fatal + Fallback)", () => {
  const before = configFatalErrors().length;
  assert.equal(
    numEnv("X_STANDARD_GANZ", "2.5", { fallback: GANZZAHL_FALLBACK }),
    GANZZAHL_FALLBACK,
  );
  assert.ok(nennt(neueBefunde(before), "X_STANDARD_GANZ"));
});

test("numEnv: Exponentschreibweise '1e5' ist weder Ganzzahl noch Dezimalzahl (kein stiller Teilwert)", () => {
  const beforeInt = configFatalErrors().length;
  assert.equal(numEnv("X_EXP_GANZ", "1e5", { fallback: GANZZAHL_FALLBACK }), GANZZAHL_FALLBACK);
  assert.ok(nennt(neueBefunde(beforeInt), "X_EXP_GANZ"));
  const beforeFloat = configFatalErrors().length;
  const dezimal = numEnv("X_EXP_DEZ", "1e5", { fallback: GANZZAHL_FALLBACK, integer: false });
  assert.equal(dezimal, GANZZAHL_FALLBACK);
  assert.ok(nennt(neueBefunde(beforeFloat), "X_EXP_DEZ"));
});

test("numEnv: Dezimalzahlen mit Vorzeichen, zwei Nachkommastellen und ohne Vorkomma bleiben gueltig", () => {
  const before = configFatalErrors().length;
  assert.equal(numEnv("X_PLUS", "+8.5", { fallback: 1, integer: false }), DEZIMAL_ACHTEINHALB);
  assert.equal(numEnv("X_ZWEI", "8.25", { fallback: 1, integer: false }), DEZIMAL_ZWEI_STELLEN);
  assert.equal(numEnv("X_PUNKT", ".25", { fallback: 1, integer: false }), DEZIMAL_OHNE_VORKOMMA);
  assert.equal(configFatalErrors().length, before, "gueltige Dezimalzahlen erzeugen keinen Fatal");
});

test("enumEnv: Rand-Whitespace wird entfernt, der Wert bleibt gueltig", () => {
  const before = configFatalErrors().length;
  assert.equal(enumEnv("X_ENUM", "  b  ", { allowed: ["a", "b"], fallback: "a" }), "b");
  assert.equal(configFatalErrors().length, before);
});

test("isoInstantEnv: gueltige Zeitpunkte mit Rand-Whitespace, ohne Sekunden und mit Millisekunden", () => {
  const before = configFatalErrors().length;
  assert.equal(isoInstantEnv("X_ISO_RAND", "  2026-08-04T00:00:00Z  "), "2026-08-04T00:00:00.000Z");
  assert.equal(isoInstantEnv("X_ISO_MINUTE", "2026-08-04T00:00Z"), "2026-08-04T00:00:00.000Z");
  assert.equal(isoInstantEnv("X_ISO_MS", "2026-08-04T00:00:00.123Z"), "2026-08-04T00:00:00.123Z");
  assert.equal(configFatalErrors().length, before, "gueltige Zeitpunkte erzeugen keinen Fatal");
});

test("isoInstantEnv: Jahr mit Vorzeichen -> Fatal + null, obwohl Date es lesen kann", () => {
  const wert = "+002026-08-04T00:00:00Z";
  assert.ok(!Number.isNaN(new Date(wert).getTime()), "Vorbedingung: Date liest den Wert");
  const before = configFatalErrors().length;
  assert.equal(isoInstantEnv("X_ISO_JAHR", wert), null);
  assert.ok(nennt(neueBefunde(before), "X_ISO_JAHR"));
});

test("csvEnv: Eintraege werden getrimmt, leere fallen weg", () => {
  assert.deepEqual(csvEnv(" a , b ,, c "), ["a", "b", "c"]);
});

test("FORCE_NUMBER_COUNTRY wird getrimmt und gross geschrieben", async () => {
  const fresh = await mitUmgebung(
    "FORCE_NUMBER_COUNTRY",
    " us ",
    () => import("../../src/config.js?force-country-trim"),
  );
  assert.equal(fresh.config.provisioning.forceNumberCountry, "US");
});

test("VOICE_TARIFF_GRUNDBETRAG_CENTS: 0 ist gueltig, Nachkomma und negative Cent sind Fatal", async () => {
  const fresh = await mitUmgebung(
    "VOICE_TARIFF_GRUNDBETRAG_CENTS",
    "el_convai_sip:0,telnyx_budget:1.5,telnyx_inbound_budget:-1",
    () => import("../../src/config.js?grundbetrag-karte"),
  );
  assert.deepEqual(fresh.config.billing.voiceTariffGrundbetragCentsJeRoute, { el_convai_sip: 0 });
  assert.deepEqual(befundeZu(fresh.configFatalErrors(), "VOICE_TARIFF_GRUNDBETRAG_CENTS"), [
    'VOICE_TARIFF_GRUNDBETRAG_CENTS="telnyx_budget:1.5" ist keine gueltige Karte profil:ganze-cent ' +
      `(gueltige Profile: ${GRUNDBETRAG_ROUTEN}).`,
    'VOICE_TARIFF_GRUNDBETRAG_CENTS="telnyx_inbound_budget:-1" ist keine gueltige Karte profil:ganze-cent ' +
      `(gueltige Profile: ${GRUNDBETRAG_ROUTEN}).`,
  ]);
});
