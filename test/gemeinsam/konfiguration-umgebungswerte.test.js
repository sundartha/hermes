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
