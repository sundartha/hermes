import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  CONFIG_NAMESPACES,
  attachNamespaces,
  config,
  gatewayUrlForPort,
  isSelfServiceLive,
  resolveGatewayUrl,
} from "../../src/config.js";
import { makeConfigOverrides, ROOT } from "../helpers.js";
import { gebauteKonfiguration } from "./gebaute-konfiguration.js";
import { importNachUmgebung } from "./umgebung-import.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const EXPECTED_NAMESPACE_COUNTS = {
  safety: 17,
  billing: 56,
  provisioning: 17,
  auth: 18,
  mail: 7,
  llm: 17,
  telnyx: 1,
  voice: 18,
  telephony: 8,
  tenancy: 13,
  server: 10,
  store: 3,
  metrics: 1,
  privacy: 3,
  research: 7,
  werkzeug: 1,
};
const EXPECTED_TOTAL_KEYS = 197;

test("Struktur: CONFIG_NAMESPACES hat genau die gepinnten Counts und disjunkte Blaetter", () => {
  assert.deepEqual(
    Object.keys(CONFIG_NAMESPACES).sort(),
    Object.keys(EXPECTED_NAMESPACE_COUNTS).sort(),
  );
  for (const [namespace, count] of Object.entries(EXPECTED_NAMESPACE_COUNTS)) {
    assert.equal(
      CONFIG_NAMESPACES[namespace].length,
      count,
      `Namespace ${namespace} soll ${count} Keys haben`,
    );
  }
  const allNamespacedKeys = Object.values(CONFIG_NAMESPACES).flat();
  assert.equal(allNamespacedKeys.length, EXPECTED_TOTAL_KEYS, "Summe aller Namespace-Counts");
  assert.equal(
    new Set(allNamespacedKeys).size,
    EXPECTED_TOTAL_KEYS,
    "kein Key darf in zwei Namespaces gleichzeitig stehen",
  );
});

test("Oberflaeche: config traegt GENAU die gepinnten Namespaces (enumerable UND ueber 'in' erreichbar), kein flacher Key mehr", () => {
  assert.equal(new Set(Object.keys(config)).size, Object.keys(CONFIG_NAMESPACES).length);
  assert.deepEqual(Object.keys(config).sort(), Object.keys(CONFIG_NAMESPACES).sort());
  for (const namespace of Object.keys(CONFIG_NAMESPACES)) {
    assert.ok(namespace in config, `${namespace} muss ueber 'in' erreichbar sein`);
  }
});

const NUMERIC_SENTINEL_OFFSET = 12345;

function sentinelFor(currentValue) {
  if (typeof currentValue === "boolean") return !currentValue;
  if (typeof currentValue === "number") return currentValue + NUMERIC_SENTINEL_OFFSET;
  return "__pa12_override_sentinel__";
}

test("Setter-Durchschlag: ein Override ueber config.<ns>.<key> trifft fuer JEDES primitive Blatt denselben Speicher-Slot", () => {
  let checked = 0;
  for (const [namespace, keys] of Object.entries(CONFIG_NAMESPACES)) {
    for (const key of keys) {
      const currentValue = config[namespace][key];
      if (currentValue && typeof currentValue === "object") continue;
      checked += 1;
      const sentinel = sentinelFor(currentValue);
      withConfigOverrides({ [key]: sentinel }, () => {
        assert.strictEqual(
          config[namespace][key],
          sentinel,
          `${namespace}.${key} muss den Override live sehen (kein Wert-Kopie-Getter)`,
        );
      });
      assert.strictEqual(config[namespace][key], currentValue, `${namespace}.${key} restauriert`);
    }
  }
  const EXPECTED_PRIMITIVE_LEAVES = 183;
  assert.equal(
    checked,
    EXPECTED_PRIMITIVE_LEAVES,
    `alle primitiven Blaetter (${EXPECTED_TOTAL_KEYS} - 7 Arrays - 7 nested Objekte) geprueft`,
  );
});

