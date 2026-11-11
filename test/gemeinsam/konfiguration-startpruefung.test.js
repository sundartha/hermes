import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config, assertConfig, productionAuthHints, productionFootguns } from "../../src/config.js";
import { makeConfigOverrides, CONFIG_REQUIRED_OK } from "../helpers.js";
import { fehlerausgabeVon } from "./fehlerausgabe.js";

const { withConfigOverrides } = makeConfigOverrides(config);

const REQUIRED_OK = {
  ...CONFIG_REQUIRED_OK,
  paymentEnabled: true,
  stripeSecretKey: "x",
  stripeWebhookSecret: "x",
  platformAlertSmsTo: "+15005550006",
};

test("assertConfig: NaN NUMBER_SETUP_FEE_CENTS bei PAYMENT_ENABLED ist fail-closed (KORR1)", () => {
  withConfigOverrides({ ...REQUIRED_OK, numberSetupFeeCents: NaN }, () => {
    assert.equal(assertConfig(), false);
  });
});

test("assertConfig: nicht-ganzzahliges NUMBER_SETUP_FEE_CENTS ist fail-closed", () => {
  withConfigOverrides({ ...REQUIRED_OK, numberSetupFeeCents: 5.5 }, () => {
    assert.equal(assertConfig(), false);
  });
});

test("assertConfig: gueltiges ganzzahliges NUMBER_SETUP_FEE_CENTS > 0 ist ok", () => {
  withConfigOverrides({ ...REQUIRED_OK, numberSetupFeeCents: 100 }, () => {
    assert.equal(assertConfig(), true);
  });
});

test("assertConfig: PAYMENT_ENABLED ohne STRIPE_WEBHOOK_SECRET ist fail-closed (W4)", () => {
  withConfigOverrides({ ...REQUIRED_OK, numberSetupFeeCents: 100, stripeWebhookSecret: "" }, () => {
    assert.equal(assertConfig(), false);
  });
});

const SICHERE_ANMELDUNG = Object.freeze({
  dashboardPassword: "geheim",
  mcpAuth: "",
  oauthIssuerUrl: "",
  oauthAudience: "",
});
const SAFE_PROD = {
  server: { publicUrl: "https://agent.test", publicUrlExplicit: true },
  store: { storeBackend: "pg" },
  safety: { skipTwilioSignatureCheck: false },
  auth: SICHERE_ANMELDUNG,
};

test("T-P0-5-01: nicht-Produktion -> nie Footguns (alle Schalter offen erlaubt)", () => {
  const wideOpen = {
    auth: { dashboardPassword: "", mcpAuth: "off", oauthIssuerUrl: "http://evil.example" },
    safety: { skipTwilioSignatureCheck: true },
  };
  assert.deepEqual(productionFootguns(wideOpen, false), [], "lokal/Test bleibt alles erlaubt");
});

test("T-P0-5-02: Produktion + alles entschaerft -> keine Footguns", () => {
  assert.deepEqual(productionFootguns(SAFE_PROD, true), [], "saubere Hosting-Config hat keine Footguns");
});

test("T-P0-5-03: Produktion + fehlendes DASHBOARD_PASSWORD -> fatal (nennt Var)", () => {
  const errors = productionFootguns({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, dashboardPassword: "" } }, true);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /DASHBOARD_PASSWORD/);
});

test("T-P0-5-04: Produktion + MCP_AUTH=off -> fatal (nennt Var)", () => {
  const errors = productionFootguns({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, mcpAuth: "off" } }, true);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /MCP_AUTH=off/);
});

test("T-P0-5-05: Produktion + SKIP_TWILIO_SIGNATURE_CHECK=true -> fatal (nennt Var)", () => {
  const errors = productionFootguns({ ...SAFE_PROD, safety: { ...SAFE_PROD.safety, skipTwilioSignatureCheck: true } }, true);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /SKIP_TWILIO_SIGNATURE_CHECK/);
});

test("T-P0-5-06: Produktion + http-OAUTH_ISSUER_URL -> fatal; https + localhost-http erlaubt", () => {
  assert.match(productionFootguns({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, oauthIssuerUrl: "http://idp.example" } }, true)[0], /OAUTH_ISSUER_URL/);
  assert.deepEqual(productionFootguns({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, oauthIssuerUrl: "https://idp.example" } }, true), [], "https-Issuer ist sicher");
  assert.deepEqual(productionFootguns({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, oauthIssuerUrl: "http://127.0.0.1:8080" } }, true), [], "localhost-IdP bleibt erlaubt");
  assert.deepEqual(productionFootguns({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, oauthIssuerUrl: "http://localhost:8080/x" } }, true), [], "localhost-IdP bleibt erlaubt");
});

test("T-P0-5-15: Produktion + leeres OAUTH_AUDIENCE -> kein Footgun (kanonischer Default gilt)", () => {
  assert.deepEqual(productionFootguns({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, oauthAudience: "" } }, true), []);
});

