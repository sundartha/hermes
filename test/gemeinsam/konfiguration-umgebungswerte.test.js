import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertConfig,
  boolEnv,
  config,
  configFatalErrors,
  eurToCents,
  numEnv,
  resolveModelPrices,
  routeCentsEnv,
  todayIsoDate,
} from "../../src/config.js";
import { execFileSync } from "node:child_process";
import { makeConfigOverrides, CONFIG_REQUIRED_OK } from "../helpers.js";
import { BASE_ENV, ROOT } from "../helpers.js";
import { kindUmgebung } from "./kind-umgebung.mjs";
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

async function umgebungsparser() {
  return import("../../src/config.js");
}

async function frischMitUmgebung(werte, laden) {
  const gesichert = {};
  for (const name of Object.keys(werte)) gesichert[name] = process.env[name];
  try {
    for (const [name, wert] of Object.entries(werte)) {
      if (wert === undefined) delete process.env[name];
      else process.env[name] = wert;
    }
    return await laden();
  } finally {
    for (const [name, wert] of Object.entries(gesichert)) {
      if (wert === undefined) delete process.env[name];
      else process.env[name] = wert;
    }
  }
}

function befundZu(aktion) {
  const vorher = configFatalErrors().length;
  const ergebnis = aktion();
  return { ergebnis, befunde: neueBefunde(vorher) };
}

test("Umgebungsparser Ganzzahl: nur reine Ganzzahl mit optionalem Vorzeichen, sonst Fehlerbefund mit Wortlaut", () => {
  const gueltig = [
    ["7", 7],
    ["+7", 7],
    ["-7", -7],
    ["007", 7],
  ];
  for (const [roh, erwartet] of gueltig) {
    const { ergebnis, befunde } = befundZu(() => numEnv("GANZ", roh, { fallback: 99 }));
    assert.equal(ergebnis, erwartet, roh);
    assert.deepEqual(befunde, [], roh);
  }
  for (const roh of ["12-5", "1 2", "1.5", "5-", "--5", "+-5", "abc", "1e3", " "]) {
    const { ergebnis, befunde } = befundZu(() => numEnv("GANZ", roh, { fallback: 99 }));
    assert.equal(ergebnis, 99, roh);
    assert.deepEqual(
      befunde,
      [`GANZ="${roh}" ist keine gueltige Zahl (erwartet: Ganzzahl).`],
      roh,
    );
  }
});

test("Umgebungsparser Dezimalzahl: Formen mit Vorzeichen, Nachkomma und Punkt vorn gelten, Rest ist Fehlerbefund", () => {
  const gueltig = [
    ["2", 2],
    ["10", 10],
    ["2.5", 2.5],
    ["1.25", 1.25],
    ["10.50", 10.5],
    ["2.", 2],
    [".25", 0.25],
    [".5", 0.5],
    ["-1.5", -1.5],
    ["+2.5", 2.5],
  ];
  for (const [roh, erwartet] of gueltig) {
    const { ergebnis, befunde } = befundZu(() =>
      numEnv("DEZ", roh, { fallback: 99, integer: false }),
    );
    assert.equal(ergebnis, erwartet, roh);
    assert.deepEqual(befunde, [], roh);
  }
  for (const roh of ["1.5x", "1..5", "1.5.5", "1 5", ".", "abc", "x1.5", "1.5-"]) {
    const { ergebnis, befunde } = befundZu(() =>
      numEnv("DEZ", roh, { fallback: 99, integer: false }),
    );
    assert.equal(ergebnis, 99, roh);
    assert.deepEqual(
      befunde,
      [`DEZ="${roh}" ist keine gueltige Zahl (erwartet: Zahl).`],
      roh,
    );
  }
});

test("Umgebungsparser numEnv: Ganzzahl ist Standard, Minimum steht im Befund und ist selbst gueltig, Maximum klemmt", () => {
  const ohneArt = befundZu(() => numEnv("STD", "1.5", { fallback: 4 }));
  assert.equal(ohneArt.ergebnis, 4);
  assert.deepEqual(ohneArt.befunde, ['STD="1.5" ist keine gueltige Zahl (erwartet: Ganzzahl).']);

  const mitMin = befundZu(() => numEnv("MIN", "x", { fallback: 4, min: 0 }));
  assert.deepEqual(mitMin.befunde, ['MIN="x" ist keine gueltige Zahl (erwartet: Ganzzahl, >= 0).']);
  const dezimalMitMin = befundZu(() => numEnv("MIN", "x", { fallback: 4, min: 2, integer: false }));
  assert.deepEqual(dezimalMitMin.befunde, [
    'MIN="x" ist keine gueltige Zahl (erwartet: Zahl, >= 2).',
  ]);

  const darunter = befundZu(() => numEnv("MIN", "-1", { fallback: 4, min: 0 }));
  assert.equal(darunter.ergebnis, 4);
  assert.deepEqual(darunter.befunde, ["MIN=-1 unterschreitet das Minimum 0."]);
  const genau = befundZu(() => numEnv("MIN", "0", { fallback: 4, min: 0 }));
  assert.equal(genau.ergebnis, 0);
  assert.deepEqual(genau.befunde, []);

  const ohneMin = befundZu(() => numEnv("OHNE", "-5", { fallback: 4 }));
  assert.equal(ohneMin.ergebnis, -5);
  assert.deepEqual(ohneMin.befunde, []);

  assert.equal(numEnv("MAX", "9", { fallback: 4, max: 5 }), 5);
  assert.equal(numEnv("MAX", "5", { fallback: 4, max: 5 }), 5);
  assert.equal(numEnv("MAX", "3", { fallback: 4, max: 5 }), 3);
  assert.equal(numEnv("MAX", "999", { fallback: 4 }), 999);
});

test("Umgebungsparser: leer oder fehlend gibt den Fallback ohne Befund, Rand-Leerraum wird getrimmt", async () => {
  const { enumEnv, isoInstantEnv } = await umgebungsparser();
  const optionen = { allowed: ["a", "b"], fallback: "b" };
  for (const roh of [undefined, ""]) {
    const { ergebnis, befunde } = befundZu(() => [
      numEnv("N", roh, { fallback: 3 }),
      boolEnv("B", roh, { fallback: true }),
      enumEnv("E", roh, optionen),
      isoInstantEnv("I", roh),
    ]);
    assert.deepEqual(ergebnis, [3, true, "b", null], String(roh));
    assert.deepEqual(befunde, [], String(roh));
  }
  const { ergebnis, befunde } = befundZu(() => [
    enumEnv("E", "  a  ", optionen),
    isoInstantEnv("I", "  2026-08-04T00:00:00Z  "),
  ]);
  assert.deepEqual(ergebnis, ["a", "2026-08-04T00:00:00.000Z"]);
  assert.deepEqual(befunde, []);
});

test("Umgebungsparser Aufzaehlung und Boolean: Befund nennt Wert und erlaubte Werte im alten Wortlaut", async () => {
  const { enumEnv } = await umgebungsparser();
  const aufzaehlung = befundZu(() => enumEnv("ENUM", " c ", { allowed: ["a", "b"], fallback: "a" }));
  assert.equal(aufzaehlung.ergebnis, "a");
  assert.deepEqual(aufzaehlung.befunde, ['ENUM=" c " ist unbekannt (gueltig: a|b).']);
  const wahrheit = befundZu(() => boolEnv("BOOL", "ja", { fallback: false }));
  assert.equal(wahrheit.ergebnis, false);
  assert.deepEqual(wahrheit.befunde, [
    'BOOL="ja" ist kein gueltiger Boolean (erwartet: "true" oder "false").',
  ]);
});

test("Umgebungsparser Zeitpunkt: gueltige Formen mit Zone werden normiert, alles andere ist Befund und null", async () => {
  const { isoInstantEnv } = await umgebungsparser();
  const gueltig = [
    ["2026-08-04T00:00Z", "2026-08-04T00:00:00.000Z"],
    ["2026-08-04T00:00:00Z", "2026-08-04T00:00:00.000Z"],
    ["2026-08-04T00:00:00.5Z", "2026-08-04T00:00:00.500Z"],
    ["2026-08-04T00:00:00.123Z", "2026-08-04T00:00:00.123Z"],
    ["2026-08-04T02:00:00+02:00", "2026-08-04T00:00:00.000Z"],
    ["2026-08-04T00:00-02:00", "2026-08-04T02:00:00.000Z"],
  ];
  for (const [roh, erwartet] of gueltig) {
    const { ergebnis, befunde } = befundZu(() => isoInstantEnv("ZEIT", roh));
    assert.equal(ergebnis, erwartet, roh);
    assert.deepEqual(befunde, [], roh);
  }
  const ungueltig = [
    "2026-08-04",
    "2026-08-04T00:00:00",
    "2026-08-04T00:00:00+0200",
    "2026-08-04T00:00:00.1234Z",
    "2026-08-04 00:00:00Z",
    "2026-13-45T00:00:00Z",
    "2026-08-04T00:00:00Z (CET)",
    "+002026-08-04T00:00:00Z",
    "morgen",
  ];
  for (const roh of ungueltig) {
    const { ergebnis, befunde } = befundZu(() => isoInstantEnv("ZEIT", roh));
    assert.equal(ergebnis, null, roh);
    assert.deepEqual(
      befunde,
      [
        `ZEIT="${roh}" ist kein gueltiger ISO-8601-Zeitpunkt mit Zone (erwartet z.B. 2026-08-04T00:00:00Z).`,
      ],
      roh,
    );
  }
});

test("Umgebungsparser Listen und URL: csvEnv trimmt und laesst Leeres weg, stripTrailingSlash kuerzt genau einen Schraegstrich", async () => {
  const { csvEnv, stripTrailingSlash } = await umgebungsparser();
  assert.deepEqual(csvEnv(" a , b,, c ,"), ["a", "b", "c"]);
  assert.deepEqual(csvEnv(undefined), []);
  assert.deepEqual(csvEnv(""), []);
  assert.equal(stripTrailingSlash("https://a.example/"), "https://a.example");
  assert.equal(stripTrailingSlash("https://a.example//"), "https://a.example/");
  assert.equal(stripTrailingSlash("https://a.example"), "https://a.example");
});

test("Umgebungsparser Routenkarte: gueltige Profil:Cent-Paare landen in der Karte, jeder andere Eintrag ist ein Befund", async () => {
  const frisch = await frischMitUmgebung(
    {
      VOICE_TARIFF_GRUNDBETRAG_CENTS:
        " el_convai_sip:12 ,telnyx_budget:0,bogus:5,telnyx_inbound_budget,telnyx_inbound_budget:-1,telnyx_inbound_budget:x,telnyx_inbound_budget:1.5,:7",
    },
    () => import("../../src/config.js?umgebung-routenkarte"),
  );
  assert.deepEqual(frisch.config.billing.voiceTariffGrundbetragCentsJeRoute, {
    el_convai_sip: 12,
    telnyx_budget: 0,
  });
  const erwartetVon = (eintrag) =>
    `VOICE_TARIFF_GRUNDBETRAG_CENTS="${eintrag}" ist keine gueltige Karte profil:ganze-cent ` +
    "(gueltige Profile: el_convai_sip|telnyx_budget|telnyx_inbound_budget|telnyx_inbound_el_convai|telnyx_outbound_el_convai).";
  assert.deepEqual(
    frisch.configFatalErrors().filter((befund) => befund.includes("VOICE_TARIFF_GRUNDBETRAG_CENTS")),
    [
      "bogus:5",
      "telnyx_inbound_budget",
      "telnyx_inbound_budget:-1",
      "telnyx_inbound_budget:x",
      "telnyx_inbound_budget:1.5",
      ":7",
    ].map(erwartetVon),
  );
});

test("Umgebungsparser Produktion: RENDER_EXTERNAL_URL gesetzt heisst isProduction true, sonst false", async () => {
  const mit = await frischMitUmgebung(
    { RENDER_EXTERNAL_URL: "https://hermes.example" },
    () => import("../../src/config.js?umgebung-produktion-ja"),
  );
  assert.equal(mit.config.server.isProduction, true);
  const ohne = await frischMitUmgebung({ RENDER_EXTERNAL_URL: undefined },
    () => import("../../src/config.js?umgebung-produktion-nein"),
  );
  assert.equal(ohne.config.server.isProduction, false);
});

