import { test } from "node:test";
import assert from "node:assert/strict";
import * as konfig from "../../src/config.js";
import { PASSWORT_BEISPIEL } from "./erfundene-geheimnisse.js";

const ISSUER_FAELLE = [
  ["http://evil.example", true],
  ["http://127.0.0.1:8080", false],
  ["http://localhost", false],
  ["http://localhost/pfad", false],
  ["http://[::1]:3000", false],
  ["http://localhost.evil.example", true],
  ["https://issuer.example", false],
  ["", false],
];

function konfigMitIssuer(oauthIssuerUrl) {
  return {
    server: { publicUrl: "https://agent.test", publicUrlExplicit: true },
    store: { storeBackend: "pg" },
    safety: { skipTwilioSignatureCheck: false },
    auth: {
      dashboardPassword: PASSWORT_BEISPIEL,
      mcpAuth: "oauth",
      oauthIssuerUrl,
      oauthAudience: "",
    },
  };
}

test("Exportflaeche des Eingangs: Pruefhilfe fuer den Issuer ist nicht oeffentlich", () => {
  assert.equal("isInsecureHttpIssuer" in konfig, false);
});

test("productionFootguns: Issuer mit http ausserhalb von Loopback ist im Hosting ein Befund", () => {
  const vorher = process.env.DEV_LOGIN_ENABLED;
  try {
    delete process.env.DEV_LOGIN_ENABLED;
    for (const [url, erwartet] of ISSUER_FAELLE) {
      const befunde = konfig.productionFootguns(konfigMitIssuer(url), true);
      assert.equal(
        befunde.some((b) => b.startsWith("OAUTH_ISSUER_URL ist nicht https")),
        erwartet,
        url,
      );
    }
  } finally {
    if (vorher === undefined) delete process.env.DEV_LOGIN_ENABLED;
    else process.env.DEV_LOGIN_ENABLED = vorher;
  }
});