test("No-double-eval: ein ungueltiger numerischer Env-Wert erzeugt genau EINEN Fatal-Befund, auch nach voller Namespace-Traversierung", async () => {
  const saved = process.env.MAX_CALLS_PER_HOUR;
  process.env.MAX_CALLS_PER_HOUR = "120abc";
  try {
    const fresh = await import("../../src/config.js?pa12-nodbl");
    const before = fresh.configFatalErrors().length;
    for (const [namespace, keys] of Object.entries(fresh.CONFIG_NAMESPACES)) {
      for (const key of keys) void fresh.config[namespace][key];
    }
    JSON.stringify(fresh.config);
    const after = fresh.configFatalErrors().length;
    assert.equal(after, before, "keine zusaetzlichen Fatal-Befunde durch den Namespace-Zugriff");
    assert.ok(
      fresh.configFatalErrors().some((msg) => msg.includes("MAX_CALLS_PER_HOUR")),
      "der urspruengliche Fatal-Befund muss weiter vorhanden sein",
    );
  } finally {
    if (saved === undefined) delete process.env.MAX_CALLS_PER_HOUR;
    else process.env.MAX_CALLS_PER_HOUR = saved;
  }
});

test("Duck-Typing + Guard: JSON.stringify/await funktionieren auf den Namespace-Gruppen, unbekannte Keys werfen weiter", async () => {
  assert.doesNotThrow(() => JSON.stringify(config.safety));
  assert.deepEqual(JSON.parse(JSON.stringify(config.safety)), config.safety);

  const awaited = await config.safety;
  assert.equal(awaited.maxCallsPerHour, config.safety.maxCallsPerHour);

  assert.throws(() => config.safety.nope, TypeError);

  assert.equal(typeof config.voice.elevenLabsPlayTts.model, "string");
  assert.throws(() => config.voice.elevenLabsPlayTts.nope, TypeError);
});

test("Flip-Regression: entfernte flache Keys werfen TypeError bei Read UND Write", () => {
  const removedFlatKeys = [
    "platformSpendCapCents",
    "maxCallsPerHour",
    "mcpAuth",
    "storeBackend",
    "telnyxElevenLabs",
    "telnyxAssistant",
    "elevenLabsPlayTts",
    "anthropicApiKey",
  ];
  for (const key of removedFlatKeys) {
    assert.throws(() => config[key], TypeError, `config.${key} (Read) sollte nicht mehr existieren`);
    assert.throws(
      () => {
        config[key] = "x";
      },
      TypeError,
      `config.${key} = ... (Write) sollte nicht mehr moeglich sein`,
    );
  }
});

const MONEY_CONFIG_KEYS = Object.freeze([
  "platformSpendCapCents",
  "numberSetupFeeCents",
  "voiceTariffDomesticCents",
  "voiceTariffDefaultCents",
  "voiceTariffInboundCents",
  "voiceTariffFullCostFloorCents",
  "defaultTenantBudgetCents",
  "smsCostCents",
  "usdToEur",
  "modelPricesUsd",
  "numberMonthlyCostCents",
  "platformFixedCostUsdCentsPerMonth",
  "voiceTariffGrundbetragCentsJeRoute",
  "researchSearchFeeCents",
  "lookupSearchFeeCents",
]);

const MONEY_NAME_PATTERN = /(Cents|Eur|Usd)$/;

test("Geld-Manifest: jedes Cents-/Eur-/Usd-Feld in config.js ist im Manifest erfasst", () => {
  const allNamespacedKeys = Object.values(CONFIG_NAMESPACES).flat();
  const moneyShapedKeys = allNamespacedKeys.filter((k) => MONEY_NAME_PATTERN.test(k));
  const unregistered = moneyShapedKeys.filter((k) => !MONEY_CONFIG_KEYS.includes(k));
  assert.deepEqual(
    unregistered,
    [],
    `Neues Geld-Feld in config.js nicht im Manifest eingetragen: ${unregistered.join(", ")}. ` +
      `Bewusst in MONEY_CONFIG_KEYS (test/gemeinsam/konfiguration-oberflaeche.test.js) aufnehmen.`,
  );
});