test("Umgebungsparser Zeitpunkt: ein Steuerzeichen hinter der Zone macht den Wert ungueltig", async () => {
  const { isoInstantEnv } = await umgebungsparser();
  const roh = `2026-08-04T00:00:00Z${String.fromCharCode(0)}`;
  const { ergebnis, befunde } = befundZu(() => isoInstantEnv("ZEIT", roh));
  assert.equal(ergebnis, null);
  assert.deepEqual(befunde, [
    `ZEIT="${roh}" ist kein gueltiger ISO-8601-Zeitpunkt mit Zone (erwartet z.B. 2026-08-04T00:00:00Z).`,
  ]);
});

test("Umgebungsparser Routenkarte: kurzer Profilname mit Doppelpunkt an Stelle eins gilt, Eintrag ohne Doppelpunkt ist auch mit leerem Profil ein Befund", () => {
  const kurz = befundZu(() => routeCentsEnv("KARTE", "a:5", ["a"]));
  assert.deepEqual(kurz.ergebnis, { a: 5 });
  assert.deepEqual(kurz.befunde, []);

  const ohneDoppelpunkt = befundZu(() => routeCentsEnv("KARTE", "5", [""]));
  assert.deepEqual(ohneDoppelpunkt.ergebnis, {});
  assert.deepEqual(ohneDoppelpunkt.befunde, [
    'KARTE="5" ist keine gueltige Karte profil:ganze-cent (gueltige Profile: ).',
  ]);
});

test("Preise: todayIsoDate liefert den heutigen UTC-Tag als YYYY-MM-DD", () => {
  const heute = todayIsoDate();
  assert.match(heute, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(heute, new Date().toISOString().slice(0, 10));
});

test("Preise: gebaute Staffeln und Kurs haben die festen Standardwerte", () => {
  const preise = config.llm.modelPricesUsd;
  assert.deepEqual(Object.keys(preise).sort(), ["claude-haiku-4-5", "claude-sonnet-5", "deepseek-v4-pro"]);
  assert.equal(preise["claude-haiku-4-5"].outPerMTok, 5);
  assert.equal(preise["claude-haiku-4-5"].validFrom, "2026-08-08");
  assert.equal(preise["claude-haiku-4-5"].source, "https://platform.claude.com/docs/en/about-claude/pricing.md");
  assert.equal(preise["claude-sonnet-5"].inPerMTok, 3);
  assert.equal(preise["claude-sonnet-5"].nextValidFrom, null);
  assert.equal(preise["deepseek-v4-pro"].cacheReadPerMTok, 0.003625);
  assert.equal(preise["deepseek-v4-pro"].source, "https://api-docs.deepseek.com/quick_start/pricing");
  assert.equal(preise["deepseek-v4-pro"].asOf, "2026-08-07");
  assert.throws(
    () => resolveModelPrices({}, "2026-08-08"),
    /modelPricesUsd: keine Preisstaffel hinterlegt - keine Preisquelle fuer den Budget-Guard \(Regel 1\)/,
  );
});

test("Preise: ohne Kurs-Variable gilt 0,92, mit Variable der Wert in Mikro-Einheiten", () => {
  const kurs = (overrides) => {
    const env = kindUmgebung({ ...BASE_ENV, ...overrides, NODE_ENV: "test" });
    const script =
      'import("./src/config.js").then(({ config }) => process.stdout.write(String(config.llm.usdToEur)));';
    return execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: ROOT,
      env,
      encoding: "utf8",
    });
  };
  assert.equal(kurs({ PROVIDER_TO_BUCKET_RATE_MICRO: undefined }), "0.92");
  assert.equal(kurs({ PROVIDER_TO_BUCKET_RATE_MICRO: "500000" }), "0.5");
});

const PREIS_RATEN = { inPerMTok: 1, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1, outPerMTok: 5 };
const staffel = (validFrom, aenderung = {}) => ({ ...PREIS_RATEN, validFrom, ...aenderung });
const aufloesen = (staffeln, stichtag) => resolveModelPrices({ "m-1": staffeln }, stichtag)["m-1"];

test("Preise: validFrom ohne Anker oder fehlend wird mit Modell-ID abgelehnt", () => {
  const abgelehnt = /modelPricesUsd: Staffel 'm-1' ohne gueltiges validFrom \(YYYY-MM-DD\)/;
  for (const validFrom of ["x2026-08-08", "2026-08-08x", undefined, "", "2026-8-08"]) {
    assert.throws(() => aufloesen([staffel(validFrom)], "2026-09-02"), abgelehnt);
  }
  assert.throws(() => aufloesen([null], "2026-09-02"), abgelehnt);
  assert.equal(aufloesen([staffel("2026-08-08")], "2026-09-02").validFrom, "2026-08-08");
});

test("Preise: Rate 0 gilt, negative und nicht endliche Raten werden abgelehnt", () => {
  assert.equal(aufloesen([staffel("2026-08-08", { outPerMTok: 0 })], "2026-09-02").outPerMTok, 0);
  for (const rate of [-1, Number.NaN, Number.POSITIVE_INFINITY, "1", undefined]) {
    assert.throws(
      () => aufloesen([staffel("2026-08-08", { cacheReadPerMTok: rate })], "2026-09-02"),
      /modelPricesUsd: Staffel 'm-1' ab 2026-08-08 hat keine gueltige Rate cacheReadPerMTok \(.*\) - vier Raten sind Pflicht/,
    );
  }
});

test("Preise: aktiv ist die juengste Staffel bis zum Stichtag, unabhaengig von der Reihenfolge", () => {
  const staffeln = [
    staffel("2026-09-01", { inPerMTok: 2 }),
    staffel("2026-08-08", { inPerMTok: 1 }),
    staffel("2026-10-01", { inPerMTok: 3 }),
  ];
  assert.equal(aufloesen(staffeln, "2026-09-15").inPerMTok, 2);
  assert.equal(aufloesen(staffeln, "2026-09-01").inPerMTok, 2);
  assert.equal(aufloesen(staffeln, "2026-08-31").inPerMTok, 1);
  assert.equal(aufloesen(staffeln, "2026-10-01").inPerMTok, 3);
  assert.equal(aufloesen([...staffeln].reverse(), "2026-09-15").inPerMTok, 2);
  assert.equal(aufloesen([staffel("2026-08-08", { inPerMTok: 7 })], "2026-08-08").inPerMTok, 7);
  const doppelt = [staffel("2026-09-01", { inPerMTok: 4 }), staffel("2026-09-01", { inPerMTok: 5 })];
  assert.equal(aufloesen(doppelt, "2026-09-02").inPerMTok, 4);
});

test("Preise: nextValidFrom ist die fruehste kuenftige Staffel oder null", () => {
  const heute = "2026-09-01";
  assert.equal(aufloesen([staffel("2026-08-08")], heute).nextValidFrom, null);
  assert.equal(aufloesen([staffel("2026-08-08"), staffel("2026-09-01")], heute).nextValidFrom, null);
  assert.equal(aufloesen([staffel("2026-08-08"), staffel("2026-12-01")], heute).nextValidFrom, "2026-12-01");
  const zwei = [staffel("2026-08-08"), staffel("2026-12-01"), staffel("2026-10-01")];
  assert.equal(aufloesen(zwei, heute).nextValidFrom, "2026-10-01");
  const drei = [staffel("2026-11-01"), staffel("2026-08-08"), staffel("2026-10-01"), staffel("2026-12-01")];
  assert.equal(aufloesen(drei, heute).nextValidFrom, "2026-10-01");
  const gleich = [staffel("2026-08-08"), staffel("2026-10-01"), staffel("2026-10-01")];
  assert.equal(aufloesen(gleich, heute).nextValidFrom, "2026-10-01");
});

test("Preise: asOf und Quelle der Staffeln vor und nach dem Wechsel am 1. September", () => {
  const preiseAm = (tag) => {
    const script = [
      "const Echt = Date;",
      `globalThis.Date = class extends Echt { constructor(...a) { super(...(a.length ? a : ["${tag}T12:00:00Z"])); } };`,
      'import("./src/config.js").then(({ config }) => process.stdout.write(JSON.stringify(config.llm.modelPricesUsd)));',
    ].join("\n");
    const env = kindUmgebung({ ...BASE_ENV, NODE_ENV: "test" });
    return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: ROOT, env, encoding: "utf8" }));
  };
  const frueh = preiseAm("2026-08-20");
  assert.equal(frueh["claude-sonnet-5"].validFrom, "2026-08-08");
  assert.equal(frueh["claude-sonnet-5"].asOf, "2026-08-08");
  assert.equal(frueh["claude-sonnet-5"].inPerMTok, 2);
  assert.equal(frueh["claude-sonnet-5"].nextValidFrom, "2026-09-01");
  assert.equal(frueh["claude-haiku-4-5"].asOf, "2026-08-08");
  assert.equal(frueh["deepseek-v4-pro"].validFrom, "2026-08-07");
  const spaet = preiseAm("2026-09-01");
  assert.equal(spaet["claude-sonnet-5"].validFrom, "2026-09-01");
  assert.equal(spaet["claude-sonnet-5"].asOf, "2026-08-08");
  assert.match(spaet["claude-sonnet-5"].source, /^https:\/\//);
  assert.match(frueh["claude-haiku-4-5"].source, /^https:\/\//);
});

test("Preise: Stichtag vor allen Staffeln nennt Modell, Tag und Grund", () => {
  assert.throws(
    () => aufloesen([staffel("2026-08-08")], "2026-01-01"),
    /modelPricesUsd: Modell 'm-1' hat am 2026-01-01 keine gueltige Preisstaffel \(kein validFrom liegt in der Vergangenheit\)/,
  );
});

const GATEWAY_URL_VARIABLE = "GATEWAY_URL";
const GEBUNDENER_PORT = 4321;

async function mitGatewayUrl(wert, laden, pruefung) {
  const gemerkt = process.env[GATEWAY_URL_VARIABLE];
  try {
    if (wert === undefined) delete process.env[GATEWAY_URL_VARIABLE];
    else process.env[GATEWAY_URL_VARIABLE] = wert;
    await pruefung(await laden());
  } finally {
    if (gemerkt === undefined) delete process.env[GATEWAY_URL_VARIABLE];
    else process.env[GATEWAY_URL_VARIABLE] = gemerkt;
  }
}

test("Gateway-URL: der gemerkte Port gilt ohne GATEWAY_URL, eine gesetzte GATEWAY_URL geht vor", async () => {
  await mitGatewayUrl(undefined, () => import("../../src/config.js?gw-gebunden"), (frisch) => {
    assert.equal(frisch.resolveGatewayUrl(), `http://localhost:${frisch.config.server.port}`);
    frisch.setBoundGatewayPort(GEBUNDENER_PORT);
    assert.equal(frisch.resolveGatewayUrl(), "http://localhost:4321");
    process.env[GATEWAY_URL_VARIABLE] = "https://gateway.example.test/";
    assert.equal(frisch.resolveGatewayUrl(), "https://gateway.example.test");
  });
});

test("Gateway-URL: der gemerkte Port gehoert zu seiner Konfiguration, eine frisch geladene kennt ihn nicht", async () => {
  await mitGatewayUrl(undefined, () => import("../../src/config.js?gw-getrennt-a"), async (erste) => {
    erste.setBoundGatewayPort(GEBUNDENER_PORT);
    await mitGatewayUrl(undefined, () => import("../../src/config.js?gw-getrennt-b"), (zweite) => {
      assert.equal(zweite.resolveGatewayUrl(), `http://localhost:${zweite.config.server.port}`);
    });
    assert.equal(erste.resolveGatewayUrl(), "http://localhost:4321");
  });
});

