// T3: MCP-Server-Icon (Hermes-Wing im initialize-Handshake). Echter Request gegen
// den HTTP-/mcp-Endpunkt (Muster: startServer+mcpPost+readToolResult wie in
// test/am6-oauth-tenant.test.js) - das ist der LIVE-Connector-Pfad (claude.ai/
// ChatGPT), nicht nur der stdio-Pfad (Claude Desktop). Zusaetzlich die statische
// Auslieferung des Icon-Assets (Muster: test/headers.test.js) ueber die bestehende
// public/-Static-Middleware (keine neue Route, kein Basic-Auth-Gate im Diff).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, mcpPost, readToolResult, BASE_ENV } from "./helpers.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICON_PATH = path.join(ROOT, "public", "brand", "hermes-icon.png");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Vollstaendiger initialize-Body: die SDK-Schema-Pruefung verlangt protocolVersion/
// capabilities/clientInfo - ein Body ohne params wird mit einem JSON-RPC-Fehler
// abgelehnt (empirisch verifiziert).
const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.1" },
  },
};

test("T-T3-AC1: public/brand/hermes-icon.png existiert und ist ein valides PNG", () => {
  const bytes = fs.readFileSync(ICON_PATH);
  assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE), "PNG-Signatur-Bytes fehlen/falsch");
});

test("T-T3-AC2: src/mcp-server.js (stdio/Claude-Desktop) verdrahtet HERMES_SERVER_INFO, kein eigenes Literal mehr", () => {
  const src = fs.readFileSync(path.join(ROOT, "src", "mcp-server.js"), "utf8");
  assert.match(src, /new McpServer\(HERMES_SERVER_INFO, serverOptions\)/, "nutzt die geteilte Konstante");
  assert.doesNotMatch(src, /name:\s*"hermes"/, "kein dupliziertes {name,version}-Literal mehr (G5/S2)");
});

test("T-T3-AC3: echter initialize-Request ueber POST /mcp (Live-Connector-Pfad) traegt serverInfo.icons", async () => {
  const srv = await startServer();
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, INITIALIZE_BODY);
    assert.equal(res.status, 200);
    const result = await readToolResult(res);
    assert.equal(
      result.serverInfo.icons[0].src,
      `${BASE_ENV.PUBLIC_URL}/brand/hermes-icon.png`,
      "src kommt aus config.publicUrl, kein hartkodierter Hostname",
    );
    assert.equal(result.serverInfo.icons[0].mimeType, "image/png");
    assert.deepEqual(result.serverInfo.icons[0].sizes, ["1024x1024"]);
  } finally {
    await srv.stop();
  }
});

test("T-T3-AC6: GET /brand/hermes-icon.png liefert 200 + image/png (bestehende public/-Static-Middleware, keine neue Route)", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/brand/hermes-icon.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
  } finally {
    await srv.stop();
  }
});
