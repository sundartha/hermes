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

const mitAnmeldung = (anmeldung) => ({ ...SAFE_PROD, auth: { ...SAFE_PROD.auth, ...anmeldung } });

test("Issuer-Pruefung: nackter localhost-Issuer ohne Port und Pfad bleibt erlaubt", () => {
  for (const oauthIssuerUrl of ["http://localhost", "http://127.0.0.1", "http://[::1]"]) {
    assert.deepEqual(productionFootguns(mitAnmeldung({ oauthIssuerUrl }), true), [], oauthIssuerUrl);
  }
});

test("Issuer-Pruefung: localhost erst hinter einem fremden http-Host ist fatal", () => {
  const issuerMitLocalhostImPfad = "http://idp.example/weiter?ziel=http://localhost/";
  assert.deepEqual(productionFootguns(mitAnmeldung({ oauthIssuerUrl: issuerMitLocalhostImPfad }), true), [
    "OAUTH_ISSUER_URL ist nicht https - SSRF/MITM-Footgun (im Hosting unzulaessig).",
  ]);
});

test("Footgun-Befunde: jeder Befund hat seinen vollstaendigen Wortlaut", () => {
  const faelle = [
    {
      cfg: mitAnmeldung({ dashboardPassword: "" }),
      befund:
        "DASHBOARD_PASSWORD fehlt - seit AUTH-P7 liest keine Route mehr diese Variable; Boot-Pflicht bleibt bis AUTH-P8 ausschliesslich als Rollback-Sicherung (ein Rollback auf einen Commit vor AUTH-P7 findet damit ein scharfes Gate vor).",
    },
    {
      cfg: mitAnmeldung({ mcpAuth: "off" }),
      befund: "MCP_AUTH=off - /mcp ist ohne jede Pruefung offen (im Hosting unzulaessig).",
    },
    {
      cfg: { ...SAFE_PROD, safety: { skipTwilioSignatureCheck: true } },
      befund: "SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks bleiben ungeprueft (im Hosting unzulaessig).",
    },
    {
      cfg: { ...SAFE_PROD, store: { storeBackend: "json" } },
      befund:
        "STORE_BACKEND ist nicht 'pg' - der json-Store liegt auf Renders fluechtigem Dateisystem (Datenverlust bei jedem Deploy/Neustart). Im Hosting STORE_BACKEND=pg + DATABASE_URL Pflicht.",
    },
    {
      cfg: mitAnmeldung({ oauthAudience: "https://fremd.example/mcp" }),
      befund:
        "OAUTH_AUDIENCE weicht von der kanonischen MCP-Audience (PUBLIC_URL + /mcp) ab - Wert leeren (kanonischer Default) oder exakt darauf setzen.",
    },
    {
      cfg: { ...SAFE_PROD, server: { ...SAFE_PROD.server, publicUrlExplicit: false } },
      befund:
        "PUBLIC_URL fehlt - der angekuendigte Origin faellt sonst still auf den Hosting-Host zurueck. Pflichtform: https://<host>[:<port>], ohne Pfad/Query/Slash am Ende, und exakt der Origin der OpenAI-Einreichung (nicht der Hosting-Host): ein Origin-Wechsel nach der Publikation verlangt ein neues Plugin.",
    },
  ];
  for (const { cfg, befund } of faelle) {
    assert.deepEqual(productionFootguns(cfg, true), [befund]);
  }
});

test("Footgun-Befunde: DEV_LOGIN_ENABLED=true in Produktion meldet den Login-Shim", () => {
  const gemerkt = process.env.DEV_LOGIN_ENABLED;
  process.env.DEV_LOGIN_ENABLED = "true";
  try {
    assert.deepEqual(productionFootguns(SAFE_PROD, true), [
      "DEV_LOGIN_ENABLED=true - Login-Shim umgeht WorkOS (im Hosting unzulaessig).",
    ]);
  } finally {
    if (gemerkt === undefined) delete process.env.DEV_LOGIN_ENABLED;
    else process.env.DEV_LOGIN_ENABLED = gemerkt;
  }
});