test("Geld-Manifest: kein gelistetes Feld wurde stillschweigend aus config.js entfernt", () => {
  const allNamespacedKeys = Object.values(CONFIG_NAMESPACES).flat();
  const missing = MONEY_CONFIG_KEYS.filter((k) => !allNamespacedKeys.includes(k));
  assert.deepEqual(
    missing,
    [],
    `Manifest-Feld existiert nicht mehr in config.js: ${missing.join(", ")}. Manifest nachziehen.`,
  );
});

const BEISPIEL_PORT = 3000;

test("gatewayUrlForPort baut die localhost-Fallback-URL", () => {
  assert.equal(gatewayUrlForPort(BEISPIEL_PORT), "http://localhost:3000");
  assert.equal(gatewayUrlForPort(0), "http://localhost:0");
});

test("resolveGatewayUrl: ohne GATEWAY_URL -> Fallback auf den config-Port", () => {
  const prev = process.env.GATEWAY_URL;
  try {
    delete process.env.GATEWAY_URL;
    assert.equal(resolveGatewayUrl(), gatewayUrlForPort(config.server.port));
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
  }
});

test("resolveGatewayUrl: mit GATEWAY_URL -> genau dieser Wert, Trailing-Slash gestrippt", () => {
  const prev = process.env.GATEWAY_URL;
  try {
    process.env.GATEWAY_URL = "https://hermes.example.test/";
    assert.equal(resolveGatewayUrl(), "https://hermes.example.test");
    process.env.GATEWAY_URL = "https://hermes.example.test";
    assert.equal(resolveGatewayUrl(), "https://hermes.example.test");
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
  }
});

test("isSelfServiceLive: beide Flags an -> true", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: true, multiTenant: true } }), true);
});

test("isSelfServiceLive: nur selfServiceEnabled an -> false", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: true, multiTenant: false } }), false);
});

test("isSelfServiceLive: nur multiTenant an -> false", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: false, multiTenant: true } }), false);
});

test("isSelfServiceLive: beide Flags aus -> false", () => {
  assert.equal(isSelfServiceLive({ tenancy: { selfServiceEnabled: false, multiTenant: false } }), false);
});

test("isSelfServiceLive: liefert immer einen echten Boolean (kein truthy-Objekt-Leak)", () => {
  assert.strictEqual(isSelfServiceLive({ tenancy: { selfServiceEnabled: true, multiTenant: true } }), true);
  assert.strictEqual(isSelfServiceLive({ tenancy: { selfServiceEnabled: false, multiTenant: false } }), false);
});

test("Guard: Lesen eines unbekannten Keys nennt Pfad und Ausweg im vollen Wortlaut", () => {
  assert.throws(() => config.safety.nope, {
    name: "TypeError",
    message:
      "config.safety.nope existiert nicht (verschobener/entfernter Config-Key? " +
      "config.<namespace>.<key> nutzen - Gruppierung in src/config.js pruefen).",
  });
});

test("Guard: Schreiben eines unbekannten Keys nennt Pfad und Ausweg im vollen Wortlaut", () => {
  assert.throws(
    () => {
      config.safety.nope = 1;
    },
    {
      name: "TypeError",
      message:
        "config.safety.nope kann nicht gesetzt werden (flache Oberflaeche entfernt; " +
        "config.<namespace>.<key> nutzen).",
    },
  );
});

test("Guard: Symbol-Schluessel lassen sich setzen und wieder lesen, ohne zu werfen", () => {
  const marke = Symbol("konfiguration-oberflaeche");
  assert.doesNotThrow(() => {
    config.safety[marke] = "gesetzt";
  });
  assert.equal(config.safety[marke], "gesetzt");
});