test("Oberflaeche: Fehlertexte des Wachters nennen Pfad und Schluessel", () => {
  assert.throws(
    () => config.safety.gibtEsNicht,
    new TypeError(
      "config.safety.gibtEsNicht existiert nicht (verschobener/entfernter Config-Key? " +
        "config.<namespace>.<key> nutzen - Gruppierung in src/config.js pruefen).",
    ),
  );
  assert.throws(
    () => {
      config.gibtEsNicht = 1;
    },
    new TypeError(
      "config.gibtEsNicht kann nicht gesetzt werden (flache Oberflaeche entfernt; " +
        "config.<namespace>.<key> nutzen).",
    ),
  );
  assert.throws(
    () => {
      config.server.gibtEsNicht = 1;
    },
    new TypeError(
      "config.server.gibtEsNicht kann nicht gesetzt werden (flache Oberflaeche entfernt; " +
        "config.<namespace>.<key> nutzen).",
    ),
  );
  assert.equal(config.safety.then, undefined);
  assert.equal(config.safety.toJSON, undefined);
});

test("Oberflaeche: angehaengte Namensraeume sind am Ziel nicht aufzaehlbar und schreiben in denselben Speicher", async () => {
  const { attachNamespaces } = await import("../../src/config.js");
  const ziel = { a: 1, b: 2, c: 3 };
  attachNamespaces(ziel, { eins: ["a", "b"], zwei: ["c"] });
  assert.deepEqual(Object.keys(ziel), ["a", "b", "c"]);
  assert.equal(ziel.eins.b, 2);
  ziel.zwei.c = 30;
  assert.equal(ziel.c, 30);
  assert.deepEqual(Object.keys(ziel.eins), ["a", "b"]);
  assert.equal(Object.getOwnPropertyDescriptor(ziel, "eins").configurable, true);
  assert.equal(Object.getOwnPropertyDescriptor(ziel, "eins").enumerable, false);
});

const ROHWERT_NAMENSRAEUME = ["research", "metrics", "telnyx", "werkzeug", "store", "privacy", "mail", "server"];

function ladeRohwerte(umgebung) {
  const script = [
    'import("./src/config.js").then(({ config, CONFIG_NAMESPACES, configFatalErrors, DEPLOYED_COMMIT_UNKNOWN }) => {',
    `const ergebnis = { fehler: configFatalErrors(), unbekannt: DEPLOYED_COMMIT_UNKNOWN };`,
    `for (const raum of ${JSON.stringify(ROHWERT_NAMENSRAEUME)}) {`,
    "ergebnis[raum] = Object.fromEntries(CONFIG_NAMESPACES[raum].map((schluessel) => [schluessel, config[raum][schluessel]]));",
    "}",
    "process.stdout.write(JSON.stringify(ergebnis));",
    "});",
  ].join("\n");
  const env = kindUmgebung({ NODE_ENV: "test", ...umgebung });
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: ROOT, env, encoding: "utf8" }));
}

test("Rohwerte kleine Namensraeume: ohne Umgebung gelten die Standardwerte", () => {
  const ist = ladeRohwerte({});
  assert.deepEqual(ist.fehler, []);
  assert.deepEqual(ist.research, {
    researchEnabled: false,
    researchMaxUses: 1,
    researchSearchFeeCents: 1,
    lookupEnabled: false,
    lookupSearchFeeCents: 1,
    exaApiKey: "",
    exaApiBase: "https://api.exa.ai",
  });
  assert.deepEqual(ist.metrics, { metricsEnabled: false, logRequestId: false });
  assert.deepEqual(ist.telnyx, { telnyxElevenLabs: { voiceId: "" } });
  assert.deepEqual(ist.werkzeug, { renderApiKey: "" });
  assert.deepEqual(ist.store, {
    storeBackend: "json",
    databaseUrl: "",
    queueBackend: "memory",
    webhookZustellungLoeschtaktMs: 60000,
  });
  assert.deepEqual(ist.privacy, { retentionDays: 30, diagnosticRetentionDays: 7, evidenceRetentionDays: 0 });
  assert.deepEqual(ist.mail, {
    brevoApiKey: "",
    smtpHost: "",
    smtpPort: 465,
    smtpUser: "",
    smtpPassword: "",
    mailFrom: "",
    platformAlertMailTo: "",
  });
  assert.deepEqual(ist.server, {
    port: 3000,
    publicUrl: "",
    publicUrlExplicit: false,
    isProduction: false,
    deployedCommit: "unbekannt",
    openaiAppsChallengeToken: "",
    dataDir: `${ROOT}/data`,
    publicDir: `${ROOT}/public`,
    webDistDir: "",
    shutdownDrainTimeoutMs: 8000,
    herzschlagUrl: "",
    herzschlagTaktMs: 60000,
    herzschlagVerzugGrenzeMs: 2000,
    herzschlagFristMs: 5000,
  });
  assert.equal(ist.unbekannt, "unbekannt");
});

test("Rohwerte kleine Namensraeume: gesetzte Werte werden gelesen, gekuerzt und normalisiert", () => {
  const ist = ladeRohwerte({
    RESEARCH_ENABLED: "true",
    RESEARCH_SEARCH_FEE_CENTS: "7",
    LOOKUP_ENABLED: "true",
    LOOKUP_SEARCH_FEE_CENTS: "9",
    EXA_API_KEY: "  exa-key  ",
    EXA_API_BASE: " https://exa.test/ ",
    METRICS_ENABLED: "true",
    LOG_REQUEST_ID: "true",
    TELNYX_ELEVENLABS_VOICE_ID: "stimme-1",
    RENDER_API_KEY: "  render-key ",
    STORE_BACKEND: "Postgres",
    DATABASE_URL: "postgres://db.test/x",
    QUEUE_BACKEND: "Redis",
    WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS: "500",
    RETENTION_DAYS: "11",
    DIAGNOSTIC_RETENTION_DAYS: "12",
    EVIDENCE_RETENTION_DAYS: "13",
    BREVO_API_KEY: "brevo-key",
    SMTP_HOST: "smtp.test",
    SMTP_PORT: "587",
    SMTP_USER: "smtp-user",
    SMTP_PASSWORD: "smtp-pass",
    MAIL_FROM: "von@test.example",
    PLATFORM_ALERT_MAIL_TO: "alarm@test.example",
    PORT: "4321",
    PUBLIC_URL: "https://p.test/",
    RENDER_EXTERNAL_URL: "https://r.test/",
    RENDER_GIT_COMMIT: "abc123",
    OPENAI_APPS_CHALLENGE_TOKEN: "  challenge ",
    SHUTDOWN_DRAIN_TIMEOUT_MS: "9000",
    HERZSCHLAG_URL: "https://herz.test",
    HERZSCHLAG_TAKT_MS: "20000",
    HERZSCHLAG_VERZUG_GRENZE_MS: "3000",
    HERZSCHLAG_FRIST_MS: "6000",
    DATA_DIR: "/tmp/hermes-daten",
    WEB_DIST_DIR: "web-ziel",
  });
  assert.deepEqual(ist.fehler, []);
  assert.deepEqual(ist.research, {
    researchEnabled: true,
    researchMaxUses: 1,
    researchSearchFeeCents: 7,
    lookupEnabled: true,
    lookupSearchFeeCents: 9,
    exaApiKey: "exa-key",
    exaApiBase: "https://exa.test",
  });
  assert.deepEqual(ist.metrics, { metricsEnabled: true, logRequestId: true });
  assert.deepEqual(ist.telnyx, { telnyxElevenLabs: { voiceId: "stimme-1" } });
  assert.deepEqual(ist.werkzeug, { renderApiKey: "render-key" });
  assert.deepEqual(ist.store, {
    storeBackend: "postgres",
    databaseUrl: "postgres://db.test/x",
    queueBackend: "redis",
    webhookZustellungLoeschtaktMs: 500,
  });
  assert.deepEqual(ist.privacy, { retentionDays: 11, diagnosticRetentionDays: 12, evidenceRetentionDays: 13 });
  assert.deepEqual(ist.mail, {
    brevoApiKey: "brevo-key",
    smtpHost: "smtp.test",
    smtpPort: 587,
    smtpUser: "smtp-user",
    smtpPassword: "smtp-pass",
    mailFrom: "von@test.example",
    platformAlertMailTo: "alarm@test.example",
  });
  assert.deepEqual(ist.server, {
    port: 4321,
    publicUrl: "https://p.test",
    publicUrlExplicit: true,
    isProduction: true,
    deployedCommit: "abc123",
    openaiAppsChallengeToken: "challenge",
    dataDir: "/tmp/hermes-daten",
    publicDir: `${ROOT}/public`,
    webDistDir: `${ROOT}/web-ziel`,
    shutdownDrainTimeoutMs: 9000,
    herzschlagUrl: "https://herz.test",
    herzschlagTaktMs: 20000,
    herzschlagVerzugGrenzeMs: 3000,
    herzschlagFristMs: 6000,
  });
});

test("Rohwerte kleine Namensraeume: ohne PUBLIC_URL gilt die Render-Adresse und gilt nicht als ausdruecklich", () => {
  const ist = ladeRohwerte({ RENDER_EXTERNAL_URL: "https://r.test/" });
  assert.equal(ist.server.publicUrl, "https://r.test");
  assert.equal(ist.server.publicUrlExplicit, false);
  assert.equal(ist.server.isProduction, true);
  assert.equal(ladeRohwerte({ PUBLIC_URL: "   " }).server.publicUrlExplicit, false);
});

const ROHWERTE_AM_MINIMUM = {
  RESEARCH_SEARCH_FEE_CENTS: "0",
  LOOKUP_SEARCH_FEE_CENTS: "0",
  WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS: "100",
  RETENTION_DAYS: "0",
  DIAGNOSTIC_RETENTION_DAYS: "0",
  SMTP_PORT: "1",
  PORT: "0",
  SHUTDOWN_DRAIN_TIMEOUT_MS: "0",
  HERZSCHLAG_TAKT_MS: "10",
  HERZSCHLAG_VERZUG_GRENZE_MS: "5",
  HERZSCHLAG_FRIST_MS: "10",
};

test("Rohwerte kleine Namensraeume: genau am Minimum gilt der Wert ohne Befund", () => {
  const ist = ladeRohwerte(ROHWERTE_AM_MINIMUM);
  assert.deepEqual(ist.fehler, []);
  assert.equal(ist.research.researchSearchFeeCents, 0);
  assert.equal(ist.research.lookupSearchFeeCents, 0);
  assert.equal(ist.store.webhookZustellungLoeschtaktMs, 100);
  assert.equal(ist.privacy.retentionDays, 0);
  assert.equal(ist.privacy.diagnosticRetentionDays, 0);
  assert.equal(ist.mail.smtpPort, 1);
  assert.equal(ist.server.port, 0);
  assert.equal(ist.server.shutdownDrainTimeoutMs, 0);
  assert.equal(ist.server.herzschlagTaktMs, 10);
  assert.equal(ist.server.herzschlagVerzugGrenzeMs, 5);
  assert.equal(ist.server.herzschlagFristMs, 10);
});

test("Rohwerte kleine Namensraeume: unter dem Minimum gilt der Standardwert mit Befund je Variable", () => {
  const ist = ladeRohwerte({
    RESEARCH_SEARCH_FEE_CENTS: "-1",
    LOOKUP_SEARCH_FEE_CENTS: "-1",
    WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS: "99",
    RETENTION_DAYS: "-1",
    DIAGNOSTIC_RETENTION_DAYS: "-1",
    EVIDENCE_RETENTION_DAYS: "-1",
    SMTP_PORT: "0",
    PORT: "-1",
    SHUTDOWN_DRAIN_TIMEOUT_MS: "-1",
    HERZSCHLAG_TAKT_MS: "9",
    HERZSCHLAG_VERZUG_GRENZE_MS: "4",
    HERZSCHLAG_FRIST_MS: "9",
  });
  assert.equal(ist.research.researchSearchFeeCents, 1);
  assert.equal(ist.research.lookupSearchFeeCents, 1);
  assert.equal(ist.store.webhookZustellungLoeschtaktMs, 60000);
  assert.deepEqual(ist.privacy, { retentionDays: 30, diagnosticRetentionDays: 7, evidenceRetentionDays: 0 });
  assert.equal(ist.mail.smtpPort, 465);
  assert.equal(ist.server.port, 3000);
  assert.equal(ist.server.shutdownDrainTimeoutMs, 8000);
  assert.equal(ist.server.herzschlagTaktMs, 60000);
  assert.equal(ist.server.herzschlagVerzugGrenzeMs, 2000);
  assert.equal(ist.server.herzschlagFristMs, 5000);
  assert.equal(ist.fehler.length, 12);
  for (const name of Object.keys({ ...ROHWERTE_AM_MINIMUM, EVIDENCE_RETENTION_DAYS: 0 })) {
    assert.equal(ist.fehler.filter((befund) => befund.startsWith(`${name}=`)).length, 1, name);
  }
});

