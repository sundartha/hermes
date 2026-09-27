// T2-03 (T-5): productionAuthHints() ist in assertConfig() verdrahtet und muss am
// echten Boot-Log auftauchen (Kindprozess), nicht nur als reine Funktion (siehe
// openai-t2-03-auth-hints.test.js). Exit-Code wird bewusst NICHT geprueft: er ist 1
// wegen des bestehenden Footguns STORE_BACKEND != pg (nicht Teil dieser Phase) -
// dieselbe Lage wie in boot-prod-footguns.test.js. Praefix "T2-03" haelt die Tests
// aus dem Gates-Lauf heraus.
import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startServerExpectExit } from "./helpers.js";

const HINT_PATTERN = /\[Sicherheit\] MCP_AUTH ist nicht 'oauth'/;
const MARKER = "T203-BOOT-MARKER-xyz";
const HTTP_OK = 200;

// RENDER_EXTERNAL_URL und MCP_AUTH in jedem Fall EXPLIZIT gesetzt (BASE_ENV
// setzt beide nur neutral leer) - sonst driftet der Test aus der Umgebung.
test("T2-03-B1: Hosting + MCP_AUTH=token -> Boot-Log enthaelt den Hinweis, nicht den Token-Wert", async () => {
  const { output } = await startServerExpectExit({
    env: {
      RENDER_EXTERNAL_URL: "https://agent.onrender.com",
      MCP_AUTH: "token",
      MCP_AUTH_TOKEN: MARKER,
    },
  });
  assert.match(output, HINT_PATTERN, `erwartet Hinweiszeile im Output:\n${output}`);
  assert.doesNotMatch(output, new RegExp(MARKER), "Token-Wert darf nie im Log stehen");
});

test("T2-03-B2: Hosting + MCP_AUTH=oauth -> Boot-Log enthaelt den Hinweis NICHT (Positiv-Kontrolle)", async () => {
  const { output } = await startServerExpectExit({
    env: {
      RENDER_EXTERNAL_URL: "https://agent.onrender.com",
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: "https://idp.test",
    },
  });
  assert.doesNotMatch(output, HINT_PATTERN, `Hinweis darf bei oauth NICHT erscheinen, Output:\n${output}`);
});

// Kein zweiter Produktionsbegriff: NODE_ENV=production ALLEIN (ohne RENDER_EXTERNAL_URL)
// darf keine Zeile ausloesen und den Boot nicht stoeren - detectProduction() bleibt an
// RENDER_EXTERNAL_URL gebunden. NODE_ENV=production hat hier keinen anderen bekannten
// Nebeneffekt im Boot-Pfad (kein zweiter grep-Treffer auf process.env.NODE_ENV im Code
// ausser der Testmodus-Weiche ganz oben in config.js, die hier nicht greift, weil der
// Wert nicht "test" ist).
test("T2-03-B3: Kein Produktionsbegriff ausserhalb RENDER_EXTERNAL_URL -> bootet, /healthz 200, keine Zeile", async () => {
  const srv = await startServer({
    env: { RENDER_EXTERNAL_URL: "", NODE_ENV: "production", MCP_AUTH: "token", MCP_AUTH_TOKEN: "t" },
  });
  try {
    const res = await fetch(`${srv.localUrl}/healthz`);
    assert.equal(res.status, HTTP_OK, "kein zweiter Produktionsbegriff darf den Boot stoeren");
    assert.doesNotMatch(srv.stdout, HINT_PATTERN, `Output:\n${srv.stdout}`);
  } finally {
    await srv.stop();
  }
});