test("Auth-Hinweis: statischer Bearer in Produktion meldet den vollstaendigen Hinweistext", () => {
  assert.deepEqual(productionAuthHints(mitAnmeldung({ mcpAuth: "token" }), true), [
    "[Sicherheit] MCP_AUTH ist nicht 'oauth' - /mcp laeuft im Hosting mit statischem Bearer statt OAuth 2.1; Claude-/ChatGPT-Connectoren erhalten 401 (T-5). Kein Boot-Stopp (Hinweis).",
  ]);
});

const BEGRUESSUNGSLAUT_PFAD = "/brand/hermes-begruessungslaut.wav";
const KOPF_FATAL = "\n[Konfiguration fatal] Boot wird verweigert:";
const FUSS_FATAL = "(.env pruefen; .env.example kopieren: cp .env.example .env)\n";
const fehlt = (name) => `  - fehlt/ungueltig: ${name}`;
const WARNUNG_SIGNATUR =
  "[Sicherheit] SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks ungeprueft (nur lokal ok)!";
const WARNUNG_MCP_OFFEN =
  "[Sicherheit] MCP_AUTH=off - /mcp ohne jede Pruefung offen (nur lokale Demos)!";
const HINWEIS_ZAHLUNG_OHNE_EINKAUF =
  "[Konfiguration] PAYMENT_ENABLED ohne PROVISIONING_ENABLED ist wirkungslos (kein echter Kauf -> kein Capture).";
const HINWEIS_LOGIN_BRAUCHT_PG =
  "[Hinweis] Web-Login braucht STORE_BACKEND=pg (Sessions in der DB).";
const HINWEIS_SELBSTBEDIENUNG =
  "[Hinweis] SELF_SERVICE_ENABLED braucht den Web-Login (SESSION_SECRET + STORE_BACKEND=pg) - sonst sind die /api/self-service/*-Routen nicht erreichbar.";
const WARNUNG_HTTP_ISSUER =
  "[Sicherheit] OAUTH_ISSUER_URL ist nicht https - nur fuer lokale Tests zulaessig (SSRF/MITM-Risiko)!";
const NAME_DEEPSEEK = "DEEPSEEK_API_KEY (weil LLM_PROVIDER/LLM_PROVIDER_FALLBACK=deepseek)";
const NAME_GEBUEHR = "NUMBER_SETUP_FEE_CENTS (weil PAYMENT_ENABLED=true, muss ganzzahlig > 0 sein)";

const NEUTRAL_START = Object.freeze({
  anthropicApiKey: "x",
  llmProvider: "anthropic",
  llmProviderFallback: "",
  deepseekApiKey: "",
  publicUrl: "https://agent.test",
  publicUrlExplicit: true,
  mcpAuth: "oauth",
  oauthIssuerUrl: "https://idp.example",
  oauthAudience: "",
  dashboardPassword: "geheim",
  storeBackend: "pg",
  databaseUrl: "postgres://test-db",
  paymentEnabled: false,
  stripeSecretKey: "",
  stripeWebhookSecret: "",
  numberSetupFeeCents: 100,
  provisioningEnabled: false,
  platformAlertSmsTo: "+15005550006",
  webDistDir: "",
  skipTwilioSignatureCheck: false,
  sessionSecret: "sitzung",
  selfServiceEnabled: false,
  multiTenant: false,
});
const MIT_ZAHLUNG = Object.freeze({
  paymentEnabled: true,
  provisioningEnabled: true,
  stripeSecretKey: "sk",
  stripeWebhookSecret: "wh",
});
const SELBSTBEDIENUNG_LIVE = Object.freeze({ selfServiceEnabled: true, multiTenant: true });
const ALLE_LOKAL_OFFEN = Object.freeze({
  skipTwilioSignatureCheck: true,
  mcpAuth: "off",
  oauthIssuerUrl: "http://idp.example",
});

function setzeUmgebung(name, wert) {
  if (wert === undefined) delete process.env[name];
  else process.env[name] = wert;
}