test("T-P0-5-16: Produktion + kanonisches OAUTH_AUDIENCE (auch mit Schraegstrich) -> kein Footgun", () => {
  assert.deepEqual(
    productionFootguns({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, oauthAudience: "https://agent.test/mcp" } }, true),
    [],
  );
  assert.deepEqual(
    productionFootguns({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, oauthAudience: "https://agent.test/mcp/" } }, true),
    [],
    "ein live gemeintes trailing-slash-Mcp darf keinen Boot-Abbruch ausloesen (PM-8)",
  );
});

test("T-P0-5-17: Produktion + divergentes OAUTH_AUDIENCE -> fatal (nennt Var)", () => {
  const errors = productionFootguns(
    { ...SAFE_PROD, auth: { ...SAFE_PROD.auth, oauthAudience: "https://fremd.example/mcp" } },
    true,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /OAUTH_AUDIENCE/);
});

test("T-P0-5-07: Produktion + mehrere Footguns -> alle gesammelt", () => {
  const ANZAHL_GLEICHZEITIGER_FOOTGUNS = 6;
  const errors = productionFootguns(
    {
      auth: { dashboardPassword: "", mcpAuth: "off", oauthIssuerUrl: "http://idp.example" },
      safety: { skipTwilioSignatureCheck: true },
      store: { storeBackend: "json" },
      server: { publicUrlExplicit: false },
    },
    true,
  );
  assert.equal(errors.length, ANZAHL_GLEICHZEITIGER_FOOTGUNS, "alle sechs Footguns werden gemeldet, nicht nur der erste");
});

function withProdEnv(fn) {
  const saved = process.env.RENDER_EXTERNAL_URL;
  process.env.RENDER_EXTERNAL_URL = "https://agent.onrender.com";
  try { return fn(); } finally {
    if (saved === undefined) delete process.env.RENDER_EXTERNAL_URL;
    else process.env.RENDER_EXTERNAL_URL = saved;
  }
}

const REQUIRED_OK_PROD = {
  anthropicApiKey: "x",
  publicUrl: "https://agent.onrender.com", publicUrlExplicit: true, storeBackend: "json", paymentEnabled: false,
  mcpAuth: "", skipTwilioSignatureCheck: false, oauthIssuerUrl: "", dashboardPassword: "",
};

test("T-P0-5-08: assertConfig im Hosting -> Footgun macht Boot-Refusal (false) + nennt Var", () => {
  withProdEnv(() => withConfigOverrides(REQUIRED_OK_PROD, () => {
    const lines = fehlerausgabeVon(() => {
      assert.equal(assertConfig(), false, "fehlendes DASHBOARD_PASSWORD im Hosting -> assertConfig false");
    });
    const out = lines.join("\n");
    assert.match(out, /Boot wird verweigert/);
    assert.match(out, /DASHBOARD_PASSWORD/);
  }));
});

test("T-P0-5-09: assertConfig im Hosting + alles entschaerft -> kein Footgun-Refusal (true)", () => {
  withProdEnv(() => withConfigOverrides({ ...REQUIRED_OK_PROD, dashboardPassword: "geheim", storeBackend: "pg", databaseUrl: "postgres://test-db" }, () => {
    fehlerausgabeVon(() => {
      assert.equal(assertConfig(), true, "saubere Hosting-Config bootet (kein Fehl-Refusal)");
    });
  }));
});

test("T-P0-1-AC1-01: Produktion + STORE_BACKEND=json -> fatal (nennt STORE_BACKEND)", () => {
  const errors = productionFootguns({ ...SAFE_PROD, store: { ...SAFE_PROD.store, storeBackend: "json" } }, true);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /STORE_BACKEND/);
});

test("T-P0-1-AC1-02: Produktion + STORE_BACKEND=pg -> kein Footgun", () => {
  assert.deepEqual(productionFootguns({ ...SAFE_PROD, store: { ...SAFE_PROD.store, storeBackend: "pg" } }, true), []);
});

test("T-P0-1-AC1-03: Produktion + Tippfehler 'postgres' -> fatal (store.js nimmt nur 'pg')", () => {
  const errors = productionFootguns({ ...SAFE_PROD, store: { ...SAFE_PROD.store, storeBackend: "postgres" } }, true);
  assert.equal(errors.length, 1, "Tippfehler darf nicht still ins json-Backend fallen");
  assert.match(errors[0], /STORE_BACKEND/);
});

test("T-P0-1-AC1-04: Produktion + undefined storeBackend -> fatal", () => {
  const errors = productionFootguns({ ...SAFE_PROD, store: { ...SAFE_PROD.store, storeBackend: undefined } }, true);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /STORE_BACKEND/);
});

test("T2-04-01: Produktion + publicUrlExplicit=false -> genau ein Befund, nennt Var + Sollform, kein Wert-Echo", () => {
  const errors = productionFootguns(
    { ...SAFE_PROD, server: { ...SAFE_PROD.server, publicUrlExplicit: false } },
    true,
  );
  assert.equal(errors.length, 1);
  assert.match(errors[0], /PUBLIC_URL/);
  assert.match(errors[0], /https:\/\/<host>/);
  assert.doesNotMatch(errors[0], /agent\.test/, "kein Echo des konfigurierten Wertes");
});

