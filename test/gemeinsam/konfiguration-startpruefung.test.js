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