test("Rohwerte kleine Namensraeume: ueber dem Maximum gilt das Maximum, am Maximum der Wert", () => {
  const ueber = ladeRohwerte({
    WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS: "60001",
    SHUTDOWN_DRAIN_TIMEOUT_MS: "110001",
    HERZSCHLAG_TAKT_MS: "3600001",
    HERZSCHLAG_VERZUG_GRENZE_MS: "60001",
    HERZSCHLAG_FRIST_MS: "60001",
  });
  assert.deepEqual(ueber.fehler, []);
  assert.equal(ueber.store.webhookZustellungLoeschtaktMs, 60000);
  assert.equal(ueber.server.shutdownDrainTimeoutMs, 110000);
  assert.equal(ueber.server.herzschlagTaktMs, 3600000);
  assert.equal(ueber.server.herzschlagVerzugGrenzeMs, 60000);
  assert.equal(ueber.server.herzschlagFristMs, 60000);
  const genau = ladeRohwerte({
    WEBHOOK_ZUSTELLUNG_LOESCHTAKT_MS: "60000",
    SHUTDOWN_DRAIN_TIMEOUT_MS: "110000",
    HERZSCHLAG_TAKT_MS: "3600000",
    HERZSCHLAG_VERZUG_GRENZE_MS: "60000",
    HERZSCHLAG_FRIST_MS: "60000",
  });
  assert.equal(genau.store.webhookZustellungLoeschtaktMs, 60000);
  assert.equal(genau.server.shutdownDrainTimeoutMs, 110000);
  assert.equal(genau.server.herzschlagTaktMs, 3600000);
  assert.equal(genau.server.herzschlagVerzugGrenzeMs, 60000);
  assert.equal(genau.server.herzschlagFristMs, 60000);
});

test("Rohwerte kleine Namensraeume: ungueltige Schalter in Metrik und Recherche melden den Namen und gelten als aus", () => {
  const namen = ["METRICS_ENABLED", "LOG_REQUEST_ID", "RESEARCH_ENABLED", "LOOKUP_ENABLED"];
  const ist = ladeRohwerte(Object.fromEntries(namen.map((name) => [name, "kaputt"])));
  assert.equal(ist.metrics.metricsEnabled, false);
  assert.equal(ist.metrics.logRequestId, false);
  assert.equal(ist.research.researchEnabled, false);
  assert.equal(ist.research.lookupEnabled, false);
  assert.equal(ist.fehler.length, 4);
  for (const name of namen) {
    assert.equal(ist.fehler.filter((befund) => befund.startsWith(`${name}="kaputt"`)).length, 1, name);
  }
});

const ROHWERT_NAMENSRAEUME_GROSS = ["telephony", "tenancy", "provisioning"];

function ladeGrosseRohwerte(umgebung) {
  const script = [
    'import("./src/config.js").then(({ config, CONFIG_NAMESPACES, configFatalErrors }) => {',
    "const ergebnis = { fehler: configFatalErrors() };",
    `for (const raum of ${JSON.stringify(ROHWERT_NAMENSRAEUME_GROSS)}) {`,
    "ergebnis[raum] = Object.fromEntries(CONFIG_NAMESPACES[raum].map((schluessel) => [schluessel, config[raum][schluessel]]));",
    "}",
    "process.stdout.write(JSON.stringify(ergebnis));",
    "});",
  ].join("\n");
  const env = kindUmgebung({ NODE_ENV: "test", ...umgebung });
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: ROOT, env, encoding: "utf8" }));
}

test("Rohwerte Telefonie, Mandanten, Nummernvergabe: ohne Umgebung gelten die Standardwerte", () => {
  const ist = ladeGrosseRohwerte({});
  assert.deepEqual(ist.fehler, []);
  assert.deepEqual(ist.telephony, {
    telnyxApiKey: "",
    telnyxPublicKey: "",
    telnyxApiBase: "https://api.telnyx.com",
    telnyxConnectionId: "",
    telnyxCallControlAppId: "",
    telnyxAccountSid: "",
    machineDetection: { enabled: false, timeoutS: 5 },
    telnyxSipTrunkUsername: "",
    telnyxSipTrunkPassword: "",
  });
  assert.deepEqual(ist.tenancy, {
    multiTenant: false,
    mcpUiEnabled: true,
    assistantContextEnabled: true,
    selfServiceEnabled: false,
    profilesSeed: "",
    precallBriefingEnabled: false,
    consultEnabled: false,
    inCallConsultEnabled: false,
    consultWaitMs: 4000,
    consultOpenMs: 47000,
    elConsultDeliveryMs: 5000,
    elConsultAckMs: 5000,
    elConsultAnswerMs: 30000,
  });
  assert.deepEqual(ist.provisioning, {
    maxNumbers: 5,
    maxNumbersPerTenant: 1,
    provisioningEnabled: false,
    provisioningRedriveMaxAgeMs: 0,
    provisioningRetryMaxAttempts: 3,
    provisioningRetryMinIntervalMs: MS_JE_TAG,
    releaseGraceMs: 0,
    provisioningCountry: "DE",
    geoEnabled: false,
    geoDbPath: "",
    worldDefaultLanguageEnabled: false,
    ownerNumberSeed: "",
    ownerNumberProvider: "",
    bootstrapE164: "",
    bootstrapProvider: "",
    platformAniE164: "",
  });
});

test("Rohwerte Telefonie, Mandanten, Nummernvergabe: gesetzte Werte werden gelesen, gekuerzt und normalisiert", () => {
  const ist = ladeGrosseRohwerte({
    TELNYX_API_KEY: "k1",
    TELNYX_PUBLIC_KEY: "p1",
    TELNYX_API_BASE: "https://telnyx.test/",
    TELNYX_CONNECTION_ID: "c1",
    TELNYX_CALL_CONTROL_APP_ID: "  app1  ",
    TELNYX_ACCOUNT_SID: "sid1",
    TELNYX_SIP_TRUNK_USERNAME: "  nutzer  ",
    TELNYX_SIP_TRUNK_PASSWORD: " pw ",
    MACHINE_DETECTION_ENABLED: "true",
    MACHINE_DETECTION_TIMEOUT_S: "9",
    MULTI_TENANT: "true",
    MCP_UI_ENABLED: "false",
    ASSISTANT_CONTEXT_ENABLED: "false",
    SELF_SERVICE_ENABLED: "true",
    PROFILES_JSON: "[]",
    PRECALL_BRIEFING_ENABLED: "true",
    CONSULT_ENABLED: "true",
    IN_CALL_CONSULT_ENABLED: "true",
    CONSULT_WAIT_MS: "1111",
    CONSULT_OPEN_MS: "2222",
    EL_CONSULT_DELIVERY_MS: "3333",
    EL_CONSULT_ACK_MS: "4444",
    EL_CONSULT_ANSWER_MS: "5555",
    MAX_NUMBERS: "7",
    MAX_NUMBERS_PER_TENANT: "2",
    PROVISIONING_ENABLED: "true",
    PROVISIONING_REDRIVE_MAX_AGE_MS: "1000",
    PROVISIONING_RETRY_MAX_ATTEMPTS: "4",
    PROVISIONING_RETRY_MIN_INTERVAL_MS: "2000",
    RELEASE_GRACE_DAYS: "3",
    PROVISIONING_COUNTRY: "AT",
    GEO_ENABLED: "true",
    GEO_DB_PATH: "/geo.db",
    WORLD_DEFAULT_LANGUAGE_ENABLED: "true",
    OWNER_NUMBER_SEED: "+4915100000001",
    OWNER_NUMBER_PROVIDER: "TeLnYx",
    BOOTSTRAP_E164: "+4915100000002",
    BOOTSTRAP_PROVIDER: "telnyx",
    PLATFORM_ANI_E164: "  +4915100000003  ",
  });
  assert.deepEqual(ist.fehler, []);
  assert.deepEqual(ist.telephony, {
    telnyxApiKey: "k1",
    telnyxPublicKey: "p1",
    telnyxApiBase: "https://telnyx.test",
    telnyxConnectionId: "c1",
    telnyxCallControlAppId: "app1",
    telnyxAccountSid: "sid1",
    machineDetection: { enabled: true, timeoutS: 9 },
    telnyxSipTrunkUsername: "nutzer",
    telnyxSipTrunkPassword: " pw ",
  });
  assert.deepEqual(ist.tenancy, {
    multiTenant: true,
    mcpUiEnabled: false,
    assistantContextEnabled: false,
    selfServiceEnabled: true,
    profilesSeed: "[]",
    precallBriefingEnabled: true,
    consultEnabled: true,
    inCallConsultEnabled: true,
    consultWaitMs: 1111,
    consultOpenMs: 2222,
    elConsultDeliveryMs: 3333,
    elConsultAckMs: 4444,
    elConsultAnswerMs: 5555,
  });
  assert.deepEqual(ist.provisioning, {
    maxNumbers: 7,
    maxNumbersPerTenant: 2,
    provisioningEnabled: true,
    provisioningRedriveMaxAgeMs: 1000,
    provisioningRetryMaxAttempts: 4,
    provisioningRetryMinIntervalMs: 2000,
    releaseGraceMs: 3 * MS_JE_TAG,
    provisioningCountry: "AT",
    geoEnabled: true,
    geoDbPath: "/geo.db",
    worldDefaultLanguageEnabled: true,
    ownerNumberSeed: "+4915100000001",
    ownerNumberProvider: "telnyx",
    bootstrapE164: "+4915100000002",
    bootstrapProvider: "telnyx",
    platformAniE164: "+4915100000003",
  });
});

const GROSSE_ROHWERTE_AM_MINIMUM = {
  MACHINE_DETECTION_TIMEOUT_S: "3",
  CONSULT_WAIT_MS: "0",
  CONSULT_OPEN_MS: "0",
  EL_CONSULT_DELIVERY_MS: "0",
  EL_CONSULT_ACK_MS: "0",
  EL_CONSULT_ANSWER_MS: "0",
  MAX_NUMBERS: "0",
  MAX_NUMBERS_PER_TENANT: "0",
  PROVISIONING_REDRIVE_MAX_AGE_MS: "0",
  PROVISIONING_RETRY_MAX_ATTEMPTS: "0",
  PROVISIONING_RETRY_MIN_INTERVAL_MS: "0",
  RELEASE_GRACE_DAYS: "0",
};

test("Rohwerte Telefonie, Mandanten, Nummernvergabe: genau am Minimum gilt der Wert ohne Befund", () => {
  const ist = ladeGrosseRohwerte(GROSSE_ROHWERTE_AM_MINIMUM);
  assert.deepEqual(ist.fehler, []);
  assert.equal(ist.telephony.machineDetection.timeoutS, 3);
  assert.equal(ist.tenancy.consultWaitMs, 0);
  assert.equal(ist.tenancy.consultOpenMs, 0);
  assert.equal(ist.tenancy.elConsultDeliveryMs, 0);
  assert.equal(ist.tenancy.elConsultAckMs, 0);
  assert.equal(ist.tenancy.elConsultAnswerMs, 0);
  assert.equal(ist.provisioning.maxNumbers, 0);
  assert.equal(ist.provisioning.maxNumbersPerTenant, 0);
  assert.equal(ist.provisioning.provisioningRetryMaxAttempts, 0);
  assert.equal(ist.provisioning.provisioningRetryMinIntervalMs, 0);
  assert.equal(ist.provisioning.releaseGraceMs, 0);
});

