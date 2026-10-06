import { test } from "node:test";
import assert from "node:assert/strict";
import { productionAuthHints, productionFootguns } from "../src/config.js";

const SAFE_PROD = {
  auth: { dashboardPassword: "geheim", mcpAuth: "", oauthIssuerUrl: "", oauthAudience: "" },
  safety: { skipTwilioSignatureCheck: false },
  store: { storeBackend: "pg" },
  server: { publicUrl: "https://agent.test", publicUrlExplicit: true },
};

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
