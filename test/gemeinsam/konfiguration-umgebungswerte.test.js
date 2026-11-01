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
import { gebauteKonfiguration } from "./gebaute-konfiguration.js";

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

function ungesetzt(namen) {
  return Object.fromEntries(namen.map((name) => [name, undefined]));
}

function mitUmgebungen(werte, laden) {
  return Object.entries(werte).reduce(
    (innen, [name, wert]) => () => mitUmgebung(name, wert, innen),
    laden,
  )();
}

const ELEVENLABS_STANDARD_BASIS = "https://api.elevenlabs.io";
const ELEVENLABS_STANDARD_MODELL = "eleven_v3_conversational";
const ELEVENLABS_STANDARD_FORMAT = "mp3_44100_128";
const SYNTHESE_FRIST_STANDARD_MS = 2000;
const SYNTHESE_GESAMTFRIST_STANDARD_MS = 10000;
const TOKEN_LEBENSDAUER_STANDARD_MS = 60000;
const ERGEBNIS_ABFRAGE_STANDARD_MS = 5000;
const ANRUFE_JE_STUNDE_STANDARD = 6;
const ANRUFE_JE_ZIEL_STANDARD = 3;
const ABSCHIED_VORLAUF_STANDARD_MS = 20000;
const RESERVE_FREIGABE_STANDARD_MS = 15000;
const ANFRAGEN_JE_MINUTE_STANDARD = 120;
const SMS_JE_TAG_STANDARD = 20;

test("[NIE1] ohne gesetzte Variablen gelten im Namensraum safety die heutigen Standardwerte", () => {
  const gebaut = gebauteKonfiguration(
    ungesetzt([
      "MAX_CALLS_PER_HOUR",
      "PER_TARGET_CALL_CAP",
      "PER_TARGET_WINDOW_MS",
      "ALLOWED_COUNTRY_CODES",
      "CAP_FAREWELL_LEAD_MS",
      "RESERVE_RELEASE_GRACE_MS",
      "RATE_LIMIT_PER_MIN",
      "OUTBOUND_FROZEN",
      "SKIP_TWILIO_SIGNATURE_CHECK",
      "CSRF_ENFORCE",
      "MCP_ORIGIN_ENFORCE",
    ]),
    [
      "safety.maxCallsPerHour",
      "safety.perTargetCallCap",
      "safety.perTargetWindowMs",
      "safety.allowedCountryCodes",
      "safety.capFarewellLeadMs",
      "safety.reserveReleaseGraceMs",
      "safety.rateLimitPerMin",
      "safety.outboundFrozen",
      "safety.skipTwilioSignatureCheck",
      "safety.csrfEnforce",
      "safety.mcpOriginEnforce",
    ],
  );
  assert.deepEqual(gebaut, {
    "safety.maxCallsPerHour": ANRUFE_JE_STUNDE_STANDARD,
    "safety.perTargetCallCap": ANRUFE_JE_ZIEL_STANDARD,
    "safety.perTargetWindowMs": MS_JE_TAG,
    "safety.allowedCountryCodes": ["+49", "+33", "+44"],
    "safety.capFarewellLeadMs": ABSCHIED_VORLAUF_STANDARD_MS,
    "safety.reserveReleaseGraceMs": RESERVE_FREIGABE_STANDARD_MS,
    "safety.rateLimitPerMin": ANFRAGEN_JE_MINUTE_STANDARD,
    "safety.outboundFrozen": false,
    "safety.skipTwilioSignatureCheck": false,
    "safety.csrfEnforce": true,
    "safety.mcpOriginEnforce": true,
  });
});

test("[NIE2] ohne gesetzte Variablen bleiben die SMS-Tagesgrenze 20 und die SMS-Zusammenfassung an", () => {
  const gebaut = gebauteKonfiguration(ungesetzt(["DAILY_SMS_CAP", "SEND_SMS_SUMMARY"]), [
    "voice.dailySmsCap",
    "voice.sendSmsSummary",
  ]);
  assert.deepEqual(gebaut, { "voice.dailySmsCap": SMS_JE_TAG_STANDARD, "voice.sendSmsSummary": true });
});

