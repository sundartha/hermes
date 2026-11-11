import { test } from "node:test";
import assert from "node:assert/strict";
import { config, assertConfig, configFatalErrors } from "../../src/config.js";
import { makeConfigOverrides, CONFIG_REQUIRED_OK } from "../helpers.js";
import { fehlerausgabeVon } from "./fehlerausgabe.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const BASIS = {
  ...CONFIG_REQUIRED_OK,
  webDistDir: "",
  llmProvider: "anthropic",
  llmProviderFallback: "",
  deepseekApiKey: "",
  oauthIssuerUrl: "",
  databaseUrl: "",
  sessionSecret: "",
  selfServiceEnabled: false,
  multiTenant: false,
  provisioningEnabled: false,
  skipTwilioSignatureCheck: false,
  statusToken: "",
  deployToken: "",
  platformAlertSmsTo: "+15005550006",
};

function lauf(ueberschreibung) {
  let ergebnis;
  const zeilen = fehlerausgabeVon(() => {
    withConfigOverrides({ ...BASIS, ...ueberschreibung }, () => {
      ergebnis = assertConfig();
    });
  });
  return { ergebnis, text: zeilen.join("\n") };
}

const PFLICHT_FAELLE = [
  ["anthropicApiKey", { anthropicApiKey: "" }, "fehlt/ungueltig: ANTHROPIC_API_KEY"],
  [
    "deepseek primaer",
    { llmProvider: "deepseek" },
    "fehlt/ungueltig: DEEPSEEK_API_KEY (weil LLM_PROVIDER/LLM_PROVIDER_FALLBACK=deepseek)",
  ],
  [
    "deepseek fallback",
    { llmProviderFallback: "deepseek" },
    "fehlt/ungueltig: DEEPSEEK_API_KEY (weil LLM_PROVIDER/LLM_PROVIDER_FALLBACK=deepseek)",
  ],
  ["publicUrl leer", { publicUrl: "" }, "fehlt/ungueltig: PUBLIC_URL"],
  ["publicUrl Platzhalter", { publicUrl: "https://CHANGE-ME.test" }, "fehlt/ungueltig: PUBLIC_URL"],
  [
    "oauth ohne Issuer",
    { mcpAuth: "oauth" },
    "fehlt/ungueltig: OAUTH_ISSUER_URL (weil MCP_AUTH=oauth)",
  ],
  [
    "pg ohne Datenbank",
    { storeBackend: "pg" },
    "fehlt/ungueltig: DATABASE_URL (weil STORE_BACKEND=pg)",
  ],
  [
    "Zahlung ohne Stripe-Schluessel",
    {
      paymentEnabled: true,
      stripeSecretKey: "",
      stripeWebhookSecret: "x",
      numberSetupFeeCents: 100,
    },
    "fehlt/ungueltig: STRIPE_SECRET_KEY (weil PAYMENT_ENABLED=true)",
  ],
  [
    "Zahlung ungueltige Einrichtungsgebuehr",
    {
      paymentEnabled: true,
      stripeSecretKey: "x",
      stripeWebhookSecret: "x",
      numberSetupFeeCents: 0,
    },
    "fehlt/ungueltig: NUMBER_SETUP_FEE_CENTS (weil PAYMENT_ENABLED=true, muss ganzzahlig > 0 sein)",
  ],
];

for (const [name, ueberschreibung, erwartet] of PFLICHT_FAELLE) {
  test(`assertConfig: Pflichtangabe ${name} verweigert den Boot mit Klartext`, () => {
    const { ergebnis, text } = lauf(ueberschreibung);
    assert.equal(ergebnis, false);
    assert.ok(text.includes(`  - ${erwartet}\n`) || text.includes(`  - ${erwartet}`), text);
    assert.match(text, /\[Konfiguration fatal\] Boot wird verweigert:/);
    assert.match(text, /\(\.env pruefen; \.env\.example kopieren: cp \.env\.example \.env\)/);
  });
}

test("assertConfig: vollstaendige Pflichtangaben liefern true ohne Fatal-Meldung", () => {
  const { ergebnis, text } = lauf({});
  assert.equal(ergebnis, true);
  assert.ok(!text.includes("[Konfiguration fatal]"), text);
});

test("assertConfig: Begruessungslaut ohne Asset im public-Ordner verweigert den Boot", () => {
  const vorher = config.voice.elevenLabsInbound.begruessungslautEnabled;
  config.voice.elevenLabsInbound.begruessungslautEnabled = true;
  try {
    const { ergebnis, text } = lauf({ publicDir: "/nicht/vorhanden" });
    assert.equal(ergebnis, false);
    assert.match(
      text,
      /fehlt\/ungueltig: Begruessungslaut-Asset \(public\/.* fehlt - node scripts\/render-begruessungslaut\.mjs\)/,
    );
  } finally {
    config.voice.elevenLabsInbound.begruessungslautEnabled = vorher;
  }
});

