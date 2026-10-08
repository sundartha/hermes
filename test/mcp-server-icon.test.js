import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startServer, mcpPost, readToolResult, externalIp, BASE_ENV } from "./helpers.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ICON_PATH = path.join(ROOT, "public", "brand", "hermes-icon.png");
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const EXTERNAL_IP = externalIp();

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

const STDIO_EINSTIEG = "src/mcp-server.js";
const HTTP_OK = 200;

async function stdioServerInfo() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [STDIO_EINSTIEG],
    cwd: ROOT,
    env: { ...BASE_ENV },
    stderr: "pipe",
  });
  const client = new Client({ name: "mcp-server-icon", version: "0.0.1" });
  try {
    await client.connect(transport);
    return client.getServerVersion();
  } finally {
    await client.close();
  }
}

test("T-T3-AC2: der stdio-Server (Claude Desktop) meldet dieselbe serverInfo samt Icons wie POST /mcp", async () => {
  const srv = await startServer();
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, INITIALIZE_BODY);
    assert.equal(res.status, HTTP_OK);
    const { serverInfo } = await readToolResult(res);
    assert.deepEqual(await stdioServerInfo(), serverInfo);
  } finally {
    await srv.stop();
  }
});

const DATA_URI_PREFIX = "data:image/png;base64,";
const MAX_DATA_URI_CHARS = 64_000;

test("T-T3-AC3: echter initialize-Request ueber POST /mcp (Live-Connector-Pfad) traegt serverInfo.icons (data-URI zuerst, https-Fallback)", async () => {
  const srv = await startServer();
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, INITIALIZE_BODY);
    assert.equal(res.status, 200);
    const result = await readToolResult(res);
    const [embedded, hosted] = result.serverInfo.icons;
    assert.ok(embedded.src.startsWith(DATA_URI_PREFIX), "icons[0] ist ein PNG-data-URI");
    const decoded = Buffer.from(embedded.src.slice(DATA_URI_PREFIX.length), "base64");
    assert.ok(decoded.subarray(0, 8).equals(PNG_SIGNATURE), "data-URI decodiert zu einem validen PNG");
    assert.ok(
      embedded.src.length < MAX_DATA_URI_CHARS,
      `data-URI bleibt klein (<${MAX_DATA_URI_CHARS} Zeichen), sonst blaeht jede initialize-Antwort auf`,
    );
    assert.equal(embedded.mimeType, "image/png");
    assert.deepEqual(embedded.sizes, ["128x128"]);
    assert.equal(
      hosted.src,
      `${BASE_ENV.PUBLIC_URL}/brand/hermes-icon.png`,
      "src kommt aus config.publicUrl, kein hartkodierter Hostname",
    );
    assert.equal(hosted.mimeType, "image/png");
    assert.deepEqual(hosted.sizes, ["1024x1024"]);
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
  "T-T3-AC6b: /brand/-Assets bleiben erreichbar (Produktions-Fall: DASHBOARD_PASSWORD gesetzt, externe IP)",
  { skip: !EXTERNAL_IP && "keine externe Interface-IP" },
  async () => {
    const srv = await startServer({ env: { DASHBOARD_PASSWORD: "super-geheim-pw" } });
    try {
      const res = await fetch(`${srv.externalUrl}/brand/hermes-icon.png`);
      assert.equal(res.status, 200, "das Icon liegt oeffentlich unter public/, keine Ausnahme noetig");
      assert.equal(res.headers.get("content-type"), "image/png");
      const favicon = await fetch(`${srv.externalUrl}/favicon.ico`);
      assert.equal(favicon.status, 200, "favicon.ico muss erreichbar sein");
      const guarded = await fetch(`${srv.externalUrl}/api/state`);
      assert.equal(guarded.status, 403, "andere Routen bleiben scharf (internalOnly)");
    } finally {
      await srv.stop();
    }
  },
);