test("ohne gesetzte ElevenLabs- und Schaltervariablen liefert die Konfiguration die Standardwerte", () => {
  const gebaut = gebauteKonfiguration(
    ungesetzt([
      "ELEVENLABS_API_KEY",
      "ELEVENLABS_API_BASE",
      "ELEVENLABS_PLAY_TTS_ENABLED",
      "ELEVENLABS_VOICE_ID",
      "ELEVENLABS_MODEL",
      "ELEVENLABS_OUTPUT_FORMAT",
      "ELEVENLABS_SYNTH_TIMEOUT_MS",
      "ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS",
      "ELEVENLABS_TTS_TOKEN_TTL_MS",
      "ELEVENLABS_TOOL_TOKEN",
      "ELEVENLABS_OUTBOUND_ENABLED",
      "ELEVENLABS_AGENT_ID",
      "ELEVENLABS_AGENT_PHONE_NUMBER_ID",
      "ELEVENLABS_NUMBER_REGISTRATION_ENABLED",
      "ELEVENLABS_RESULT_POLL_MS",
      "ELEVENLABS_OPENING_LINE_LLM_ENABLED",
      "ELEVENLABS_ENVIRONMENT",
      "OWNER_SELF_CALL_ENABLED",
      "INBOUND_OWNER_GREETING_ENABLED",
      "FAKE_ORIGINATE_ELEVENLABS",
      "OUTBOUND_ANI_GATE_ENABLED",
    ]),
    [
      "voice.elevenLabsPlayTts",
      "voice.elevenLabsToolToken",
      "voice.elevenLabsOutbound",
      "voice.ownerSelfCallEnabled",
      "voice.inboundOwnerGreetingEnabled",
      "safety.fakeOriginateElevenlabs",
      "safety.outboundAniGateEnabled",
    ],
  );
  assert.deepEqual(gebaut, {
    "voice.elevenLabsPlayTts": {
      enabled: false,
      apiKey: "",
      voiceId: "",
      model: ELEVENLABS_STANDARD_MODELL,
      apiBase: ELEVENLABS_STANDARD_BASIS,
      outputFormat: ELEVENLABS_STANDARD_FORMAT,
      synthTimeoutMs: SYNTHESE_FRIST_STANDARD_MS,
      synthTotalTimeoutMs: SYNTHESE_GESAMTFRIST_STANDARD_MS,
      tokenTtlMs: TOKEN_LEBENSDAUER_STANDARD_MS,
    },
    "voice.elevenLabsToolToken": "",
    "voice.elevenLabsOutbound": {
      enabled: false,
      agentId: "",
      agentPhoneNumberId: "",
      numberRegistrationEnabled: false,
      resultPollMs: ERGEBNIS_ABFRAGE_STANDARD_MS,
      apiKey: "",
      apiBase: ELEVENLABS_STANDARD_BASIS,
      openingLineLlm: true,
      environment: "production",
    },
    "voice.ownerSelfCallEnabled": false,
    "voice.inboundOwnerGreetingEnabled": false,
    "safety.fakeOriginateElevenlabs": false,
    "safety.outboundAniGateEnabled": false,
  });
});

test("ElevenLabs-Zugangswerte und STT_PROFILE werden ohne Rand-Whitespace uebernommen", async () => {
  const fresh = await mitUmgebungen(
    {
      ELEVENLABS_API_KEY: " schluessel ",
      ELEVENLABS_VOICE_ID: " stimme ",
      ELEVENLABS_MODEL: " modell ",
      ELEVENLABS_OUTPUT_FORMAT: " format ",
      ELEVENLABS_TOOL_TOKEN: " werkzeug ",
      ELEVENLABS_AGENT_ID: " agent ",
      ELEVENLABS_AGENT_PHONE_NUMBER_ID: " nummer ",
      STT_PROFILE: " accurate ",
    },
    () => import("../../src/config.js?elevenlabs-getrimmt"),
  );
  const { elevenLabsPlayTts, elevenLabsOutbound } = fresh.config.voice;
  assert.deepEqual(
    [elevenLabsPlayTts.apiKey, elevenLabsPlayTts.voiceId, elevenLabsPlayTts.model, elevenLabsPlayTts.outputFormat],
    ["schluessel", "stimme", "modell", "format"],
  );
  assert.deepEqual(
    [elevenLabsOutbound.apiKey, elevenLabsOutbound.agentId, elevenLabsOutbound.agentPhoneNumberId],
    ["schluessel", "agent", "nummer"],
  );
  assert.equal(fresh.config.voice.elevenLabsToolToken, "werkzeug");
  assert.equal(fresh.config.voice.sttProfile, "accurate");
});

