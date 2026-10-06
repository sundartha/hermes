import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, startServerExpectExit } from "./helpers.js";

const HINT_PATTERN = /\[Sicherheit\] MCP_AUTH ist nicht 'oauth'/;
const MARKER = "T203-BOOT-MARKER-xyz";
const HTTP_OK = 200;

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