test("Rohwerte Telefonie, Mandanten, Nummernvergabe: unter dem Minimum gilt der Standardwert mit Befund je Variable", () => {
  const unter = Object.fromEntries(
    Object.keys(GROSSE_ROHWERTE_AM_MINIMUM).map((name) => [name, name === "MACHINE_DETECTION_TIMEOUT_S" ? "2" : "-1"]),
  );
  const ist = ladeGrosseRohwerte(unter);
  assert.equal(ist.telephony.machineDetection.timeoutS, 5);
  assert.equal(ist.tenancy.consultWaitMs, 4000);
  assert.equal(ist.tenancy.consultOpenMs, 47000);
  assert.equal(ist.tenancy.elConsultDeliveryMs, 5000);
  assert.equal(ist.tenancy.elConsultAckMs, 5000);
  assert.equal(ist.tenancy.elConsultAnswerMs, 30000);
  assert.equal(ist.provisioning.maxNumbers, 5);
  assert.equal(ist.provisioning.maxNumbersPerTenant, 1);
  assert.equal(ist.provisioning.provisioningRedriveMaxAgeMs, 0);
  assert.equal(ist.provisioning.provisioningRetryMaxAttempts, 3);
  assert.equal(ist.provisioning.provisioningRetryMinIntervalMs, MS_JE_TAG);
  assert.equal(ist.provisioning.releaseGraceMs, 0);
  assert.equal(ist.fehler.length, 12);
  for (const name of Object.keys(GROSSE_ROHWERTE_AM_MINIMUM)) {
    assert.equal(ist.fehler.filter((befund) => befund.startsWith(`${name}=`)).length, 1, name);
  }
});

test("Rohwerte Telefonie, Mandanten, Nummernvergabe: ueber dem Maximum gilt das Maximum, am Maximum der Wert", () => {
  const ueber = ladeGrosseRohwerte({
    MACHINE_DETECTION_TIMEOUT_S: "31",
    CONSULT_WAIT_MS: "60001",
    CONSULT_OPEN_MS: "300001",
    EL_CONSULT_DELIVERY_MS: "55001",
    EL_CONSULT_ACK_MS: "55001",
    EL_CONSULT_ANSWER_MS: "55001",
    PROVISIONING_REDRIVE_MAX_AGE_MS: String(MS_JE_TAG),
  });
  assert.deepEqual(ueber.fehler, []);
  assert.equal(ueber.telephony.machineDetection.timeoutS, 30);
  assert.equal(ueber.tenancy.consultWaitMs, 60000);
  assert.equal(ueber.tenancy.consultOpenMs, 300000);
  assert.equal(ueber.tenancy.elConsultDeliveryMs, 55000);
  assert.equal(ueber.tenancy.elConsultAckMs, 55000);
  assert.equal(ueber.tenancy.elConsultAnswerMs, 55000);
  assert.equal(ueber.provisioning.provisioningRedriveMaxAgeMs, MS_JE_TAG - 1);
  const genau = ladeGrosseRohwerte({
    MACHINE_DETECTION_TIMEOUT_S: "30",
    CONSULT_WAIT_MS: "60000",
    CONSULT_OPEN_MS: "300000",
    EL_CONSULT_DELIVERY_MS: "55000",
    EL_CONSULT_ACK_MS: "55000",
    EL_CONSULT_ANSWER_MS: "55000",
    PROVISIONING_REDRIVE_MAX_AGE_MS: String(MS_JE_TAG - 1),
  });
  assert.equal(genau.telephony.machineDetection.timeoutS, 30);
  assert.equal(genau.tenancy.consultWaitMs, 60000);
  assert.equal(genau.tenancy.consultOpenMs, 300000);
  assert.equal(genau.tenancy.elConsultDeliveryMs, 55000);
  assert.equal(genau.tenancy.elConsultAckMs, 55000);
  assert.equal(genau.tenancy.elConsultAnswerMs, 55000);
  assert.equal(genau.provisioning.provisioningRedriveMaxAgeMs, MS_JE_TAG - 1);
});

test("Rohwerte Telefonie, Mandanten, Nummernvergabe: ungueltige Schalter melden den Namen und gelten als Standard", () => {
  const schalter = {
    MACHINE_DETECTION_ENABLED: false,
    MULTI_TENANT: false,
    MCP_UI_ENABLED: true,
    ASSISTANT_CONTEXT_ENABLED: true,
    SELF_SERVICE_ENABLED: false,
    PRECALL_BRIEFING_ENABLED: false,
    CONSULT_ENABLED: false,
    IN_CALL_CONSULT_ENABLED: false,
    PROVISIONING_ENABLED: false,
    GEO_ENABLED: false,
    WORLD_DEFAULT_LANGUAGE_ENABLED: false,
  };
  const ist = ladeGrosseRohwerte(Object.fromEntries(Object.keys(schalter).map((name) => [name, "kaputt"])));
  assert.equal(ist.fehler.length, 11);
  for (const name of Object.keys(schalter)) {
    assert.equal(ist.fehler.filter((befund) => befund.startsWith(`${name}=`)).length, 1, name);
  }
  assert.equal(ist.telephony.machineDetection.enabled, false);
  assert.equal(ist.tenancy.mcpUiEnabled, true);
  assert.equal(ist.tenancy.assistantContextEnabled, true);
  assert.equal(ist.tenancy.multiTenant, false);
  assert.equal(ist.provisioning.provisioningEnabled, false);
});

const ROHWERT_NAMENSRAEUME_AUTH_LLM = ["auth", "llm"];

function ladeAuthLlmRohwerte(umgebung) {
  const script = [
    'import("./src/config.js").then(({ config, CONFIG_NAMESPACES, configFatalErrors }) => {',
    "const ergebnis = { fehler: configFatalErrors() };",
    `for (const raum of ${JSON.stringify(ROHWERT_NAMENSRAEUME_AUTH_LLM)}) {`,
    "ergebnis[raum] = Object.fromEntries(CONFIG_NAMESPACES[raum].map((schluessel) => [schluessel, config[raum][schluessel]]));",
    "}",
    "process.stdout.write(JSON.stringify(ergebnis));",
    "});",
  ].join("\n");
  const env = kindUmgebung({ NODE_ENV: "test", ...umgebung });
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: ROOT, env, encoding: "utf8" }));
}

test("Rohwerte Anmeldung und Sprachmodell: ohne Umgebung gelten die Standardwerte", () => {
  const ist = ladeAuthLlmRohwerte({});
  assert.deepEqual(ist.fehler, []);
  assert.deepEqual(ist.auth, {
    mcpAuthToken: "",
    mcpAuth: "",
    oauthIssuerUrl: "",
    oauthAudience: "",
    sessionSecret: "",
    oidcClientId: "",
    oidcClientSecret: "",
    workosApiBase: "https://api.workos.com",
    workosManagementApiKey: "",
    adminEmails: [],
    loginRateLimitPerMin: 10,
    sessionTtlSeconds: 3600,
    loginCookieTtlSeconds: 1800,
    dashboardPassword: "",
    ownerIdpSubject: "",
    devLoginEnabled: false,
    webhookZustellungSecret: "",
    deployToken: "",
    statusToken: "",
  });
  assert.equal(ist.llm.anthropicApiKey, "");
  assert.equal(ist.llm.llmProvider, "anthropic");
  assert.equal(ist.llm.deepseekApiKey, "");
  assert.equal(ist.llm.claudeModel, "claude-haiku-4-5");
  assert.equal(ist.llm.llmRequestTimeoutMs, 3500);
  assert.equal(ist.llm.llmMaxRetries, 2);
  assert.equal(ist.llm.llmBackoffMs, 250);
  assert.equal(ist.llm.llmBreakerThreshold, 5);
  assert.equal(ist.llm.llmBreakerWindowMs, 10000);
  assert.equal(ist.llm.llmBreakerCooldownMs, 30000);
  assert.equal(ist.llm.llmProviderFallback, "");
  assert.equal(ist.llm.llmBillingLatchCooldownMs, 900000);
  assert.equal(ist.llm.briefingModel, "claude-sonnet-5");
  assert.equal(ist.llm.briefingTimeoutMs, 6000);
  assert.equal(ist.llm.summaryTimeoutMs, 20000);
});

test("Rohwerte Anmeldung und Sprachmodell: gesetzte Werte werden gelesen, gekuerzt und normalisiert", () => {
  const ist = ladeAuthLlmRohwerte({
    MCP_AUTH_TOKEN: "t1",
    MCP_AUTH: "OAuth",
    OAUTH_ISSUER_URL: "https://idp.test/",
    OAUTH_AUDIENCE: "aud1",
    SESSION_SECRET: "s1",
    OIDC_CLIENT_ID: "cid",
    OIDC_CLIENT_SECRET: "csec",
    WEBHOOK_ZUSTELLUNG_SECRET: "wz",
    HERMES_DEPLOY_TOKEN: "  dep  ",
    HERMES_STATUS_TOKEN: "  stat  ",
    WORKOS_API_BASE: "https://workos.test/",
    WORKOS_MANAGEMENT_API_KEY: "wk",
    ADMIN_EMAILS: "A@X.de, B@Y.de",
    LOGIN_RATE_LIMIT_PER_MIN: "4",
    SESSION_TTL_SECONDS: "5",
    LOGIN_COOKIE_TTL_SECONDS: "6",
    DASHBOARD_PASSWORD: "pw",
    OWNER_IDP_SUBJECT: "sub1",
    DEV_LOGIN_ENABLED: "true",
    ANTHROPIC_API_KEY: "ak",
    LLM_PROVIDER: "deepseek",
    DEEPSEEK_API_KEY: "dk",
    LLM_PROVIDER_FALLBACK: "anthropic",
    CLAUDE_MODEL: "modell-x",
    LLM_REQUEST_TIMEOUT_MS: "11",
    LLM_MAX_RETRIES: "3",
    LLM_BACKOFF_MS: "12",
    LLM_BREAKER_THRESHOLD: "7",
    LLM_BREAKER_WINDOW_MS: "13",
    LLM_BREAKER_COOLDOWN_MS: "14",
    LLM_BILLING_LATCH_COOLDOWN_MS: "15",
    PRECALL_BRIEFING_MODEL: "modell-b",
    PRECALL_BRIEFING_TIMEOUT_MS: "16",
    CALL_SUMMARY_TIMEOUT_MS: "17",
  });
  assert.deepEqual(ist.fehler, []);
  assert.deepEqual(ist.auth, {
    mcpAuthToken: "t1",
    mcpAuth: "oauth",
    oauthIssuerUrl: "https://idp.test",
    oauthAudience: "aud1",
    sessionSecret: "s1",
    oidcClientId: "cid",
    oidcClientSecret: "csec",
    workosApiBase: "https://workos.test",
    workosManagementApiKey: "wk",
    adminEmails: ["a@x.de", "b@y.de"],
    loginRateLimitPerMin: 4,
    sessionTtlSeconds: 5,
    loginCookieTtlSeconds: 6,
    dashboardPassword: "pw",
    ownerIdpSubject: "sub1",
    devLoginEnabled: true,
    webhookZustellungSecret: "wz",
    deployToken: "dep",
    statusToken: "stat",
  });
  assert.equal(ist.llm.anthropicApiKey, "ak");
  assert.equal(ist.llm.llmProvider, "deepseek");
  assert.equal(ist.llm.deepseekApiKey, "dk");
  assert.equal(ist.llm.llmProviderFallback, "anthropic");
  assert.equal(ist.llm.claudeModel, "modell-x");
  assert.equal(ist.llm.llmRequestTimeoutMs, 11);
  assert.equal(ist.llm.llmMaxRetries, 3);
  assert.equal(ist.llm.llmBackoffMs, 12);
  assert.equal(ist.llm.llmBreakerThreshold, 7);
  assert.equal(ist.llm.llmBreakerWindowMs, 13);
  assert.equal(ist.llm.llmBreakerCooldownMs, 14);
  assert.equal(ist.llm.llmBillingLatchCooldownMs, 15);
  assert.equal(ist.llm.briefingModel, "modell-b");
  assert.equal(ist.llm.briefingTimeoutMs, 16);
  assert.equal(ist.llm.summaryTimeoutMs, 17);
});

test("Rohwerte Anmeldung und Sprachmodell: Dev-Login gilt auf Render nie, auch wenn er gesetzt ist", () => {
  const render = ladeAuthLlmRohwerte({ DEV_LOGIN_ENABLED: "true", RENDER_EXTERNAL_URL: "https://r.test" });
  assert.equal(render.auth.devLoginEnabled, false);
  assert.equal(ladeAuthLlmRohwerte({ DEV_LOGIN_ENABLED: "true" }).auth.devLoginEnabled, true);
  assert.equal(ladeAuthLlmRohwerte({ RENDER_EXTERNAL_URL: "https://r.test" }).auth.devLoginEnabled, false);
});