test("ein ungueltiger Wert einer safety- oder voice-Variable erzeugt genau einen Fatal, der die Variable nennt", async () => {
  const namen = [
    "ELEVENLABS_PLAY_TTS_ENABLED",
    "ELEVENLABS_SYNTH_TIMEOUT_MS",
    "ELEVENLABS_SYNTH_TOTAL_TIMEOUT_MS",
    "ELEVENLABS_TTS_TOKEN_TTL_MS",
    "ELEVENLABS_TENANT_TOKEN_REQUIRED",
    "ELEVENLABS_OUTBOUND_ENABLED",
    "ELEVENLABS_NUMBER_REGISTRATION_ENABLED",
    "ELEVENLABS_RESULT_POLL_MS",
    "ELEVENLABS_OPENING_LINE_LLM_ENABLED",
    "SEND_SMS_SUMMARY",
    "DAILY_SMS_CAP",
    "OUTBOUND_FROZEN",
    "MAX_CALLS_PER_HOUR",
    "PER_TARGET_CALL_CAP",
    "PER_TARGET_WINDOW_MS",
    "CAP_FAREWELL_LEAD_MS",
    "RESERVE_RELEASE_GRACE_MS",
    "BUDGET_WATCHDOG_INTERVAL_MS",
    "STT_SPEECH_TIMEOUT_SEC",
    "MAX_EMPTY_TURNS",
    "CALLER_SUBSTANCE_MIN_LEN",
    "THINKING_SIGNAL_ENABLED",
    "TOOL_FOLLOW_UP_ENABLED",
    "OWNER_SELF_CALL_ENABLED",
    "INBOUND_OWNER_GREETING_ENABLED",
    "RATE_LIMIT_PER_MIN",
    "CSRF_ENFORCE",
    "MCP_ORIGIN_ENFORCE",
    "SKIP_TWILIO_SIGNATURE_CHECK",
    "FAKE_ORIGINATE",
    "FAKE_ORIGINATE_ELEVENLABS",
    "OUTBOUND_ANI_GATE_ENABLED",
    "OUTBOUND_ANI_GATE_MAX_AGE_MS",
  ];
  const fresh = await mitUmgebungen(
    Object.fromEntries(namen.map((name) => [name, "kaputt"])),
    () => import("../../src/config.js?safety-voice-kaputt"),
  );
  const alleBefunde = fresh.configFatalErrors();
  assert.deepEqual(
    namen.filter((name) => befundeZu(alleBefunde, name).length !== 1),
    [],
    "jede ungueltige Variable braucht genau einen Fatal mit ihrem Namen",
  );
});

const KOSTENDECKE_STANDARD_CENT = 3000;
const TENANT_BUDGET_STANDARD_CENT = 1500;
const TARIF_INLAND_STANDARD_CENT = 20;
const TARIF_AUSLAND_STANDARD_CENT = 30;
const TARIF_EINGEHEND_STANDARD_CENT = 6;
const TARIF_VOLLKOSTEN_UNTERGRENZE_STANDARD_CENT = 15;
const MS_JE_STUNDE = 3_600_000;
const MS_JE_MINUTE = 60_000;
const AUSFALL_ENTPRELLUNG_STANDARD_MS = 6 * MS_JE_STUNDE;
const AUSFALL_WIEDERHOLUNG_STANDARD_MS = 15 * MS_JE_MINUTE;
const AUSFALL_SELBSTTEST_STANDARD_MS = 30 * MS_JE_TAG;
const EINGEHEND_AUSFALL_FENSTER_STANDARD_MS = 6 * MS_JE_STUNDE;
const PLATTFORM_HALT_ESKALATION_STANDARD_MS = 24 * MS_JE_STUNDE;
const BEZAHLT_OHNE_NUMMER_FRIST_STANDARD_MS = MS_JE_STUNDE;
const KOSTENDECKE_ACHTEINHALB_EUR_CENT = 850;