test("T2-04-02: Produktion + publicUrlExplicit=true -> kein Footgun", () => {
  assert.deepEqual(
    productionFootguns({ ...SAFE_PROD, server: { ...SAFE_PROD.server, publicUrlExplicit: true } }, true),
    [],
  );
});

test("T2-04-03: nicht-Produktion + publicUrlExplicit=false -> kein Footgun (Rueckfall-Quelle ist der Produktionsdiskriminator)", () => {
  assert.deepEqual(
    productionFootguns({ ...SAFE_PROD, server: { ...SAFE_PROD.server, publicUrlExplicit: false } }, false),
    [],
  );
});

const MCP_AUTH_PATTERN = /MCP_AUTH/;

test("T2-03-01: Produktion + mcpAuth=token -> genau eine Zeile, nennt MCP_AUTH", () => {
  const hints = productionAuthHints({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, mcpAuth: "token" } }, true);
  assert.equal(hints.length, 1);
  assert.match(hints[0], MCP_AUTH_PATTERN);
});

test("T2-03-02: Produktion + mcpAuth='' (leer) -> genau eine Zeile, nennt MCP_AUTH", () => {
  const hints = productionAuthHints({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, mcpAuth: "" } }, true);
  assert.equal(hints.length, 1);
  assert.match(hints[0], MCP_AUTH_PATTERN);
});

test("T2-03-03: Produktion + mcpAuth Tippfehler ('oath') -> genau eine Zeile", () => {
  const hints = productionAuthHints({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, mcpAuth: "oath" } }, true);
  assert.equal(hints.length, 1);
});

test("T2-03-04: Produktion + mcpAuth=oauth -> keine Zeile", () => {
  const hints = productionAuthHints({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, mcpAuth: "oauth" } }, true);
  assert.deepEqual(hints, []);
});

test("T2-03-05: Produktion + mcpAuth=off -> keine Zeile (kein Doppel-Report, bereits fatal)", () => {
  const cfg = { ...SAFE_PROD, auth: { ...SAFE_PROD.auth, mcpAuth: "off" } };
  assert.deepEqual(productionAuthHints(cfg, true), []);
  const fatalErrors = productionFootguns(cfg, true);
  assert.ok(
    fatalErrors.some((zeile) => /MCP_AUTH=off/.test(zeile)),
    "MCP_AUTH=off bleibt ueber productionFootguns fatal sichtbar - kein Signalverlust",
  );
});

test("T2-03-06: nicht-Produktion -> immer keine Zeile, egal welcher mcpAuth-Wert", () => {
  for (const mcpAuth of ["", "token", "off"]) {
    const hints = productionAuthHints({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, mcpAuth } }, false);
    assert.deepEqual(hints, [], `mcpAuth=${mcpAuth}`);
  }
});

test("T2-03-07: der Hinweistext leakt niemals den Token-Wert (nur den Variablennamen)", () => {
  const marker = "T203-MARKER-xyz";
  const hints = productionAuthHints(
    { ...SAFE_PROD, auth: { ...SAFE_PROD.auth, mcpAuth: "token", mcpAuthToken: marker } },
    true,
  );
  assert.ok(
    hints.every((zeile) => !zeile.includes(marker)),
    "kein Hinweistext darf den Token-Wert enthalten",
  );
});

test("T2-03-08: keine Sperrwirkung an der Wurzel - Token-Modus bleibt in productionFootguns nicht-fatal", () => {
  const cfg = { ...SAFE_PROD, auth: { ...SAFE_PROD.auth, mcpAuth: "token", mcpAuthToken: "x" } };
  assert.deepEqual(productionFootguns(cfg, true), []);
});

const WEB_REQUIRED_OK = {
  anthropicApiKey: "x",
  publicUrl: "https://example.test",
  mcpAuth: "",
  storeBackend: "json",
  paymentEnabled: false,
};
const WEB_DIST_MSG = "WEB_DIST_DIR-Build";

test("WEB_DIST_DIR gesetzt, aber kein index.html -> assertConfig false + nennt WEB_DIST_DIR", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-webdist-noindex-"));
  try {
    withConfigOverrides({ ...WEB_REQUIRED_OK, webDistDir: dir }, () => {
      const lines = fehlerausgabeVon(() => {
        assert.equal(assertConfig(), false, "fehlendes index.html -> Boot-Refusal");
      });
      assert.ok(
        lines.join("\n").includes(WEB_DIST_MSG),
        "Diagnose muss die WEB_DIST_DIR-Build-Meldung nennen",
      );
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("Gegenprobe: WEB_DIST_DIR mit index.html -> assertConfig true, kein WEB_DIST_DIR-Flag", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-webdist-ok-"));
  fs.writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>ok</title>");
  try {
    withConfigOverrides({ ...WEB_REQUIRED_OK, webDistDir: dir }, () => {
      const lines = fehlerausgabeVon(() => {
        assert.equal(assertConfig(), true, "vorhandenes index.html -> Boot ok");
      });
      assert.ok(
        !lines.join("\n").includes(WEB_DIST_MSG),
        "kein WEB_DIST_DIR-Build-Flag wenn index.html existiert",
      );
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

import { configFatalErrors } from "../../src/config.js";

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