const AUTH_LLM_AM_MINIMUM = {
  LOGIN_RATE_LIMIT_PER_MIN: ["0", 10],
  SESSION_TTL_SECONDS: ["0", 3600],
  LOGIN_COOKIE_TTL_SECONDS: ["0", 1800],
  LLM_REQUEST_TIMEOUT_MS: ["1", 3500],
  LLM_MAX_RETRIES: ["0", 2],
  LLM_BACKOFF_MS: ["0", 250],
  LLM_BREAKER_THRESHOLD: ["1", 5],
  LLM_BREAKER_WINDOW_MS: ["1", 10000],
  LLM_BREAKER_COOLDOWN_MS: ["1", 30000],
  LLM_BILLING_LATCH_COOLDOWN_MS: ["1", 900000],
  PRECALL_BRIEFING_TIMEOUT_MS: ["1", 6000],
  CALL_SUMMARY_TIMEOUT_MS: ["1", 20000],
};

function wert(ist, name) {
  const schluessel = {
    LOGIN_RATE_LIMIT_PER_MIN: ["auth", "loginRateLimitPerMin"],
    SESSION_TTL_SECONDS: ["auth", "sessionTtlSeconds"],
    LOGIN_COOKIE_TTL_SECONDS: ["auth", "loginCookieTtlSeconds"],
    LLM_REQUEST_TIMEOUT_MS: ["llm", "llmRequestTimeoutMs"],
    LLM_MAX_RETRIES: ["llm", "llmMaxRetries"],
    LLM_BACKOFF_MS: ["llm", "llmBackoffMs"],
    LLM_BREAKER_THRESHOLD: ["llm", "llmBreakerThreshold"],
    LLM_BREAKER_WINDOW_MS: ["llm", "llmBreakerWindowMs"],
    LLM_BREAKER_COOLDOWN_MS: ["llm", "llmBreakerCooldownMs"],
    LLM_BILLING_LATCH_COOLDOWN_MS: ["llm", "llmBillingLatchCooldownMs"],
    PRECALL_BRIEFING_TIMEOUT_MS: ["llm", "briefingTimeoutMs"],
    CALL_SUMMARY_TIMEOUT_MS: ["llm", "summaryTimeoutMs"],
  }[name];
  return ist[schluessel[0]][schluessel[1]];
}

test("Rohwerte Anmeldung und Sprachmodell: genau am Minimum gilt der Wert ohne Befund", () => {
  const ist = ladeAuthLlmRohwerte(
    Object.fromEntries(Object.entries(AUTH_LLM_AM_MINIMUM).map(([name, [minimum]]) => [name, minimum])),
  );
  assert.deepEqual(ist.fehler, []);
  for (const [name, [minimum]] of Object.entries(AUTH_LLM_AM_MINIMUM)) {
    assert.equal(wert(ist, name), Number(minimum), name);
  }
});

test("Rohwerte Anmeldung und Sprachmodell: unter dem Minimum gilt der Standardwert mit Befund je Variable", () => {
  const ist = ladeAuthLlmRohwerte(
    Object.fromEntries(
      Object.entries(AUTH_LLM_AM_MINIMUM).map(([name, [minimum]]) => [name, String(Number(minimum) - 1)]),
    ),
  );
  assert.equal(ist.fehler.length, 12);
  for (const [name, [, standard]] of Object.entries(AUTH_LLM_AM_MINIMUM)) {
    assert.equal(wert(ist, name), standard, name);
    assert.equal(ist.fehler.filter((befund) => befund.startsWith(`${name}=`)).length, 1, name);
  }
});

test("Rohwerte Anmeldung und Sprachmodell: unbekannter Anbieter und ungueltiger Schalter melden den Namen", () => {
  const ist = ladeAuthLlmRohwerte({
    LLM_PROVIDER: "unbekannt",
    LLM_PROVIDER_FALLBACK: "unbekannt",
    DEV_LOGIN_ENABLED: "kaputt",
  });
  assert.equal(ist.fehler.length, 3);
  for (const name of ["LLM_PROVIDER", "LLM_PROVIDER_FALLBACK", "DEV_LOGIN_ENABLED"]) {
    assert.equal(ist.fehler.filter((befund) => befund.startsWith(`${name}=`)).length, 1, name);
  }
  assert.equal(ist.llm.llmProvider, "anthropic");
  assert.equal(ist.llm.llmProviderFallback, "");
  assert.equal(ist.auth.devLoginEnabled, false);
});

function ladeSicherheitStimmeRohwerte(umgebung) {
  const script = [
    'import("./src/config.js").then(({ config, CONFIG_NAMESPACES, configFatalErrors }) => {',
    "const ergebnis = { fehler: configFatalErrors() };",
    'for (const raum of ["safety", "voice"]) {',
    "ergebnis[raum] = Object.fromEntries(CONFIG_NAMESPACES[raum].map((schluessel) => [schluessel, config[raum][schluessel]]));",
    "}",
    "process.stdout.write(JSON.stringify(ergebnis));",
    "});",
  ].join("\n");
  const env = kindUmgebung({ NODE_ENV: "test", ...umgebung });
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: ROOT, env, encoding: "utf8" }));
}

const EL_STANDARD_BASIS = "https://api.elevenlabs.io";

test("Rohwerte Sicherheit und Stimme: ohne Umgebung gelten die Standardwerte der Schranken", () => {
  const ist = ladeSicherheitStimmeRohwerte({});
  assert.deepEqual(ist.fehler, []);
  assert.deepEqual(ist.safety, {
    outboundFrozen: false,
    allowedCountryCodes: ["+49", "+33", "+44"],
    maxCallsPerHour: 6,
    perTargetCallCap: 3,
    perTargetWindowMs: 86400000,
    capFarewellLeadMs: 20000,
    reserveReleaseGraceMs: 15000,
    budgetWatchdogIntervalMs: 15000,
    rateLimitPerMin: 120,
    csrfEnforce: true,
    mcpAllowedOrigins: [],
    mcpOriginEnforce: true,
    skipTwilioSignatureCheck: false,
    fakeOriginate: false,
    fakeOriginateElevenlabs: false,
    outboundAniGateEnabled: false,
    outboundAniGateMaxAgeMs: 900000,
  });
  assert.deepEqual(ist.voice.elevenLabsPlayTts, {
    enabled: false,
    apiKey: "",
    voiceId: "",
    model: "eleven_v4_turbo",
    apiBase: EL_STANDARD_BASIS,
    outputFormat: "mp3_44100_128",
    synthTimeoutMs: 2000,
    synthTotalTimeoutMs: 10000,
    tokenTtlMs: 60000,
  });
  assert.deepEqual(ist.voice.elevenLabsOutbound, {
    enabled: false,
    agentId: "",
    ueberTelnyx: false,
    vorspann: false,
    numberRegistrationEnabled: false,
    resultPollMs: 5000,
    vorspannWiedergabeFristMs: 20000,
    bridgeStartDeadlineMs: 30000,
    apiKey: "",
    apiBase: EL_STANDARD_BASIS,
    openingLineLlm: true,
    environment: "production",
    erwarteterMedienweg: "livekit",
  });
  assert.equal(ist.voice.elevenLabsToolToken, "");
  assert.equal(ist.voice.elevenLabsTenantTokenRequired, false);
  assert.equal(ist.voice.sendSmsSummary, true);
  assert.equal(ist.voice.dailySmsCap, 20);
  assert.equal(ist.voice.sttSpeechTimeoutSec, 2);
  assert.equal(ist.voice.maxEmptyTurns, 3);
  assert.equal(ist.voice.callerSubstanceMinLen, 2);
  assert.equal(ist.voice.thinkingSignalEnabled, false);
  assert.equal(ist.voice.toolFollowUpEnabled, false);
  assert.equal(ist.voice.ownerSelfCallEnabled, false);
  assert.deepEqual(ist.voice.ownerSelfCallTenantIds, []);
  assert.equal(ist.voice.inboundOwnerGreetingEnabled, false);
  assert.deepEqual(ist.voice.inboundOwnerGreetingTenantIds, []);
  assert.equal(ist.voice.sttProfile, "accurate");
});

const SICHERHEIT_STIMME_GESETZT = {
  OUTBOUND_FROZEN: "true",
  ALLOWED_COUNTRY_CODES: "+41, +43",
  MAX_CALLS_PER_HOUR: "9",
  PER_TARGET_CALL_CAP: "4",
  PER_TARGET_WINDOW_MS: "5000",
  CAP_FAREWELL_LEAD_MS: "1234",
  RESERVE_RELEASE_GRACE_MS: "2345",
  BUDGET_WATCHDOG_INTERVAL_MS: "3456",
  RATE_LIMIT_PER_MIN: "77",
  CSRF_ENFORCE: "false",
  MCP_ALLOWED_ORIGINS: "https://a.test,https://b.test",
  MCP_ORIGIN_ENFORCE: "false",
  SKIP_TWILIO_SIGNATURE_CHECK: "true",
  FAKE_ORIGINATE: "true",
  FAKE_ORIGINATE_ELEVENLABS: "true",
  OUTBOUND_ANI_GATE_ENABLED: "true",
  OUTBOUND_ANI_GATE_MAX_AGE_MS: "4567",
  ELEVENLABS_API_KEY: "  el-key  ",
  ELEVENLABS_API_BASE: " https://el.test/ ",
  ELEVENLABS_PLAY_TTS_ENABLED: "true",
  ELEVENLABS_VOICE_ID: " stimme ",
  ELEVENLABS_MODEL: " modell ",
  ELEVENLABS_OUTPUT_FORMAT: " pcm ",
  ELEVENLABS_SYNTH_TIMEOUT_MS: "600",
  ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS: "1500",
  ELEVENLABS_TTS_TOKEN_TTL_MS: "6000",
  ELEVENLABS_TOOL_TOKEN: " werkzeug ",
  ELEVENLABS_TENANT_TOKEN_REQUIRED: "true",
  ELEVENLABS_OUTBOUND_ENABLED: "true",
  ELEVENLABS_AGENT_ID: " agent ",
  ELEVENLABS_OUTBOUND_UEBER_TELNYX: "true",
  ELEVENLABS_OUTBOUND_VORSPANN: "true",
  ELEVENLABS_NUMBER_REGISTRATION_ENABLED: "true",
  ELEVENLABS_RESULT_POLL_MS: "200",
  VORSPANN_WIEDERGABE_FRIST_MS: "300",
  EL_BRIDGE_START_DEADLINE_MS: "400",
  ELEVENLABS_OPENING_LINE_LLM_ENABLED: "false",
  ELEVENLABS_ENVIRONMENT: "staging",
  ELEVENLABS_ERWARTETER_MEDIENWEG: " sipgo ",
  SEND_SMS_SUMMARY: "false",
  DAILY_SMS_CAP: "7",
  STT_SPEECH_TIMEOUT_SEC: "5",
  MAX_EMPTY_TURNS: "4",
  CALLER_SUBSTANCE_MIN_LEN: "3",
  THINKING_SIGNAL_ENABLED: "true",
  TOOL_FOLLOW_UP_ENABLED: "true",
  OWNER_SELF_CALL_ENABLED: "true",
  OWNER_SELF_CALL_TENANT_IDS: "t1,t2",
  INBOUND_OWNER_GREETING_ENABLED: "true",
  INBOUND_OWNER_GREETING_TENANT_IDS: "t3",
  STT_PROFILE: " schnell ",
};

