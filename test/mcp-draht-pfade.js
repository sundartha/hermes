import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  startServer,
  startIdp,
  seedState,
  mcpPost,
  readToolResult,
  readRpcMessage,
  ROOT,
  BASE_ENV,
} from "./helpers.js";

const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";
export const CONSULT_ON = Object.freeze({ CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" });
const TOOLS_LIST_BODY = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const INITIALIZE_ID = 2;
const PROTOCOL_VERSION = "2025-06-18";
const RAW_TOOLS_RESULT = z.object({ tools: z.array(z.any()) });
const RAW_RESOURCES_RESULT = z.object({ resources: z.array(z.any()) });
const RAW_READ_RESULT = z.object({ contents: z.array(z.any()) });
const METHOD_NOT_FOUND = -32601;
const TOKEN_FIXTURE = "t2-18-vertrag-probe";
export const OAUTH_SUBJECT = "sub-mcp-draht-pfade";
export const NO_TENANT_SUBJECT = "sub-mcp-draht-pfade-ohne-mandant";

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

async function httpRpc(url, token, body) {
  return readRpcMessage(await mcpPost(url, token, { jsonrpc: "2.0", id: 1, ...body }));
}

const ohneRessourcen = () => ({ resources: [], lesbar: [], inhalte: {} });

async function sammleRessourcen(resources, lese, zusatzUris) {
  const lesbar = [];
  const inhalte = {};
  const uris = [...new Set([...resources.map((eintrag) => eintrag.uri), ...zusatzUris])];
  for (const uri of uris) {
    const contents = await lese(uri);
    if (contents?.length > 0) {
      lesbar.push(uri);
      inhalte[uri] = contents[0].text;
    }
  }
  return { resources, lesbar, inhalte };
}

async function httpRessourcen(url, token, zusatzUris) {
  const liste = await httpRpc(url, token, { method: "resources/list" });
  if (liste.error?.code === METHOD_NOT_FOUND) return ohneRessourcen();
  if (!liste.result) throw new Error(`resources/list fehlgeschlagen: ${JSON.stringify(liste.error)}`);
  const lese = async (uri) => (await httpRpc(url, token, { method: "resources/read", params: { uri } })).result?.contents;
  return sammleRessourcen(liste.result.resources, lese, zusatzUris);
}

async function httpSnapshot(url, token, { ressourcen = false, zusatzUris = [] } = {}) {
  const snapshot = { tools: await httpToolsList(url, token), instructions: await httpInstructions(url, token) };
  return ressourcen ? { ...snapshot, ...(await httpRessourcen(url, token, zusatzUris)) } : snapshot;
}

export async function legacySnapshot(env, optionen = {}) {
  const srv = await startServer({ seed: seedState({}), env });
  try {
    return await httpSnapshot(`${srv.localUrl}/mcp`, null, optionen);
  } finally {
    await srv.stop();
  }
}

async function toolsListStatus(url, token) {
  const res = await mcpPost(url, token, TOOLS_LIST_BODY);
  await res.text();
  return res.status;
}

export async function tokenSnapshot(env = {}, optionen = {}) {
  const srv = await startServer({
    seed: seedState({}),
    env: { MCP_AUTH: "token", MCP_AUTH_TOKEN: TOKEN_FIXTURE, ...env },
  });
  try {
    const lokal = `${srv.localUrl}/mcp`;
    const extern = srv.externalUrl ? `${srv.externalUrl}/mcp` : null;
    const interfaceIp = extern
      ? { ohneToken: await toolsListStatus(extern, null), mitToken: await toolsListStatus(extern, TOKEN_FIXTURE) }
      : null;
    const ohneTokenStatus = await toolsListStatus(lokal, null);
    return { ...(await httpSnapshot(lokal, TOKEN_FIXTURE, optionen)), ohneTokenStatus, interfaceIp };
  } finally {
    await srv.stop();
  }
}

export async function oauthSnapshot({ subject, env = {}, ressourcen = false, zusatzUris = [] }) {
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
    return await httpSnapshot(`${srv.localUrl}/mcp`, token, { ressourcen, zusatzUris });
  } finally {
    await srv.stop();
    await idp.close();
  }
}

async function stdioLese(client, uri) {
  try {
    return (await client.request({ method: "resources/read", params: { uri } }, RAW_READ_RESULT)).contents;
  } catch (err) {
    if (typeof err.code === "number") return undefined;
    throw err;
  }
}

async function stdioRessourcen(client, zusatzUris) {
  let liste;
  try {
    liste = await client.request({ method: "resources/list" }, RAW_RESOURCES_RESULT);
  } catch (err) {
    if (err.code === METHOD_NOT_FOUND) return ohneRessourcen();
    throw err;
  }
  return sammleRessourcen(liste.resources, (uri) => stdioLese(client, uri), zusatzUris);
}

export async function stdioSnapshot(env, { ressourcen = false, zusatzUris = [] } = {}) {
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
    const snapshot = { tools, instructions: client.getInstructions() };
    return ressourcen ? { ...snapshot, ...(await stdioRessourcen(client, zusatzUris)) } : snapshot;
  } finally {
    await client.close();
  }
}

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