test("assertConfig: gleiche Status- und Deploy-Token sind fatal, verschiedene nicht", () => {
  const gleich = lauf({ statusToken: "t", deployToken: "t" });
  assert.equal(gleich.ergebnis, false);
  assert.ok(
    gleich.text.includes(
      "  - HERMES_STATUS_TOKEN und HERMES_DEPLOY_TOKEN sind gleich - der Statusschluessel braucht einen eigenen Wert.",
    ),
    gleich.text,
  );
  assert.equal(lauf({ statusToken: "a", deployToken: "b" }).ergebnis, true);
  assert.equal(lauf({ statusToken: "", deployToken: "" }).ergebnis, true);
});

test("assertConfig: fehlender Alarmkanal bei aktivem Outbound ist fatal und kommt aus dem Alarm-Pruefer", () => {
  const { ergebnis, text } = lauf({
    platformAlertSmsTo: "",
    platformAlertMailTo: "",
    outageAlertWindowMs: 60000,
  });
  const outbound = config.voice.elevenLabsOutbound.enabled;
  if (outbound) {
    assert.equal(ergebnis, false);
    assert.match(text, /PLATFORM_ALERT_SMS_TO ist leer UND der Mail-Kanal/);
  } else {
    assert.equal(ergebnis, true);
  }
});

test("assertConfig: lokale Warnungen erscheinen ausserhalb des Hostings", () => {
  const { ergebnis, text } = lauf({ skipTwilioSignatureCheck: true, mcpAuth: "off" });
  assert.equal(ergebnis, true);
  assert.ok(
    text.includes(
      "[Sicherheit] SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks ungeprueft (nur lokal ok)!",
    ),
    text,
  );
  assert.ok(
    text.includes("[Sicherheit] MCP_AUTH=off - /mcp ohne jede Pruefung offen (nur lokale Demos)!"),
    text,
  );
  const still = lauf({});
  assert.ok(!still.text.includes("[Sicherheit]"), still.text);
});

test("assertConfig: unsicherer http-Issuer wird lokal gewarnt, Loopback nicht", () => {
  const warnung =
    "[Sicherheit] OAUTH_ISSUER_URL ist nicht https - nur fuer lokale Tests zulaessig (SSRF/MITM-Risiko)!";
  const offen = lauf({ mcpAuth: "oauth", oauthIssuerUrl: "http://evil.example" });
  assert.equal(offen.ergebnis, true);
  assert.ok(offen.text.includes(warnung), offen.text);
  const lokal = lauf({ mcpAuth: "oauth", oauthIssuerUrl: "http://localhost:3000" });
  assert.ok(!lokal.text.includes(warnung), lokal.text);
});

test("assertConfig: Hinweise zu Zahlung, Web-Login und Self-Service", () => {
  const zahlung = lauf({
    paymentEnabled: true,
    stripeSecretKey: "x",
    stripeWebhookSecret: "x",
    numberSetupFeeCents: 100,
    provisioningEnabled: false,
  });
  assert.ok(
    zahlung.text.includes(
      "[Konfiguration] PAYMENT_ENABLED ohne PROVISIONING_ENABLED ist wirkungslos (kein echter Kauf -> kein Capture).",
    ),
    zahlung.text,
  );
  const mitProvisioning = lauf({
    paymentEnabled: true,
    stripeSecretKey: "x",
    stripeWebhookSecret: "x",
    numberSetupFeeCents: 100,
    provisioningEnabled: true,
  });
  assert.ok(!mitProvisioning.text.includes("PROVISIONING_ENABLED ist wirkungslos"));
  const login = lauf({ sessionSecret: "s" });
  assert.ok(
    login.text.includes("[Hinweis] Web-Login braucht STORE_BACKEND=pg (Sessions in der DB)."),
    login.text,
  );
  const selfService = lauf({ selfServiceEnabled: true, multiTenant: true });
  assert.ok(
    selfService.text.includes(
      "[Hinweis] SELF_SERVICE_ENABLED braucht den Web-Login (SESSION_SECRET + STORE_BACKEND=pg) - sonst sind die /api/self-service/*-Routen nicht erreichbar.",
    ),
    selfService.text,
  );
  const bereit = lauf({
    selfServiceEnabled: true,
    multiTenant: true,
    sessionSecret: "s",
    storeBackend: "pg",
    databaseUrl: "postgres://x",
  });
  assert.equal(bereit.ergebnis, true);
  assert.ok(!bereit.text.includes("[Hinweis]"), bereit.text);
});

test("assertConfig: die Fehlerliste der Umgebung bleibt ueber configFatalErrors lesbar und ist eine Kopie", () => {
  const liste = configFatalErrors();
  assert.ok(Array.isArray(liste));
  liste.push("x");
  assert.ok(!configFatalErrors().includes("x"));
});

test("assertConfig: im Hosting erscheinen die Nur-lokal-Warnungen nicht", () => {
  const vorher = process.env.RENDER_EXTERNAL_URL;
  process.env.RENDER_EXTERNAL_URL = "https://hermes.example";
  try {
    const { text } = lauf({
      skipTwilioSignatureCheck: true,
      mcpAuth: "off",
      oauthIssuerUrl: "http://evil.example",
    });
    assert.ok(!text.includes("(nur lokal ok)"), text);
    assert.ok(!text.includes("(nur lokale Demos)"), text);
    assert.ok(!text.includes("nur fuer lokale Tests zulaessig"), text);
  } finally {
    if (vorher === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = vorher;
  }
});