test("[NIE1] ohne gesetzte Variablen gelten im Namensraum billing die heutigen Kostendecken und Tarife", () => {
  const gebaut = gebauteKonfiguration(
    ungesetzt([
      "MAX_BUDGET_EUR",
      "DEFAULT_TENANT_BUDGET_CENTS",
      "VOICE_TARIFF_DOMESTIC_CENTS",
      "VOICE_TARIFF_DEFAULT_CENTS",
      "VOICE_TARIFF_INBOUND_CENTS",
      "VOICE_TARIFF_FULL_COST_FLOOR_CENTS",
      "SMS_COST_CENTS",
    ]),
    [
      "billing.platformSpendCapCents",
      "billing.defaultTenantBudgetCents",
      "billing.voiceTariffDomesticCents",
      "billing.voiceTariffDefaultCents",
      "billing.voiceTariffInboundCents",
      "billing.voiceTariffFullCostFloorCents",
      "billing.smsCostCents",
    ],
  );
  assert.deepEqual(gebaut, {
    "billing.platformSpendCapCents": KOSTENDECKE_STANDARD_CENT,
    "billing.defaultTenantBudgetCents": TENANT_BUDGET_STANDARD_CENT,
    "billing.voiceTariffDomesticCents": TARIF_INLAND_STANDARD_CENT,
    "billing.voiceTariffDefaultCents": TARIF_AUSLAND_STANDARD_CENT,
    "billing.voiceTariffInboundCents": TARIF_EINGEHEND_STANDARD_CENT,
    "billing.voiceTariffFullCostFloorCents": TARIF_VOLLKOSTEN_UNTERGRENZE_STANDARD_CENT,
    "billing.smsCostCents": 0,
  });
});

test("ohne gesetzte Zahlungs- und Alarmvariablen liefert der Namensraum billing die Standardwerte", () => {
  const gebaut = gebauteKonfiguration(
    ungesetzt([
      "PAYMENT_ENABLED",
      "STRIPE_SECRET_KEY",
      "STRIPE_API_BASE",
      "PAYMENT_CURRENCY",
      "PROVIDER_CURRENCY",
      "STRIPE_STARTER_PRICE_ID",
      "STRIPE_BUSINESS_PRICE_ID",
      "STRIPE_WEBHOOK_SECRET",
      "OUTAGE_ALERT_DEBOUNCE_MS",
      "OUTAGE_ALERT_RETRY_MS",
      "OUTAGE_ALERT_SELF_TEST_INTERVAL_MS",
      "INBOUND_OUTAGE_ALERT_WINDOW_MS",
      "PLATFORM_HOLD_ESCALATION_MAX_AGE_MS",
      "PAID_WITHOUT_NUMBER_GRACE_MS",
    ]),
    [
      "billing.paymentEnabled",
      "billing.stripeSecretKey",
      "billing.stripeApiBase",
      "billing.paymentCurrency",
      "billing.providerCurrency",
      "billing.stripeStarterPriceId",
      "billing.stripeBusinessPriceId",
      "billing.stripeWebhookSecret",
      "billing.outageAlertDebounceMs",
      "billing.outageAlertRetryMs",
      "billing.outageAlertSelfTestIntervalMs",
      "billing.inboundOutageAlertWindowMs",
      "billing.platformHoldEscalationMaxAgeMs",
      "billing.paidWithoutNumberGraceMs",
    ],
  );
  assert.deepEqual(gebaut, {
    "billing.paymentEnabled": false,
    "billing.stripeSecretKey": "",
    "billing.stripeApiBase": "https://api.stripe.com",
    "billing.paymentCurrency": "eur",
    "billing.providerCurrency": "USD",
    "billing.stripeStarterPriceId": "",
    "billing.stripeBusinessPriceId": "",
    "billing.stripeWebhookSecret": "",
    "billing.outageAlertDebounceMs": AUSFALL_ENTPRELLUNG_STANDARD_MS,
    "billing.outageAlertRetryMs": AUSFALL_WIEDERHOLUNG_STANDARD_MS,
    "billing.outageAlertSelfTestIntervalMs": AUSFALL_SELBSTTEST_STANDARD_MS,
    "billing.inboundOutageAlertWindowMs": EINGEHEND_AUSFALL_FENSTER_STANDARD_MS,
    "billing.platformHoldEscalationMaxAgeMs": PLATTFORM_HALT_ESKALATION_STANDARD_MS,
    "billing.paidWithoutNumberGraceMs": BEZAHLT_OHNE_NUMMER_FRIST_STANDARD_MS,
  });
});

test("MAX_BUDGET_EUR mit Nachkommastelle ergibt die Plattform-Kostendecke in Cent ohne Fatal", async () => {
  const fresh = await mitUmgebung(
    "MAX_BUDGET_EUR",
    "8.5",
    () => import("../../src/config.js?kostendecke-nachkomma"),
  );
  assert.equal(fresh.config.billing.platformSpendCapCents, KOSTENDECKE_ACHTEINHALB_EUR_CENT);
  assert.deepEqual(befundeZu(fresh.configFatalErrors(), "MAX_BUDGET_EUR"), []);
});