const BEISPIEL_STUNDENLIMIT = 7;
const GEAENDERTES_STUNDENLIMIT = 9;

test("attachNamespaces: zweimal auf dasselbe Ziel angewendet, liefern die Gruppen weiter den Speicher", () => {
  const ziel = { maxCallsPerHour: BEISPIEL_STUNDENLIMIT };
  const namensraeume = { safety: ["maxCallsPerHour"] };
  attachNamespaces(ziel, namensraeume);
  assert.doesNotThrow(() => attachNamespaces(ziel, namensraeume));
  assert.equal(ziel.safety.maxCallsPerHour, BEISPIEL_STUNDENLIMIT);
  ziel.safety.maxCallsPerHour = GEAENDERTES_STUNDENLIMIT;
  assert.equal(ziel.maxCallsPerHour, GEAENDERTES_STUNDENLIMIT);
  assert.deepEqual(Object.keys(ziel), ["maxCallsPerHour"]);
});

const STANDARD_SUCHGEBUEHR_CENT = 1;
const STANDARD_ABSCHALTFRIST_MS = 8000;
const STANDARD_AUFBEWAHRUNG_TAGE = 30;
const STANDARD_SMTP_PORT = 465;

const UNGESETZTE_ROHWERTE = Object.freeze({
  RESEARCH_ENABLED: undefined,
  RESEARCH_SEARCH_FEE_CENTS: undefined,
  LOOKUP_ENABLED: undefined,
  LOOKUP_SEARCH_FEE_CENTS: undefined,
  EXA_API_KEY: undefined,
  EXA_API_BASE: undefined,
  METRICS_ENABLED: undefined,
  RENDER_API_KEY: undefined,
  STORE_BACKEND: undefined,
  DATABASE_URL: undefined,
  PUBLIC_URL: undefined,
  RENDER_EXTERNAL_URL: undefined,
  SHUTDOWN_DRAIN_TIMEOUT_MS: undefined,
  RETENTION_DAYS: undefined,
  SMTP_PORT: undefined,
  SMTP_USER: undefined,
  SMTP_PASSWORD: undefined,
  MAIL_FROM: undefined,
  DATA_DIR: undefined,
});

test("Rohwerte: ohne gesetzte Variablen liefert config die festen Standardwerte", () => {
  const erwartet = {
    "research.researchEnabled": false,
    "research.researchSearchFeeCents": STANDARD_SUCHGEBUEHR_CENT,
    "research.lookupEnabled": false,
    "research.lookupSearchFeeCents": STANDARD_SUCHGEBUEHR_CENT,
    "research.exaApiKey": "",
    "research.exaApiBase": "https://api.exa.ai",
    "metrics.metricsEnabled": false,
    "werkzeug.renderApiKey": "",
    "store.storeBackend": "json",
    "store.databaseUrl": "",
    "server.publicUrl": "",
    "server.publicUrlExplicit": false,
    "server.shutdownDrainTimeoutMs": STANDARD_ABSCHALTFRIST_MS,
    "privacy.retentionDays": STANDARD_AUFBEWAHRUNG_TAGE,
    "mail.smtpPort": STANDARD_SMTP_PORT,
    "mail.smtpUser": "",
    "mail.smtpPassword": "",
    "mail.mailFrom": "",
  };
  const gebaut = gebauteKonfiguration(UNGESETZTE_ROHWERTE, [
    ...Object.keys(erwartet),
    "server.dataDir",
  ]);
  const { "server.dataDir": datenverzeichnis, ...werte } = gebaut;
  assert.deepEqual(werte, erwartet);
  assert.equal(path.resolve(datenverzeichnis), path.join(ROOT, "data"));
});