function mitUmgebung(werte, aufgabe) {
  const gemerkt = Object.fromEntries(Object.keys(werte).map((name) => [name, process.env[name]]));
  for (const [name, wert] of Object.entries(werte)) setzeUmgebung(name, wert);
  try {
    return aufgabe();
  } finally {
    for (const [name, wert] of Object.entries(gemerkt)) setzeUmgebung(name, wert);
  }
}

function startpruefung({ abweichung = {}, produktion = false }) {
  const umgebung = {
    RENDER_EXTERNAL_URL: produktion ? "https://agent.onrender.com" : undefined,
    DEV_LOGIN_ENABLED: undefined,
  };
  return mitUmgebung(umgebung, () =>
    withConfigOverrides({ ...NEUTRAL_START, ...abweichung }, () => {
      let bootet;
      const zeilen = fehlerausgabeVon(() => {
        bootet = assertConfig();
      });
      return { bootet, zeilen };
    }),
  );
}

test("assertConfig: neutrale Konfiguration bootet lokal und im Hosting ohne jede Meldung", () => {
  assert.deepEqual(startpruefung({}), { bootet: true, zeilen: [] });
  assert.deepEqual(startpruefung({ produktion: true }), { bootet: true, zeilen: [] });
  assert.deepEqual(startpruefung({ abweichung: MIT_ZAHLUNG }), { bootet: true, zeilen: [] });
});

test("assertConfig: jede fehlende Pflichtangabe verweigert den Boot mit ihrem vollstaendigen Namen", () => {
  const faelle = [
    { abweichung: { anthropicApiKey: "" }, name: "ANTHROPIC_API_KEY" },
    { abweichung: { llmProvider: "deepseek" }, name: NAME_DEEPSEEK },
    { abweichung: { llmProviderFallback: "deepseek" }, name: NAME_DEEPSEEK },
    { abweichung: { publicUrl: "" }, name: "PUBLIC_URL" },
    { abweichung: { publicUrl: "https://CHANGE-ME.example" }, name: "PUBLIC_URL" },
    { abweichung: { oauthIssuerUrl: "" }, name: "OAUTH_ISSUER_URL (weil MCP_AUTH=oauth)" },
    { abweichung: { databaseUrl: "" }, name: "DATABASE_URL (weil STORE_BACKEND=pg)" },
    {
      abweichung: { ...MIT_ZAHLUNG, stripeSecretKey: "" },
      name: "STRIPE_SECRET_KEY (weil PAYMENT_ENABLED=true)",
    },
    {
      abweichung: { ...MIT_ZAHLUNG, stripeWebhookSecret: "" },
      name: "STRIPE_WEBHOOK_SECRET (weil PAYMENT_ENABLED=true)",
    },
    { abweichung: { ...MIT_ZAHLUNG, numberSetupFeeCents: 0 }, name: NAME_GEBUEHR },
    { abweichung: { ...MIT_ZAHLUNG, numberSetupFeeCents: -5 }, name: NAME_GEBUEHR },
  ];
  for (const { abweichung, name } of faelle) {
    assert.deepEqual(
      startpruefung({ abweichung }),
      { bootet: false, zeilen: [KOPF_FATAL, fehlt(name), FUSS_FATAL] },
      JSON.stringify(abweichung),
    );
  }
});

test("assertConfig: ohne Zahlung und ohne pg bleiben Stripe, Gebuehr und DATABASE_URL folgenlos", () => {
  assert.deepEqual(
    startpruefung({
      abweichung: { numberSetupFeeCents: 0, stripeSecretKey: "", stripeWebhookSecret: "" },
    }),
    { bootet: true, zeilen: [] },
  );
  assert.deepEqual(
    startpruefung({ abweichung: { storeBackend: "json", databaseUrl: "", sessionSecret: "" } }),
    { bootet: true, zeilen: [] },
  );
});

