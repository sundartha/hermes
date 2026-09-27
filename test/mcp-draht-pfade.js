// Gemeinsamer Draht-Harness: liefert den ECHTEN tools/list-Output und die initialize-
// instructions ueber jeden Pfad, auf dem ein Host Hermes erreicht - HTTP /mcp im Legacy-
// und im OAuth-Modus (mit und ohne Consult, ohne verknuepften Mandanten) sowie stdio (mit
// und ohne Consult-Env). registerTool() des MCP-SDK verwirft unbekannte Felder still - ein
// Test am Registrierungsobjekt beweist nichts, deshalb misst dieser Harness nur am Draht.
// Optional ({ ressourcen: true }) liefert jeder Snapshot zusaetzlich resources/list, die
// per resources/read lesbaren URIs und deren Inhalt (inhalte: uri -> text); zusatzUris liest
// daneben URIs, die resources/list nicht nennt (aeltere Widget-Fassungen). tokenSnapshot misst den Token-Modus samt Auth-Belegen
// (localhost und Interface-IP). Beides nutzt der Kompatibilitaetsvertrag (test/mcp-kompatibilitaetsvertrag.test.js).
// Kein Testfall hier (Datei ohne .test.js-Endung): der Runner laedt sie nur als Import.
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
// z.any() reicht jedes Feld unveraendert durch (title/annotations/_meta bleiben erhalten).
const RAW_TOOLS_RESULT = z.object({ tools: z.array(z.any()) });
const RAW_RESOURCES_RESULT = z.object({ resources: z.array(z.any()) });
const RAW_READ_RESULT = z.object({ contents: z.array(z.any()) });
// JSON-RPC "Method not found": ein Server ohne registrierte Resources (MCP_UI_ENABLED aus)
// kennt resources/list nicht - das ist eine leere Resource-Liste, kein Messfehler.
const METHOD_NOT_FOUND = -32601;
// Fixture fuer den Token-Modus - bewusst NICHT im Format eines echten Secrets.
const TOKEN_FIXTURE = "t2-18-vertrag-probe";
// Bootstrap-Tenant fuer OAuth (wie test/openai-t2-11-werkzeugtexte.test.js); der zweite
// sub bleibt ungeseeded -> kein Mandant -> Stub-Fassade (src/mcp-no-tenant.js).
// OAUTH_SUBJECT exportiert: test/openai-t2-17-instructions-kern.test.js misst damit
// zusaetzliche OAuth-Pfade (MCP_UI_ENABLED=true), ohne den Snapshot-Code zu kopieren.
export const OAUTH_SUBJECT = "sub-mcp-draht-pfade";
// NO_TENANT_SUBJECT exportiert: der Kompatibilitaetsvertrag misst den Pfad ohne Mandant
// zusaetzlich mit Ressourcen.
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

// Frisch je Aufruf: die Listen gehen an den Aufrufer, keine geteilte Instanz.
const ohneRessourcen = () => ({ resources: [], lesbar: [], inhalte: {} });

// Gemeinsame Sammel-Logik beider Transporte: resources ist die Antwort von resources/list,
// lese(uri) liefert das contents-Array von resources/read (undefined bei einem
// JSON-RPC-Fehler). Gelesen werden die gelisteten URIs und zusatzUris. Lesbar ist eine URI
// genau dann, wenn contents nicht leer ist - auf HTTP und stdio nach derselben Regel;
// inhalte haelt den Text des ersten Content-Eintrags je lesbarer URI.
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

// Liste der Resources plus die URIs, deren resources/read Inhalt liefert.
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

// T2-17: exportiert (statt modul-intern), damit ein zweiter Test (openai-t2-17-...)
// zusaetzliche Pfade (z.B. MCP_UI_ENABLED=true) messen kann, ohne den Snapshot-Code zu
// kopieren. MCP_WIRE_PATHS unten bleibt bei den bisherigen sieben Pfaden.
// optionen.ressourcen/zusatzUris: zusaetzlich resources/list + lesbare URIs, s. Kopfkommentar.
export async function legacySnapshot(env, optionen = {}) {
  const srv = await startServer({ seed: seedState({}), env });
  try {
    return await httpSnapshot(`${srv.localUrl}/mcp`, null, optionen);
  } finally {
    await srv.stop();
  }
}

// Status einer tools/list-Anfrage (Body verworfen) - fuer die Auth-Belege im Token-Modus.
async function toolsListStatus(url, token) {
  const res = await mcpPost(url, token, TOOLS_LIST_BODY);
  await res.text();
  return res.status;
}

// Token-Modus (MCP_AUTH=token). Die Werkzeugliste gibt es NUR ueber localhost: der
// statische Token traegt keine Identitaet, ein identitaetsloser Request bekommt den
// Betreiber-Mandanten nur als lokaler Aufrufer (operatorChannelTenant, src/routes/_tenant.js),
// ueber die Interface-IP antwortet der Server mit Token 403 (kein Mandant). Gemessen wird
// deshalb ueber localhost MIT Token; dass der Auth-Pfad dort trotzdem greift, belegt
// ohneTokenStatus (401 ohne Token an derselben URL). interfaceIp haelt die Stati ueber die
// Interface-IP fest (null, wenn die Maschine keine hat - der Aufrufer muss das melden).
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

// T2-17: exportiert, s. Kommentar bei legacySnapshot oben. ressourcen/zusatzUris: wie legacySnapshot.
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

// Wie httpRessourcen: ein JSON-RPC-Fehler bei resources/read (McpError mit numerischem
// code) heisst "nicht lesbar", wie auf HTTP; jeder andere Fehler (Transport) wirft.
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

// T2-17: exportiert, s. Kommentar bei legacySnapshot oben. optionen: wie legacySnapshot.
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

// Sieben Pfade: jeder liefert { tools, instructions } vom echten Draht. Bleibt bewusst bei
// diesen sieben (die Texttests zaehlen darauf); der Kompatibilitaetsvertrag fuehrt eigene
// Profile (zusaetzlich MCP_UI_ENABLED=true und den Token-Modus).
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