test("Rohwerte: gesetzte Variablen kommen getrimmt und unverändert in config an", () => {
  const gebaut = gebauteKonfiguration(
    {
      EXA_API_KEY: "  exa-schluessel \n",
      EXA_API_BASE: " https://exa.example.test/ ",
      RENDER_API_KEY: " render-schluessel ",
      DATABASE_URL: "postgres://hermes@db.example.test/hermes",
      PUBLIC_URL: "   ",
      RENDER_EXTERNAL_URL: undefined,
      SMTP_USER: "versand",
      SMTP_PASSWORD: "smtp-geheim",
      MAIL_FROM: "hermes@example.test",
    },
    [
      "research.exaApiKey",
      "research.exaApiBase",
      "werkzeug.renderApiKey",
      "store.databaseUrl",
      "server.publicUrlExplicit",
      "mail.smtpUser",
      "mail.smtpPassword",
      "mail.mailFrom",
    ],
  );
  assert.deepEqual(gebaut, {
    "research.exaApiKey": "exa-schluessel",
    "research.exaApiBase": "https://exa.example.test",
    "werkzeug.renderApiKey": "render-schluessel",
    "store.databaseUrl": "postgres://hermes@db.example.test/hermes",
    "server.publicUrlExplicit": false,
    "mail.smtpUser": "versand",
    "mail.smtpPassword": "smtp-geheim",
    "mail.mailFrom": "hermes@example.test",
  });
});

async function frischGeladenMit(umgebung) {
  const bisher = Object.fromEntries(Object.keys(umgebung).map((name) => [name, process.env[name]]));
  try {
    const [frisch] = await importNachUmgebung(
      umgebung,
      () => import("../../src/config.js?a6-rohwerte-ungueltig"),
    );
    return frisch;
  } finally {
    await importNachUmgebung(bisher);
  }
}

test("Rohwerte: jeder ungültige Wert erzeugt einen Fatal-Befund, der seine Variable nennt", async () => {
  const ungueltig = {
    RESEARCH_ENABLED: "vielleicht",
    RESEARCH_SEARCH_FEE_CENTS: "eins",
    LOOKUP_ENABLED: "vielleicht",
    LOOKUP_SEARCH_FEE_CENTS: "eins",
    METRICS_ENABLED: "vielleicht",
    PORT: "achtzig",
    SHUTDOWN_DRAIN_TIMEOUT_MS: "acht",
    RETENTION_DAYS: "dreissig",
    DIAGNOSTIC_RETENTION_DAYS: "sieben",
    EVIDENCE_RETENTION_DAYS: "keine",
    SMTP_PORT: "fuenf",
  };
  const frisch = await frischGeladenMit(ungueltig);
  const befunde = frisch.configFatalErrors();
  for (const [name, wert] of Object.entries(ungueltig)) {
    assert.ok(
      befunde.some((befund) => befund.startsWith(`${name}="${wert}"`)),
      `Fatal-Befund für ${name} fehlt`,
    );
  }
});

const STUNDEN_UND_ZIEL_LIMITS = Object.freeze(["maxCallsPerHour", "perTargetCallCap"]);

test("[NIE1] jeder Schlüssel aus CONFIG_NAMESPACES ist in config definiert, Stunden- und Pro-Ziel-Limit sind Zahlen", () => {
  const ohneWert = [];
  for (const [namespace, keys] of Object.entries(CONFIG_NAMESPACES)) {
    for (const key of keys) {
      if (config[namespace][key] === undefined) ohneWert.push(`${namespace}.${key}`);
    }
  }
  assert.deepEqual(ohneWert, []);
  assert.equal(Object.values(CONFIG_NAMESPACES).flat().length, EXPECTED_TOTAL_KEYS);
  assert.equal(config.billing.flushEpochIso, null);
  assert.equal(config.server.webDistDir, "");
  for (const key of STUNDEN_UND_ZIEL_LIMITS) {
    assert.ok(Number.isFinite(config.safety[key]), `safety.${key} muss eine Zahl sein`);
  }
});

