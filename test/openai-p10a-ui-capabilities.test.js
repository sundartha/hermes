// P10a (H3, P4-Abnahme): "keine capabilities in den Server-Optionen, wenn uiEnabled:false"
// ist seit P4 von KEINEM Test mehr gedeckt gewesen. Dieser Test pinnt sie wieder, auf
// BEIDEN Draehten (HTTP und stdio), die mcpServerOptions() (src/mcp-server-info.js)
// aufrufen.
//
// Fall 3 (stdio) liest die initialize-Antwort ROH ueber die Kindprozess-Pipe, NICHT
// ueber den typisierten SDK-Client: ServerCapabilitiesSchema (SDK types.js) ist ein
// z.object(...) OHNE .passthrough() und wuerde einen unbekannten Top-Level-Schluessel
// wie "extensions" beim Parsen still entfernen (UNKNOWN-2 der Spec) - ein Beleg ueber
// den typisierten Client waere entweder faelschlich rot oder gruen aus dem falschen
// Grund. Positivkontrolle nie weglassen (Lehre messwerkzeug-braucht-attrappe).
//
// Testname traegt KEIN Katalog-/ABNAHME-Praefix (package.json i18nCatalogPattern/
// abnahmePattern), sonst landet er im falschen Lauf (Lehre catalog-id-prefix-misroutes-tests).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mcpServerOptions } from "../src/mcp-server-info.js";
import { UI_CAPABILITY_KEY } from "../src/ui/contract.js";
import { startServer, seedState, mcpPost, readToolResult, ROOT, BASE_ENV } from "./helpers.js";

const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";
const RAW_STDIO_TIMEOUT_MS = 8000;
const CAPABILITIES_KEY = "capabilities";

function initializeBody(id) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "p10a-h3-client", version: "0.0.0" },
    },
  };
}

// Spricht das rohe stdio-JSON-RPC (newline-delimited, SDK shared/stdio.js) direkt mit
// einem Kindprozess - kein StdioClientTransport/Client, damit KEINE SDK-Zod-Schema die
// Server-capabilities vor der Zusicherung beschneidet.
async function rawStdioInitialize(env) {
  const child = spawn(process.execPath, [MCP_SERVER_ENTRYPOINT], {
    cwd: ROOT,
    env: { ...BASE_ENV, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderrOutput = "";
  child.stderr.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });
  let buffer = "";
  const pendingMessages = [];
  const pendingWaiters = [];
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
      buffer = buffer.slice(newlineIndex + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      const waiter = pendingWaiters.shift();
      if (waiter) waiter(message);
      else pendingMessages.push(message);
    }
  });
  function nextMessage() {
    if (pendingMessages.length > 0) return Promise.resolve(pendingMessages.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Kein stdio-JSON-RPC-Antwort innerhalb ${RAW_STDIO_TIMEOUT_MS}ms (stderr: ${stderrOutput})`));
      }, RAW_STDIO_TIMEOUT_MS);
      pendingWaiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }
  function send(message) {
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }
  try {
    send(initializeBody(1));
    const response = await nextMessage();
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    return { capabilities: response.result?.capabilities, stderrOutput: () => stderrOutput };
  } finally {
    child.kill();
  }
}

// ==================== Fall 1: Einheit ====================
test("P10a (H3, Fall 1): mcpServerOptions traegt keine capabilities, wenn uiEnabled:false - unabhaengig von consultLoop", () => {
  assert.equal(
    Object.hasOwn(mcpServerOptions({ uiEnabled: false, consultLoop: false }), CAPABILITIES_KEY),
    false,
  );
  assert.equal(
    Object.hasOwn(mcpServerOptions({ uiEnabled: false, consultLoop: true }), CAPABILITIES_KEY),
    false,
  );
  // Positivkontrolle: bei uiEnabled:true IST die Extension da - sonst waere der Helfer
  // oben unbemerkt immer gruen.
  const withUi = mcpServerOptions({ uiEnabled: true, consultLoop: false });
  assert.ok(
    withUi.capabilities?.extensions?.[UI_CAPABILITY_KEY],
    "uiEnabled:true traegt die io.modelcontextprotocol/ui-Extension",
  );
});

// ==================== Fall 2: HTTP-Draht ====================
test("P10a (H3, Fall 2 - HTTP): /mcp initialize traegt keine io.modelcontextprotocol/ui-Extension, wenn MCP_UI_ENABLED=false", async () => {
  const srv = await startServer({ seed: seedState({}) }); // BASE_ENV: MCP_UI_ENABLED=false
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, initializeBody(1));
    const result = await readToolResult(res);
    assert.equal(
      result.capabilities?.extensions?.[UI_CAPABILITY_KEY],
      undefined,
      "keine UI-Extension bei MCP_UI_ENABLED=false",
    );
  } finally {
    await srv.stop();
  }
});

test("P10a (H3, Fall 2 - HTTP, Positivkontrolle): /mcp initialize traegt die Extension bei MCP_UI_ENABLED=true", async () => {
  const srv = await startServer({ seed: seedState({}), env: { MCP_UI_ENABLED: "true" } });
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, initializeBody(1));
    const result = await readToolResult(res);
    assert.ok(
      result.capabilities?.extensions?.[UI_CAPABILITY_KEY],
      "MCP_UI_ENABLED=true traegt die io.modelcontextprotocol/ui-Extension",
    );
  } finally {
    await srv.stop();
  }
});

// ==================== Fall 3: stdio-Draht ====================
test("P10a (H3, Fall 3 - stdio): der Kindprozess (src/mcp-server.js) traegt keine io.modelcontextprotocol/ui-Extension, wenn MCP_UI_ENABLED=false", async () => {
  const { capabilities, stderrOutput } = await rawStdioInitialize({});
  assert.equal(
    capabilities?.extensions?.[UI_CAPABILITY_KEY],
    undefined,
    `keine UI-Extension bei MCP_UI_ENABLED=false (stderr: ${stderrOutput()})`,
  );
});

test("P10a (H3, Fall 3 - stdio, Positivkontrolle): der Kindprozess traegt die Extension bei MCP_UI_ENABLED=true", async () => {
  const { capabilities, stderrOutput } = await rawStdioInitialize({ MCP_UI_ENABLED: "true" });
  assert.ok(
    capabilities?.extensions?.[UI_CAPABILITY_KEY],
    `MCP_UI_ENABLED=true traegt die io.modelcontextprotocol/ui-Extension (stderr: ${stderrOutput()})`,
  );
});

// ==================== Fall 4 (optional, billig): consultLoop schaltet die Capabilities nicht ein ====================
test("P10a (H3, Fall 4): CONSULT_ENABLED+ASSISTANT_CONTEXT_ENABLED schalten die UI-Extension NICHT ein", async () => {
  const srv = await startServer({
    seed: seedState({}),
    env: { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" },
  });
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, initializeBody(1));
    const result = await readToolResult(res);
    assert.equal(
      result.capabilities?.extensions?.[UI_CAPABILITY_KEY],
      undefined,
      "consultLoop schaltet capabilities.extensions nicht ein - nur der UI-Master-Schalter tut das",
    );
  } finally {
    await srv.stop();
  }
});
