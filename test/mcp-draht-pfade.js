// Gemeinsamer Draht-Harness: liefert den ECHTEN tools/list-Output und die initialize-
// instructions ueber jeden Pfad, auf dem ein Host Hermes erreicht - HTTP /mcp im Legacy-
// und im OAuth-Modus (mit und ohne Consult, ohne verknuepften Mandanten) sowie stdio (mit
// und ohne Consult-Env). registerTool() des MCP-SDK verwirft unbekannte Felder still - ein
// Test am Registrierungsobjekt beweist nichts, deshalb misst dieser Harness nur am Draht.
// Kein Testfall hier (Datei ohne .test.js-Endung): der Runner laedt sie nur als Import.
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startServer, startIdp, seedState, mcpPost, readToolResult, ROOT, BASE_ENV } from "./helpers.js";

const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";
export const CONSULT_ON = Object.freeze({ CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" });
const TOOLS_LIST_BODY = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const INITIALIZE_ID = 2;
const PROTOCOL_VERSION = "2025-06-18";
// z.any() reicht jedes Feld unveraendert durch (title/annotations/_meta bleiben erhalten).
const RAW_TOOLS_RESULT = z.object({ tools: z.array(z.any()) });
// Bootstrap-Tenant fuer OAuth (wie test/openai-t2-11-werkzeugtexte.test.js); der zweite
// sub bleibt ungeseeded -> kein Mandant -> Stub-Fassade (src/mcp-no-tenant.js).
// OAUTH_SUBJECT exportiert: test/openai-t2-17-instructions-kern.test.js misst damit
// zusaetzliche OAuth-Pfade (MCP_UI_ENABLED=true), ohne den Snapshot-Code zu kopieren.
export const OAUTH_SUBJECT = "sub-mcp-draht-pfade";
const NO_TENANT_SUBJECT = "sub-mcp-draht-pfade-ohne-mandant";

async function httpToolsList(url, token) {
  return (await readToolResult(await mcpPost(url, token, TOOLS_LIST_BODY))).tools;
}

async function httpInstructions(url, token) {
  const res = await mcpPost(url, token, {
    jsonrpc: "2.0",
    id: INITIALIZE_ID,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "mcp-draht-pfade", version: "0.0.0" },
    },
  });
  return (await readToolResult(res)).instructions;
}

async function httpSnapshot(url, token) {
  return { tools: await httpToolsList(url, token), instructions: await httpInstructions(url, token) };
}

// T2-17: exportiert (statt modul-intern), damit ein zweiter Test (openai-t2-17-...)
// zusaetzliche Pfade (z.B. MCP_UI_ENABLED=true) messen kann, ohne den Snapshot-Code zu
// kopieren. MCP_WIRE_PATHS unten bleibt bei den bisherigen sieben Pfaden.
export async function legacySnapshot(env) {
  const srv = await startServer({ seed: seedState({}), env });
  try {
    return await httpSnapshot(`${srv.localUrl}/mcp`, null);
  } finally {
    await srv.stop();
  }
}

// T2-17: exportiert, s. Kommentar bei legacySnapshot oben.
export async function oauthSnapshot({ subject, env = {} }) {
  const idp = await startIdp();
  const srv = await startServer({
    seed: seedState({}),
    env: {
      MCP_AUTH: "oauth",
      OAUTH_ISSUER_URL: idp.issuer,
      MULTI_TENANT: "true",
      OWNER_IDP_SUBJECT: OAUTH_SUBJECT,
      ...env,
    },
  });
  try {
    const token = await idp.sign({ sub: subject });
    return await httpSnapshot(`${srv.localUrl}/mcp`, token);
  } finally {
    await srv.stop();
    await idp.close();
  }
}

// T2-17: exportiert, s. Kommentar bei legacySnapshot oben.
export async function stdioSnapshot(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER_ENTRYPOINT],
    cwd: ROOT,
    env: { ...BASE_ENV, ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "mcp-draht-pfade-stdio", version: "0.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.request({ method: "tools/list" }, RAW_TOOLS_RESULT);
    return { tools, instructions: client.getInstructions() };
  } finally {
    await client.close();
  }
}

// Sieben Pfade: jeder liefert { tools, instructions } vom echten Draht.
export const MCP_WIRE_PATHS = Object.freeze([
  { label: "HTTP Legacy, ohne Consult", snapshot: () => legacySnapshot({}) },
  { label: "HTTP Legacy, mit Consult", snapshot: () => legacySnapshot(CONSULT_ON) },
  { label: "HTTP OAuth, ohne Consult", snapshot: () => oauthSnapshot({ subject: OAUTH_SUBJECT }) },
  {
    label: "HTTP OAuth, mit Consult",
    snapshot: () => oauthSnapshot({ subject: OAUTH_SUBJECT, env: CONSULT_ON }),
  },
  { label: "HTTP OAuth, ohne Mandant", snapshot: () => oauthSnapshot({ subject: NO_TENANT_SUBJECT }) },
  { label: "stdio, ohne Consult-Env", snapshot: () => stdioSnapshot({}) },
  { label: "stdio, mit Consult-Env", snapshot: () => stdioSnapshot(CONSULT_ON) },
]);