test("Waehrungen werden klein bzw. gross normalisiert, die Stripe-Basis verliert den Schraegstrich am Ende", async () => {
  const fresh = await mitUmgebungen(
    { PAYMENT_CURRENCY: "CHF", PROVIDER_CURRENCY: "usd", STRIPE_API_BASE: "https://stripe.test/" },
    () => import("../../src/config.js?billing-normalisiert"),
  );
  assert.equal(fresh.config.billing.paymentCurrency, "chf");
  assert.equal(fresh.config.billing.providerCurrency, "USD");
  assert.equal(fresh.config.billing.stripeApiBase, "https://stripe.test");
});

test("ein ungueltiger Wert einer billing-Variable erzeugt genau einen Fatal, der die Variable nennt", async () => {
  const namen = [
    "MAX_BUDGET_EUR",
    "PAYMENT_ENABLED",
    "NUMBER_SETUP_FEE_CENTS",
    "BILLING_FLUSH_EPOCH",
    "COST_TRUING_DELAY_MINUTES",
    "COST_TRUING_SWEEP_INTERVAL_MS",
    "COST_TRUING_MAX_ATTEMPTS",
    "COST_SETTLE_DEADLINE_HOURS",
    "EL_EVIDENCE_MIN_AGE_MINUTES",
    "COST_TRUING_MIN_COVERAGE_PERCENT",
    "COST_TRUING_COVERAGE_STALL_SWEEPS",
    "KOSTEN_HEARTBEAT_FENSTER_H",
    "COST_DRIFT_WARN_PERCENT",
    "COST_ALERT_DEBOUNCE_MS",
    "COST_CALIBRATION_MIN_SAMPLES",
    "VOICE_TARIFF_DOMESTIC_CENTS",
    "VOICE_TARIFF_DEFAULT_CENTS",
    "VOICE_TARIFF_INBOUND_CENTS",
    "VOICE_TARIFF_FULL_COST_FLOOR_CENTS",
    "VOICE_TARIFF_GRUNDBETRAG_CENTS",
    "DEFAULT_TENANT_BUDGET_CENTS",
    "SMS_COST_CENTS",
    "PLATFORM_SPEND_WARN_PERCENT",
    "OUTAGE_ALERT_WINDOW_MS",
    "OUTAGE_ALERT_MIN_FAILURES",
    "OUTAGE_ALERT_MIN_ATTEMPTS",
    "OUTAGE_ALERT_FAIL_SHARE_PERCENT",
    "OUTAGE_ALERT_DEBOUNCE_MS",
    "OUTAGE_ALERT_RETRY_MS",
    "OUTAGE_ALERT_SELF_TEST_INTERVAL_MS",
    "INBOUND_OUTAGE_ALERT_WINDOW_MS",
    "INBOUND_OUTAGE_ALERT_MIN_FAILURES",
    "INBOUND_OUTAGE_ALERT_MIN_ATTEMPTS",
    "INBOUND_OUTAGE_ALERT_FAIL_SHARE_PERCENT",
    "PLATFORM_HOLD_ESCALATION_MAX_AGE_MS",
    "PAID_WITHOUT_NUMBER_GRACE_MS",
    "BUDGET_MONTH_ENABLED",
    "TTS_CHARACTER_QUOTA",
    "TTS_CHARACTER_QUOTA_WARN_PERCENT",
    "TTS_QUOTA_CYCLE_ANCHOR_DAY",
    "PLATFORM_FIXED_COST_CENTS_PER_MONTH",
    "NUMBER_MONTHLY_COST_CENTS",
    "PRICE_DRIFT_MIN_INTERVAL_MS",
    "PRICE_DRIFT_UNKNOWN_ESCALATE_AFTER",
    "STRIPE_CUSTOMER_RETRY_DELAY_MS",
  ];
  const fresh = await mitUmgebungen(
    { ...Object.fromEntries(namen.map((name) => [name, "kaputt"])), PROVIDER_TO_BUCKET_RATE_MICRO: "kaputt" },
    () => import("../../src/config.js?billing-kaputt"),
  );
  const alleBefunde = fresh.configFatalErrors();
  assert.deepEqual(
    namen.filter((name) => befundeZu(alleBefunde, name).length !== 1),
    [],
    "jede ungueltige Variable braucht genau einen Fatal mit ihrem Namen",
  );
  assert.equal(
    befundeZu(alleBefunde, "PROVIDER_TO_BUCKET_RATE_MICRO").length,
    2,
    "PROVIDER_TO_BUCKET_RATE_MICRO wird in billing und llm gelesen, je Lesestelle ein Fatal",
  );
});