test("assertConfig: fehlender Begruessungslaut verweigert den Boot, vorhandener nicht", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hermes-begruessungslaut-"));
  const elevenLabsInbound = { ...config.voice.elevenLabsInbound, begruessungslautEnabled: true };
  try {
    assert.deepEqual(startpruefung({ abweichung: { publicDir: dir, elevenLabsInbound } }), {
      bootet: false,
      zeilen: [
        KOPF_FATAL,
        fehlt(
          `Begruessungslaut-Asset (public${BEGRUESSUNGSLAUT_PFAD} fehlt - node scripts/render-begruessungslaut.mjs)`,
        ),
        FUSS_FATAL,
      ],
    });
    fs.mkdirSync(path.join(dir, "brand"));
    fs.writeFileSync(path.join(dir, BEGRUESSUNGSLAUT_PFAD), "RIFF");
    assert.deepEqual(startpruefung({ abweichung: { publicDir: dir, elevenLabsInbound } }), {
      bootet: true,
      zeilen: [],
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("assertConfig: lokale Warnungen und Hinweise erscheinen genau bei ihrer Bedingung", () => {
  const faelle = [
    { abweichung: { skipTwilioSignatureCheck: true }, zeilen: [WARNUNG_SIGNATUR] },
    { abweichung: { mcpAuth: "off" }, zeilen: [WARNUNG_MCP_OFFEN] },
    {
      abweichung: { ...MIT_ZAHLUNG, provisioningEnabled: false },
      zeilen: [HINWEIS_ZAHLUNG_OHNE_EINKAUF],
    },
    { abweichung: { storeBackend: "json" }, zeilen: [HINWEIS_LOGIN_BRAUCHT_PG] },
    { abweichung: { ...SELBSTBEDIENUNG_LIVE }, zeilen: [] },
    {
      abweichung: { ...SELBSTBEDIENUNG_LIVE, sessionSecret: "" },
      zeilen: [HINWEIS_SELBSTBEDIENUNG],
    },
    {
      abweichung: { ...SELBSTBEDIENUNG_LIVE, storeBackend: "json" },
      zeilen: [HINWEIS_LOGIN_BRAUCHT_PG, HINWEIS_SELBSTBEDIENUNG],
    },
    { abweichung: { selfServiceEnabled: true, sessionSecret: "" }, zeilen: [] },
    { abweichung: { oauthIssuerUrl: "http://idp.example" }, zeilen: [WARNUNG_HTTP_ISSUER] },
    { abweichung: { oauthIssuerUrl: "http://localhost:8080" }, zeilen: [] },
    { abweichung: ALLE_LOKAL_OFFEN, zeilen: [WARNUNG_SIGNATUR, WARNUNG_MCP_OFFEN, WARNUNG_HTTP_ISSUER] },
  ];
  for (const { abweichung, zeilen } of faelle) {
    assert.deepEqual(
      startpruefung({ abweichung }),
      { bootet: true, zeilen },
      JSON.stringify(abweichung),
    );
  }
});

test("assertConfig: im Hosting werden lokale Warnungen zur Boot-Verweigerung statt zum Hinweis", () => {
  assert.deepEqual(startpruefung({ produktion: true, abweichung: ALLE_LOKAL_OFFEN }), {
    bootet: false,
    zeilen: [
      KOPF_FATAL,
      "  - MCP_AUTH=off - /mcp ist ohne jede Pruefung offen (im Hosting unzulaessig).",
      "  - SKIP_TWILIO_SIGNATURE_CHECK=true - /voice-Webhooks bleiben ungeprueft (im Hosting unzulaessig).",
      "  - OAUTH_ISSUER_URL ist nicht https - SSRF/MITM-Footgun (im Hosting unzulaessig).",
      FUSS_FATAL,
    ],
  });
});

test("assertConfig: im Hosting meldet ein statischer Bearer den Hinweis und bootet trotzdem", () => {
  assert.deepEqual(startpruefung({ produktion: true, abweichung: { mcpAuth: "token" } }), {
    bootet: true,
    zeilen: [
      "[Sicherheit] MCP_AUTH ist nicht 'oauth' - /mcp laeuft im Hosting mit statischem Bearer statt OAuth 2.1; Claude-/ChatGPT-Connectoren erhalten 401 (T-5). Kein Boot-Stopp (Hinweis).",
    ],
  });
});