test("Rohwerte Sicherheit und Stimme: gesetzte Werte werden gelesen, gekuerzt und normalisiert", () => {
  const ist = ladeSicherheitStimmeRohwerte(SICHERHEIT_STIMME_GESETZT);
  assert.deepEqual(ist.fehler, []);
  assert.deepEqual(ist.safety, {
    outboundFrozen: true,
    allowedCountryCodes: ["+41", "+43"],
    maxCallsPerHour: 9,
    perTargetCallCap: 4,
    perTargetWindowMs: 5000,
    capFarewellLeadMs: 1234,
    reserveReleaseGraceMs: 2345,
    budgetWatchdogIntervalMs: 3456,
    rateLimitPerMin: 77,
    csrfEnforce: false,
    mcpAllowedOrigins: ["https://a.test", "https://b.test"],
    mcpOriginEnforce: false,
    skipTwilioSignatureCheck: true,
    fakeOriginate: true,
    fakeOriginateElevenlabs: true,
    outboundAniGateEnabled: true,
    outboundAniGateMaxAgeMs: 4567,
  });
  assert.deepEqual(ist.voice.elevenLabsPlayTts, {
    enabled: true,
    apiKey: "el-key",
    voiceId: "stimme",
    model: "modell",
    apiBase: "https://el.test",
    outputFormat: "pcm",
    synthTimeoutMs: 600,
    synthTotalTimeoutMs: 1500,
    tokenTtlMs: 6000,
  });
  assert.deepEqual(ist.voice.elevenLabsOutbound, {
    enabled: true,
    agentId: "agent",
    ueberTelnyx: true,
    vorspann: true,
    numberRegistrationEnabled: true,
    resultPollMs: 200,
    vorspannWiedergabeFristMs: 300,
    bridgeStartDeadlineMs: 400,
    apiKey: "el-key",
    apiBase: "https://el.test",
    openingLineLlm: false,
    environment: "staging",
    erwarteterMedienweg: "sipgo",
  });
  assert.equal(ist.voice.elevenLabsToolToken, "werkzeug");
  assert.equal(ist.voice.elevenLabsTenantTokenRequired, true);
  assert.equal(ist.voice.sendSmsSummary, false);
  assert.equal(ist.voice.dailySmsCap, 7);
  assert.equal(ist.voice.sttSpeechTimeoutSec, 5);
  assert.equal(ist.voice.maxEmptyTurns, 4);
  assert.equal(ist.voice.callerSubstanceMinLen, 3);
  assert.equal(ist.voice.thinkingSignalEnabled, true);
  assert.equal(ist.voice.toolFollowUpEnabled, true);
  assert.equal(ist.voice.ownerSelfCallEnabled, true);
  assert.deepEqual(ist.voice.ownerSelfCallTenantIds, ["t1", "t2"]);
  assert.equal(ist.voice.inboundOwnerGreetingEnabled, true);
  assert.deepEqual(ist.voice.inboundOwnerGreetingTenantIds, ["t3"]);
  assert.equal(ist.voice.sttProfile, "schnell");
});

const SICHERHEIT_STIMME_GRENZEN = [
  ["MAX_CALLS_PER_HOUR", ["safety", "maxCallsPerHour"], 0, 6],
  ["PER_TARGET_CALL_CAP", ["safety", "perTargetCallCap"], 0, 3],
  ["PER_TARGET_WINDOW_MS", ["safety", "perTargetWindowMs"], 1, 86400000],
  ["CAP_FAREWELL_LEAD_MS", ["safety", "capFarewellLeadMs"], 0, 20000],
  ["RESERVE_RELEASE_GRACE_MS", ["safety", "reserveReleaseGraceMs"], 0, 15000],
  ["BUDGET_WATCHDOG_INTERVAL_MS", ["safety", "budgetWatchdogIntervalMs"], 0, 15000],
  ["RATE_LIMIT_PER_MIN", ["safety", "rateLimitPerMin"], 0, 120],
  ["OUTBOUND_ANI_GATE_MAX_AGE_MS", ["safety", "outboundAniGateMaxAgeMs"], 0, 900000],
  ["ELEVENLABS_SYNTH_TIMEOUT_MS", ["voice", "elevenLabsPlayTts", "synthTimeoutMs"], 500, 2000],
  ["ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS", ["voice", "elevenLabsPlayTts", "synthTotalTimeoutMs"], 1000, 10000],
  ["ELEVENLABS_TTS_TOKEN_TTL_MS", ["voice", "elevenLabsPlayTts", "tokenTtlMs"], 5000, 60000],
  ["ELEVENLABS_RESULT_POLL_MS", ["voice", "elevenLabsOutbound", "resultPollMs"], 100, 5000],
  ["VORSPANN_WIEDERGABE_FRIST_MS", ["voice", "elevenLabsOutbound", "vorspannWiedergabeFristMs"], 100, 20000],
  ["EL_BRIDGE_START_DEADLINE_MS", ["voice", "elevenLabsOutbound", "bridgeStartDeadlineMs"], 100, 30000],
  ["DAILY_SMS_CAP", ["voice", "dailySmsCap"], 0, 20],
  ["STT_SPEECH_TIMEOUT_SEC", ["voice", "sttSpeechTimeoutSec"], 1, 2],
  ["MAX_EMPTY_TURNS", ["voice", "maxEmptyTurns"], 2, 3],
  ["CALLER_SUBSTANCE_MIN_LEN", ["voice", "callerSubstanceMinLen"], 1, 2],
];

const SICHERHEIT_STIMME_OBERGRENZEN = [
  ["CAP_FAREWELL_LEAD_MS", ["safety", "capFarewellLeadMs"], 60000, 20000],
  ["BUDGET_WATCHDOG_INTERVAL_MS", ["safety", "budgetWatchdogIntervalMs"], 600000, 15000],
  ["ELEVENLABS_SYNTH_TIMEOUT_MS", ["voice", "elevenLabsPlayTts", "synthTimeoutMs"], 10000, 2000],
  ["ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS", ["voice", "elevenLabsPlayTts", "synthTotalTimeoutMs"], 30000, 10000],
  ["ELEVENLABS_TTS_TOKEN_TTL_MS", ["voice", "elevenLabsPlayTts", "tokenTtlMs"], 600000, 60000],
  ["ELEVENLABS_RESULT_POLL_MS", ["voice", "elevenLabsOutbound", "resultPollMs"], 60000, 5000],
  ["VORSPANN_WIEDERGABE_FRIST_MS", ["voice", "elevenLabsOutbound", "vorspannWiedergabeFristMs"], 120000, 20000],
  ["EL_BRIDGE_START_DEADLINE_MS", ["voice", "elevenLabsOutbound", "bridgeStartDeadlineMs"], 120000, 30000],
];

function wertAm(ist, pfad) {
  return pfad.reduce((rest, schluessel) => rest[schluessel], ist);
}

test("Rohwerte Sicherheit und Stimme: genau am Minimum gilt der Wert, darunter der Standard mit einem Befund", () => {
  const amMinimum = ladeSicherheitStimmeRohwerte(
    Object.fromEntries(SICHERHEIT_STIMME_GRENZEN.map(([name, , minimum]) => [name, String(minimum)])),
  );
  assert.deepEqual(amMinimum.fehler, []);
  const darunter = ladeSicherheitStimmeRohwerte(
    Object.fromEntries(SICHERHEIT_STIMME_GRENZEN.map(([name, , minimum]) => [name, String(minimum - 1)])),
  );
  assert.equal(darunter.fehler.length, SICHERHEIT_STIMME_GRENZEN.length);
  for (const [name, pfad, minimum, standard] of SICHERHEIT_STIMME_GRENZEN) {
    assert.equal(wertAm(amMinimum, pfad), minimum, name);
    assert.equal(wertAm(darunter, pfad), standard, name);
    assert.equal(darunter.fehler.filter((befund) => befund.startsWith(`${name}=`)).length, 1, name);
  }
});

test("Rohwerte Sicherheit und Stimme: genau an der Obergrenze gilt der Wert, darueber wird auf die Obergrenze gekappt ohne Befund", () => {
  const amMaximum = ladeSicherheitStimmeRohwerte(
    Object.fromEntries(SICHERHEIT_STIMME_OBERGRENZEN.map(([name, , maximum]) => [name, String(maximum)])),
  );
  assert.deepEqual(amMaximum.fehler, []);
  const darueber = ladeSicherheitStimmeRohwerte(
    Object.fromEntries(SICHERHEIT_STIMME_OBERGRENZEN.map(([name, , maximum]) => [name, String(maximum + 1)])),
  );
  assert.deepEqual(darueber.fehler, []);
  for (const [name, pfad, maximum] of SICHERHEIT_STIMME_OBERGRENZEN) {
    assert.equal(wertAm(amMaximum, pfad), maximum, name);
    assert.equal(wertAm(darueber, pfad), maximum, name);
  }
});

test("Rohwerte Sicherheit und Stimme: ungueltige Schalter und Umgebungswahl melden den Namen und behalten die Standardwerte", () => {
  const namen = [
    "OUTBOUND_FROZEN",
    "CSRF_ENFORCE",
    "MCP_ORIGIN_ENFORCE",
    "SKIP_TWILIO_SIGNATURE_CHECK",
    "FAKE_ORIGINATE",
    "FAKE_ORIGINATE_ELEVENLABS",
    "OUTBOUND_ANI_GATE_ENABLED",
    "ELEVENLABS_PLAY_TTS_ENABLED",
    "ELEVENLABS_TENANT_TOKEN_REQUIRED",
    "ELEVENLABS_OUTBOUND_ENABLED",
    "ELEVENLABS_OUTBOUND_UEBER_TELNYX",
    "ELEVENLABS_OUTBOUND_VORSPANN",
    "ELEVENLABS_NUMBER_REGISTRATION_ENABLED",
    "ELEVENLABS_OPENING_LINE_LLM_ENABLED",
    "SEND_SMS_SUMMARY",
    "THINKING_SIGNAL_ENABLED",
    "TOOL_FOLLOW_UP_ENABLED",
    "OWNER_SELF_CALL_ENABLED",
    "INBOUND_OWNER_GREETING_ENABLED",
    "ELEVENLABS_ENVIRONMENT",
    "ELEVENLABS_ERWARTETER_MEDIENWEG",
  ];
  const ist = ladeSicherheitStimmeRohwerte(Object.fromEntries(namen.map((name) => [name, "kaputt"])));
  assert.equal(ist.fehler.length, namen.length);
  for (const name of namen) {
    assert.equal(ist.fehler.filter((befund) => befund.startsWith(`${name}=`)).length, 1, name);
  }
  assert.equal(ist.safety.outboundFrozen, false);
  assert.equal(ist.safety.csrfEnforce, true);
  assert.equal(ist.safety.mcpOriginEnforce, true);
  assert.equal(ist.safety.skipTwilioSignatureCheck, false);
  assert.equal(ist.safety.fakeOriginate, false);
  assert.equal(ist.voice.elevenLabsOutbound.openingLineLlm, true);
  assert.equal(ist.voice.elevenLabsOutbound.environment, "production");
  assert.equal(ist.voice.elevenLabsOutbound.erwarteterMedienweg, "");
  assert.equal(ist.voice.sendSmsSummary, true);
});

test("Rohwerte Sicherheit und Stimme: ein leer gesetzter Medienweg bleibt leer und eine leere Landesliste gilt als leer", () => {
  const ist = ladeSicherheitStimmeRohwerte({ ELEVENLABS_ERWARTETER_MEDIENWEG: " ", ALLOWED_COUNTRY_CODES: "" });
  assert.equal(ist.voice.elevenLabsOutbound.erwarteterMedienweg, "");
  assert.deepEqual(
    ist.fehler.filter((befund) => befund.startsWith("ELEVENLABS_ERWARTETER_MEDIENWEG=")),
    [],
  );
  assert.deepEqual(ist.safety.allowedCountryCodes, ["+49", "+33", "+44"]);
});

function ladeAbrechnungRohwerte(umgebung) {
  const script = [
    'import("./src/config.js").then(({ config, CONFIG_NAMESPACES, configFatalErrors }) => {',
    "const ergebnis = { fehler: configFatalErrors() };",
    "ergebnis.billing = Object.fromEntries(CONFIG_NAMESPACES.billing.map((schluessel) => [schluessel, config.billing[schluessel]]));",
    "process.stdout.write(JSON.stringify(ergebnis));",
    "});",
  ].join("\n");
  const env = kindUmgebung({ NODE_ENV: "test", ...umgebung });
  return JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", script], { cwd: ROOT, env, encoding: "utf8" }));
}