const MS_JE_TAG = 86_400_000;
const STANDARD_MAX_NUMMERN = 5;
const STANDARD_WIEDERHOLUNGEN = 3;
const STANDARD_ERKENNUNGSFRIST_S = 5;
const HOECHSTE_ERKENNUNGSFRIST_S = 30;
const STANDARD_RUECKFRAGE_WARTEN_MS = 4000;
const STANDARD_RUECKFRAGE_OFFEN_MS = 47000;
const STANDARD_RUECKFRAGE_STUFE_MS = 5000;
const STANDARD_RUECKFRAGE_ANTWORT_MS = 30000;
const HOECHSTE_RUECKFRAGE_WARTEN_MS = 60_000;
const HOECHSTE_RUECKFRAGE_OFFEN_MS = 300_000;
const HOECHSTE_RUECKFRAGE_STUFE_MS = 55_000;
const GESETZTE_FREIGABETAGE = 2;

const UNGESETZTE_TELEFONIE_WERTE = Object.freeze({
  TELNYX_API_KEY: undefined,
  TELNYX_PUBLIC_KEY: undefined,
  TELNYX_API_BASE: undefined,
  TELNYX_CONNECTION_ID: undefined,
  TELNYX_ACCOUNT_SID: undefined,
  TELNYX_SIP_TRUNK_USERNAME: undefined,
  TELNYX_SIP_TRUNK_PASSWORD: undefined,
  MACHINE_DETECTION_ENABLED: undefined,
  MACHINE_DETECTION_TIMEOUT_S: undefined,
  OWNER_NUMBER_SEED: undefined,
  BOOTSTRAP_E164: undefined,
  BOOTSTRAP_PROVIDER: undefined,
  PLATFORM_ANI_E164: undefined,
  PROFILES_JSON: undefined,
  MAX_NUMBERS: undefined,
  MAX_NUMBERS_PER_TENANT: undefined,
  PROVISIONING_ENABLED: undefined,
  PROVISIONING_REDRIVE_MAX_AGE_MS: undefined,
  PROVISIONING_RETRY_MAX_ATTEMPTS: undefined,
  PROVISIONING_RETRY_MIN_INTERVAL_MS: undefined,
  RELEASE_GRACE_DAYS: undefined,
  PROVISIONING_COUNTRY: undefined,
  GEO_ENABLED: undefined,
  GEO_DB_PATH: undefined,
  WORLD_DEFAULT_LANGUAGE_ENABLED: undefined,
  MULTI_TENANT: undefined,
  MCP_UI_ENABLED: undefined,
  ASSISTANT_CONTEXT_ENABLED: undefined,
  SELF_SERVICE_ENABLED: undefined,
  PRECALL_BRIEFING_ENABLED: undefined,
  CONSULT_ENABLED: undefined,
  IN_CALL_CONSULT_ENABLED: undefined,
  CONSULT_WAIT_MS: undefined,
  CONSULT_OPEN_MS: undefined,
  EL_CONSULT_DELIVERY_MS: undefined,
  EL_CONSULT_ACK_MS: undefined,
  EL_CONSULT_ANSWER_MS: undefined,
});

