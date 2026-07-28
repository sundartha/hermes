// T3: MCP-Server-Icon (Hermes-Wing im initialize-Handshake). Echter Request gegen
// den HTTP-/mcp-Endpunkt (Muster: startServer+mcpPost+readToolResult wie in
// test/am6-oauth-tenant.test.js) - das ist der LIVE-Connector-Pfad (claude.ai/
// ChatGPT), nicht nur der stdio-Pfad (Claude Desktop). Zusaetzlich die statische
// Auslieferung des Icon-Assets (Muster: test/headers.test.js) UND deren
// Basic-Auth-Ausnahme (Muster: test/audit.test.js externalUrl-Skip) - ohne diese
// Ausnahme waere das Icon in Produktion (DASHBOARD_PASSWORD gesetzt) fuer jeden
// MCP-Host unerreichbar und der T3-Fix live wirkungslos.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, mcpPost, readToolResult, externalIp, BASE_ENV } from "./helpers.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICON_PATH = path.join(ROOT, "public", "brand", "hermes-icon.png");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXTERNAL_IP = externalIp();

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

// Obergrenze fuer das eingebettete Icon: haelt die initialize-Antwort klein
// (Ziel ~23KB base64; 64KB laesst Luft fuer ein kuenftig groesseres Bild, ohne
// dass die Antwort unbemerkt auf Megabyte anwaechst).
const DATA_URI_PREFIX = "data:image/png;base64,";
const MAX_DATA_URI_CHARS = 64_000;

test("T-T3-AC3: echter initialize-Request ueber POST /mcp (Live-Connector-Pfad) traegt serverInfo.icons (data-URI zuerst, https-Fallback)", async () => {
  const srv = await startServer();
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, INITIALIZE_BODY);
    assert.equal(res.status, 200);
    const result = await readToolResult(res);
    const [embedded, hosted] = result.serverInfo.icons;
    // icons[0]: origin-unabhaengiger data-URI (Cross-Origin-Icons verwirft der
    // Host - Befund 2026-07-02, Connector-Origin app.sundartha.com vs PUBLIC_URL).
    assert.ok(embedded.src.startsWith(DATA_URI_PREFIX), "icons[0] ist ein PNG-data-URI");
    const decoded = Buffer.from(embedded.src.slice(DATA_URI_PREFIX.length), "base64");
    assert.ok(decoded.subarray(0, 8).equals(PNG_SIGNATURE), "data-URI decodiert zu einem validen PNG");
    assert.ok(
      embedded.src.length < MAX_DATA_URI_CHARS,
      `data-URI bleibt klein (<${MAX_DATA_URI_CHARS} Zeichen), sonst blaeht jede initialize-Antwort auf`,
    );
    assert.equal(embedded.mimeType, "image/png");
    assert.deepEqual(embedded.sizes, ["128x128"]);
    // icons[1]: adressierbare https-Variante fuer Hosts, die grosse Icons laden.
    assert.equal(
      hosted.src,
      `${BASE_ENV.PUBLIC_URL}/brand/hermes-icon.png`,
      "src kommt aus config.publicUrl, kein hartkodierter Hostname",
    );
    assert.equal(hosted.mimeType, "image/png");
    assert.deepEqual(hosted.sizes, ["1024x1024"]);
    // websiteUrl: Marken-Homepage fuer Hosts, die ihr Connector-Branding von
    // der Website-Domain ableiten (dort liegt zusaetzlich ein favicon.ico).
    // www-Variante ist Absicht (sauberer Favicon-Cache-Schluessel bei Google);
    // claude.ai wertet websiteUrl fuer sein Icon aber NICHT aus - Begruendung
    // und Beleg stehen in mcp-server-info.js.
    assert.equal(result.serverInfo.websiteUrl, "https://www.sundartha.com");
  } finally {
    await srv.stop();
  }
});

test("T-T3-AC6a: GET /brand/hermes-icon.png liefert 200 + image/png", async () => {
  const srv = await startServer();
  try {
    const res = await fetch(`${srv.localUrl}/brand/hermes-icon.png`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "image/png");
  } finally {
    await srv.stop();
  }
});

test(
  "T-T3-AC6b: /brand/-Assets bleiben OHNE Basic-Auth erreichbar (Produktions-Fall: DASHBOARD_PASSWORD gesetzt, externe IP)",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async () => {
    const srv = await startServer({ env: { DASHBOARD_PASSWORD: "super-geheim-pw" } });
    try {
      const res = await fetch(`${srv.externalUrl}/brand/hermes-icon.png`);
      assert.equal(res.status, 200, "Basic-Auth darf das Icon nicht sperren, sonst laedt kein Host es");
      assert.equal(res.headers.get("content-type"), "image/png");
      // Favicon-Konvention: Icon-Fetcher (Browser, Connector-UIs) ziehen
      // /favicon.ico ohne Credentials von der Wurzel - vor der Ausnahme
      // antwortete Produktion 401 (empirisch 2026-07-02, Wuerfel in claude.ai).
      const favicon = await fetch(`${srv.externalUrl}/favicon.ico`);
      assert.equal(favicon.status, 200, "favicon.ico muss ohne Basic-Auth erreichbar sein");
      // Gegenprobe: die Ausnahme ist eng - eine andere Route bleibt weiter gesperrt.
      const guarded = await fetch(`${srv.externalUrl}/api/state`);
      assert.equal(guarded.status, 401, "Basic-Auth bleibt fuer andere Routen scharf");
    } finally {
      await srv.stop();
    }
  },
);