const ABRECHNUNG_ZAHLEN = [
  ["NUMBER_SETUP_FEE_CENTS", "numberSetupFeeCents", 0, 0, undefined],
  ["PROVIDER_TO_BUCKET_RATE_MICRO", "providerToBucketRateMicro", 920000, 1, undefined],
  ["COST_TRUING_DELAY_MINUTES", "costTruingDelayMinutes", 30, 0, undefined],
  ["COST_TRUING_SWEEP_INTERVAL_MS", "costTruingSweepIntervalMs", 3600000, 60000, 2147483647],
  ["COST_TRUING_MAX_ATTEMPTS", "costTruingMaxAttempts", 5, 1, undefined],
  ["COST_SETTLE_DEADLINE_HOURS", "costSettleDeadlineHours", 48, 1, undefined],
  ["EL_EVIDENCE_MIN_AGE_MINUTES", "elEvidenceMinAgeMinutes", 15, 0, undefined],
  ["COST_TRUING_MIN_COVERAGE_PERCENT", "costTruingMinCoveragePercent", 80, 0, 100],
  ["COST_TRUING_COVERAGE_STALL_SWEEPS", "costTruingCoverageStallSweeps", 8, 1, undefined],
  ["KOSTEN_HEARTBEAT_FENSTER_H", "kostenHeartbeatFensterH", 6, 0, undefined],
  ["COST_DRIFT_WARN_PERCENT", "costDriftWarnPercent", 50, 0, undefined],
  ["COST_ALERT_DEBOUNCE_MS", "costAlertDebounceMs", 86400000, 0, undefined],
  ["COST_CALIBRATION_MIN_SAMPLES", "costCalibrationMinSamples", 20, 1, undefined],
  ["VOICE_TARIFF_DOMESTIC_CENTS", "voiceTariffDomesticCents", 20, 0, undefined],
  ["VOICE_TARIFF_DEFAULT_CENTS", "voiceTariffDefaultCents", 30, 0, undefined],
  ["VOICE_TARIFF_INBOUND_CENTS", "voiceTariffInboundCents", 6, 0, undefined],
  ["VOICE_TARIFF_FULL_COST_FLOOR_CENTS", "voiceTariffFullCostFloorCents", 15, 0, undefined],
  ["DEFAULT_TENANT_BUDGET_CENTS", "defaultTenantBudgetCents", 1500, 0, undefined],
  ["SMS_COST_CENTS", "smsCostCents", 0, 0, undefined],
  ["PLATFORM_SPEND_WARN_PERCENT", "platformSpendWarnPercent", 80, 0, 100],
  ["OUTAGE_ALERT_WINDOW_MS", "outageAlertWindowMs", 3600000, 0, undefined],
  ["OUTAGE_ALERT_MIN_FAILURES", "outageAlertMinFailures", 3, 1, undefined],
  ["OUTAGE_ALERT_MIN_ATTEMPTS", "outageAlertMinAttempts", 20, 1, undefined],
  ["OUTAGE_ALERT_FAIL_SHARE_PERCENT", "outageAlertFailSharePercent", 20, 0, 100],
  ["OUTAGE_ALERT_DEBOUNCE_MS", "outageAlertDebounceMs", 21600000, 0, undefined],
  ["OUTAGE_ALERT_RETRY_MS", "outageAlertRetryMs", 900000, 0, undefined],
  ["OUTAGE_ALERT_SELF_TEST_INTERVAL_MS", "outageAlertSelfTestIntervalMs", 2592000000, 0, undefined],
  ["INBOUND_OUTAGE_ALERT_WINDOW_MS", "inboundOutageAlertWindowMs", 21600000, 0, undefined],
  ["INBOUND_OUTAGE_ALERT_MIN_FAILURES", "inboundOutageAlertMinFailures", 2, 1, undefined],
  ["INBOUND_OUTAGE_ALERT_MIN_ATTEMPTS", "inboundOutageAlertMinAttempts", 20, 1, undefined],
  ["INBOUND_OUTAGE_ALERT_FAIL_SHARE_PERCENT", "inboundOutageAlertFailSharePercent", 10, 0, 100],
  ["PLATFORM_HOLD_ESCALATION_MAX_AGE_MS", "platformHoldEscalationMaxAgeMs", 86400000, 0, undefined],
  ["PAID_WITHOUT_NUMBER_GRACE_MS", "paidWithoutNumberGraceMs", 3600000, 0, undefined],
  ["TTS_CHARACTER_QUOTA", "ttsCharacterQuota", 39981, 1, undefined],
  ["TTS_CHARACTER_QUOTA_WARN_PERCENT", "ttsCharacterQuotaWarnPercent", 75, 0, 100],
  ["TTS_QUOTA_CYCLE_ANCHOR_DAY", "ttsQuotaCycleAnchorDay", 3, 1, 28],
  ["PLATFORM_FIXED_COST_CENTS_PER_MONTH", "platformFixedCostUsdCentsPerMonth", 600, 0, undefined],
  ["NUMBER_MONTHLY_COST_CENTS", "numberMonthlyCostCents", 92, 0, undefined],
  ["PRICE_DRIFT_MIN_INTERVAL_MS", "priceDriftMinIntervalMs", 86400000, 0, undefined],
  ["PRICE_DRIFT_UNKNOWN_ESCALATE_AFTER", "priceDriftUnknownEscalateAfter", 3, 0, undefined],
  ["STRIPE_CUSTOMER_RETRY_DELAY_MS", "stripeCustomerRetryDelayMs", 2000, 0, undefined],
];

const ABRECHNUNG_ZAHLEN_OHNE_BUDGET = new Set(ABRECHNUNG_ZAHLEN.map(([, schluessel]) => schluessel));

function abrechnungOhneZahlen(billing) {
  return Object.fromEntries(Object.entries(billing).filter(([schluessel]) => !ABRECHNUNG_ZAHLEN_OHNE_BUDGET.has(schluessel)));
}

test("Rohwerte Abrechnung: ohne Umgebung gelten die Standardwerte der Kostenschranken", () => {
  const ist = ladeAbrechnungRohwerte({});
  assert.deepEqual(ist.fehler, []);
  assert.deepEqual(abrechnungOhneZahlen(ist.billing), {
    platformSpendCapCents: 3000,
    paymentEnabled: false,
    stripeSecretKey: "",
    stripeApiBase: "https://api.stripe.com",
    paymentCurrency: "eur",
    providerCurrency: "USD",
    costTruingRequiredRecordTypes: [],
    voiceTariffGrundbetragCentsJeRoute: {},
    voiceTariffDomesticPrefixes: ["+49", "+33", "+44"],
    platformAlertSmsTo: "",
    budgetMonthEnabled: false,
    stripeStarterPriceId: "",
    stripeBusinessPriceId: "",
    stripeWebhookSecret: "",
    flushEpochIso: null,
  });
  for (const [name, schluessel, standard] of ABRECHNUNG_ZAHLEN) {
    assert.equal(ist.billing[schluessel], standard, name);
  }
});

test("Rohwerte Abrechnung: gesetzte Werte werden gelesen, gekuerzt und normalisiert", () => {
  const ist = ladeAbrechnungRohwerte({
    PAYMENT_ENABLED: "true",
    STRIPE_SECRET_KEY: " sk ",
    STRIPE_API_BASE: "https://stripe.example/",
    BILLING_FLUSH_EPOCH: "2026-01-02T03:04:05Z",
    PAYMENT_CURRENCY: "USD",
    PROVIDER_CURRENCY: "eur",
    COST_TRUING_REQUIRED_RECORD_TYPES: "a, b",
    VOICE_TARIFF_GRUNDBETRAG_CENTS: "telnyx_budget:7,el_convai_sip:9",
    PLATFORM_ALERT_SMS_TO: "+4915",
    BUDGET_MONTH_ENABLED: "true",
    STRIPE_STARTER_PRICE_ID: "preis-a",
    STRIPE_BUSINESS_PRICE_ID: "preis-b",
    STRIPE_WEBHOOK_SECRET: "wh",
    MAX_BUDGET_EUR: "12.5",
    VOICE_TARIFF_INBOUND_CENTS: "11",
  });
  assert.deepEqual(ist.fehler, []);
  assert.equal(ist.billing.platformSpendCapCents, 1250);
  assert.equal(ist.billing.paymentEnabled, true);
  assert.equal(ist.billing.stripeSecretKey, " sk ");
  assert.equal(ist.billing.stripeApiBase, "https://stripe.example");
  assert.equal(ist.billing.flushEpochIso, "2026-01-02T03:04:05.000Z");
  assert.equal(ist.billing.paymentCurrency, "usd");
  assert.equal(ist.billing.providerCurrency, "EUR");
  assert.deepEqual(ist.billing.costTruingRequiredRecordTypes, ["a", "b"]);
  assert.deepEqual(ist.billing.voiceTariffGrundbetragCentsJeRoute, { telnyx_budget: 7, el_convai_sip: 9 });
  assert.equal(ist.billing.platformAlertSmsTo, "+4915");
  assert.equal(ist.billing.budgetMonthEnabled, true);
  assert.equal(ist.billing.stripeStarterPriceId, "preis-a");
  assert.equal(ist.billing.stripeBusinessPriceId, "preis-b");
  assert.equal(ist.billing.stripeWebhookSecret, "wh");
  assert.equal(ist.billing.voiceTariffInboundCents, 11);
});

test("Rohwerte Abrechnung: genau am Minimum gilt der Wert, darunter der Standard mit einem Befund", () => {
  const amMinimum = ladeAbrechnungRohwerte(
    Object.fromEntries(ABRECHNUNG_ZAHLEN.map(([name, , , minimum]) => [name, String(minimum)])),
  );
  assert.deepEqual(amMinimum.fehler, []);
  const darunter = ladeAbrechnungRohwerte(
    Object.fromEntries(ABRECHNUNG_ZAHLEN.map(([name, , , minimum]) => [name, String(minimum - 1)])),
  );
  assert.equal(darunter.fehler.length, ABRECHNUNG_ZAHLEN.length + 1);
  for (const [name, schluessel, standard, minimum] of ABRECHNUNG_ZAHLEN) {
    assert.equal(amMinimum.billing[schluessel], minimum, name);
    assert.equal(darunter.billing[schluessel], standard, name);
    const erwartet = name === "PROVIDER_TO_BUCKET_RATE_MICRO" ? 2 : 1;
    assert.equal(darunter.fehler.filter((befund) => befund.startsWith(`${name}=`)).length, erwartet, name);
  }
});

test("Rohwerte Abrechnung: genau an der Obergrenze gilt der Wert, darueber wird auf die Obergrenze gekappt ohne Befund", () => {
  const mitObergrenze = ABRECHNUNG_ZAHLEN.filter(([, , , , maximum]) => maximum !== undefined);
  const amMaximum = ladeAbrechnungRohwerte(
    Object.fromEntries(mitObergrenze.map(([name, , , , maximum]) => [name, String(maximum)])),
  );
  assert.deepEqual(amMaximum.fehler, []);
  const darueber = ladeAbrechnungRohwerte(
    Object.fromEntries(mitObergrenze.map(([name, , , , maximum]) => [name, String(maximum + 1)])),
  );
  assert.deepEqual(darueber.fehler, []);
  for (const [name, schluessel, , , maximum] of mitObergrenze) {
    assert.equal(amMaximum.billing[schluessel], maximum, name);
    assert.equal(darueber.billing[schluessel], maximum, name);
  }
});

test("Rohwerte Abrechnung: ungueltiger Schalter und ungueltige Tarifkarte melden den Namen und behalten die Standardwerte", () => {
  const ist = ladeAbrechnungRohwerte({
    PAYMENT_ENABLED: "vielleicht",
    BUDGET_MONTH_ENABLED: "vielleicht",
    VOICE_TARIFF_GRUNDBETRAG_CENTS: "unbekannt:5",
    BILLING_FLUSH_EPOCH: "gestern",
  });
  assert.equal(ist.billing.paymentEnabled, false);
  assert.equal(ist.billing.budgetMonthEnabled, false);
  assert.deepEqual(ist.billing.voiceTariffGrundbetragCentsJeRoute, {});
  assert.equal(ist.billing.flushEpochIso, null);
  for (const name of ["PAYMENT_ENABLED", "BUDGET_MONTH_ENABLED", "VOICE_TARIFF_GRUNDBETRAG_CENTS", "BILLING_FLUSH_EPOCH"]) {
    assert.equal(ist.fehler.filter((befund) => befund.includes(name)).length, 1, name);
  }
});