test("Rohwerte telephony, provisioning, tenancy: ohne gesetzte Variablen gelten die festen Standardwerte", () => {
  const erwartet = {
    "telephony.telnyxApiKey": "",
    "telephony.telnyxPublicKey": "",
    "telephony.telnyxApiBase": "https://api.telnyx.com",
    "telephony.telnyxConnectionId": "",
    "telephony.telnyxAccountSid": "",
    "telephony.telnyxSipTrunkUsername": "",
    "telephony.telnyxSipTrunkPassword": "",
    "telephony.machineDetection.enabled": false,
    "telephony.machineDetection.timeoutS": STANDARD_ERKENNUNGSFRIST_S,
    "provisioning.maxNumbers": STANDARD_MAX_NUMMERN,
    "provisioning.maxNumbersPerTenant": 1,
    "provisioning.provisioningEnabled": false,
    "provisioning.provisioningRedriveMaxAgeMs": 0,
    "provisioning.provisioningRetryMaxAttempts": STANDARD_WIEDERHOLUNGEN,
    "provisioning.provisioningRetryMinIntervalMs": MS_JE_TAG,
    "provisioning.releaseGraceMs": 0,
    "provisioning.provisioningCountry": "DE",
    "provisioning.geoEnabled": false,
    "provisioning.geoDbPath": "",
    "provisioning.worldDefaultLanguageEnabled": false,
    "provisioning.ownerNumberSeed": "",
    "provisioning.bootstrapE164": "",
    "provisioning.bootstrapProvider": "",
    "provisioning.platformAniE164": "",
    "tenancy.multiTenant": false,
    "tenancy.mcpUiEnabled": true,
    "tenancy.assistantContextEnabled": true,
    "tenancy.selfServiceEnabled": false,
    "tenancy.profilesSeed": "",
    "tenancy.precallBriefingEnabled": false,
    "tenancy.consultEnabled": false,
    "tenancy.inCallConsultEnabled": false,
    "tenancy.consultWaitMs": STANDARD_RUECKFRAGE_WARTEN_MS,
    "tenancy.consultOpenMs": STANDARD_RUECKFRAGE_OFFEN_MS,
    "tenancy.elConsultDeliveryMs": STANDARD_RUECKFRAGE_STUFE_MS,
    "tenancy.elConsultAckMs": STANDARD_RUECKFRAGE_STUFE_MS,
    "tenancy.elConsultAnswerMs": STANDARD_RUECKFRAGE_ANTWORT_MS,
  };
  assert.deepEqual(
    gebauteKonfiguration(UNGESETZTE_TELEFONIE_WERTE, Object.keys(erwartet)),
    erwartet,
  );
});

test("Rohwerte telephony, provisioning, tenancy: gesetzte Variablen kommen getrimmt, umgerechnet und gedeckelt an", () => {
  const gebaut = gebauteKonfiguration(
    {
      TELNYX_API_BASE: "https://telnyx.example.test/",
      TELNYX_SIP_TRUNK_USERNAME: "  trunk-nutzer \n",
      TELNYX_SIP_TRUNK_PASSWORD: "trunk-geheim",
      MACHINE_DETECTION_ENABLED: "true",
      MACHINE_DETECTION_TIMEOUT_S: "99",
      PLATFORM_ANI_E164: " +4930123456 ",
      RELEASE_GRACE_DAYS: String(GESETZTE_FREIGABETAGE),
      PROVISIONING_COUNTRY: "FR",
      FORCE_NUMBER_COUNTRY: " at ",
      GEO_DB_PATH: "/srv/geo.mmdb",
      CONSULT_WAIT_MS: "999999",
      CONSULT_OPEN_MS: "999999",
      EL_CONSULT_ACK_MS: "999999",
    },
    [
      "telephony.telnyxApiBase",
      "telephony.telnyxSipTrunkUsername",
      "telephony.telnyxSipTrunkPassword",
      "telephony.machineDetection.enabled",
      "telephony.machineDetection.timeoutS",
      "provisioning.platformAniE164",
      "provisioning.releaseGraceMs",
      "provisioning.provisioningCountry",
      "provisioning.forceNumberCountry",
      "provisioning.geoDbPath",
      "tenancy.consultWaitMs",
      "tenancy.consultOpenMs",
      "tenancy.elConsultAckMs",
    ],
  );
  assert.deepEqual(gebaut, {
    "telephony.telnyxApiBase": "https://telnyx.example.test",
    "telephony.telnyxSipTrunkUsername": "trunk-nutzer",
    "telephony.telnyxSipTrunkPassword": "trunk-geheim",
    "telephony.machineDetection.enabled": true,
    "telephony.machineDetection.timeoutS": HOECHSTE_ERKENNUNGSFRIST_S,
    "provisioning.platformAniE164": "+4930123456",
    "provisioning.releaseGraceMs": GESETZTE_FREIGABETAGE * MS_JE_TAG,
    "provisioning.provisioningCountry": "FR",
    "provisioning.forceNumberCountry": "AT",
    "provisioning.geoDbPath": "/srv/geo.mmdb",
    "tenancy.consultWaitMs": HOECHSTE_RUECKFRAGE_WARTEN_MS,
    "tenancy.consultOpenMs": HOECHSTE_RUECKFRAGE_OFFEN_MS,
    "tenancy.elConsultAckMs": HOECHSTE_RUECKFRAGE_STUFE_MS,
  });
});

