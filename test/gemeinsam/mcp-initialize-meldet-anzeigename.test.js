import { test } from "node:test";
import assert from "node:assert/strict";
import { startServer, mcpPost, readToolResult } from "../helpers.js";

const HTTP_OK = 200;
const ANZEIGENAME = "Hermes";
const PROGRAMMNAME = "hermes";
const GEMELDETE_VERSION = "0.2.0";

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

async function initializeServerInfo() {
  const srv = await startServer();
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, INITIALIZE_BODY);
    assert.equal(res.status, HTTP_OK);
    return (await readToolResult(res)).serverInfo;
  } finally {
    await srv.stop();
  }
}

test("initialize über POST /mcp meldet den Anzeigenamen Hermes und lässt Programmname und Version unverändert", async () => {
  const serverInfo = await initializeServerInfo();
  assert.equal(
    serverInfo.title,
    ANZEIGENAME,
    "serverInfo.title ist nicht der Anzeigename Hermes",
  );
  assert.equal(serverInfo.name, PROGRAMMNAME);
  assert.equal(serverInfo.version, GEMELDETE_VERSION);
});