const UNGUELTIGE_TELEFONIE_WERTE = Object.freeze({
  MACHINE_DETECTION_ENABLED: "vielleicht",
  MACHINE_DETECTION_TIMEOUT_S: "fuenf",
  MAX_NUMBERS: "fuenf",
  MAX_NUMBERS_PER_TENANT: "eins",
  PROVISIONING_ENABLED: "vielleicht",
  PROVISIONING_REDRIVE_MAX_AGE_MS: "nie",
  PROVISIONING_RETRY_MAX_ATTEMPTS: "drei",
  PROVISIONING_RETRY_MIN_INTERVAL_MS: "taeglich",
  RELEASE_GRACE_DAYS: "zwei",
  MULTI_TENANT: "vielleicht",
  MCP_UI_ENABLED: "vielleicht",
  ASSISTANT_CONTEXT_ENABLED: "vielleicht",
  PRECALL_BRIEFING_ENABLED: "vielleicht",
  CONSULT_ENABLED: "vielleicht",
  IN_CALL_CONSULT_ENABLED: "vielleicht",
  CONSULT_WAIT_MS: "kurz",
  CONSULT_OPEN_MS: "lang",
  EL_CONSULT_DELIVERY_MS: "bald",
  EL_CONSULT_ACK_MS: "gleich",
  EL_CONSULT_ANSWER_MS: "spaeter",
  SELF_SERVICE_ENABLED: "vielleicht",
  GEO_ENABLED: "vielleicht",
  WORLD_DEFAULT_LANGUAGE_ENABLED: "vielleicht",
});

function aktuelleWerte(namen) {
  return Object.fromEntries(namen.map((name) => [name, process.env[name]]));
}

test("Rohwerte telephony, provisioning, tenancy: jeder ungültige Wert nennt seine Variable und fällt auf den Standard", async (t) => {
  const vorher = aktuelleWerte(Object.keys(UNGUELTIGE_TELEFONIE_WERTE));
  t.after(() => importNachUmgebung(vorher));
  const [geladen] = await importNachUmgebung(
    UNGUELTIGE_TELEFONIE_WERTE,
    () => import("../../src/config.js?a7-rohwerte-ungueltig"),
  );
  const befunde = geladen.configFatalErrors();
  const ohneBefund = Object.entries(UNGUELTIGE_TELEFONIE_WERTE)
    .filter(([name, wert]) => !befunde.some((befund) => befund.startsWith(`${name}="${wert}"`)))
    .map(([name]) => name);
  assert.deepEqual(ohneBefund, [], "Fatal-Befund fehlt");
  assert.deepEqual(
    [
      geladen.config.telephony.machineDetection,
      geladen.config.provisioning.releaseGraceMs,
      geladen.config.tenancy.mcpUiEnabled,
      geladen.config.tenancy.consultWaitMs,
    ],
    [
      { enabled: false, timeoutS: STANDARD_ERKENNUNGSFRIST_S },
      0,
      true,
      STANDARD_RUECKFRAGE_WARTEN_MS,
    ],
  );
});
