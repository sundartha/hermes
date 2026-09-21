// P10a (H7 + H8): haelt docs/OPENAI-TOOL-INVENTORY.md gegen den echten Draht. Die Doku
// behauptet eine Werkzeugmenge/-annotation je Konfiguration (K1-K6) und eine Begruendung je
// Annotation (Tabelle A) - dieser Test liest beide Tabellen aus der Doku (maschinenlesbare
// Bloecke) und misst sie GEGEN tools/list ueber HTTP (legacy + OAuth) und stdio.
//
// Nie das registerTool-Konfigobjekt pruefen: registerTool() des MCP-SDK verwirft unbekannte
// Felder still, ein Test auf das Registrierungsobjekt beweist nichts (Lehre der Phase). Alle
// Zusicherungen lesen deshalb den echten tools/list-Output.
//
// Testnamen tragen KEIN Katalog-/ABNAHME-Praefix (package.json i18nCatalogPattern/
// abnahmePattern), sonst landet dieser Test im falschen Lauf.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { planProfileFor } from "../src/plans.js";
import { startServer, startIdp, seedState, mcpPost, readToolResult, ROOT, BASE_ENV } from "./helpers.js";

const DOC_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
  "OPENAI-TOOL-INVENTORY.md",
);
const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";
const TOOLS_LIST_BODY = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const EXPECTED_TABLE_A_ROWS = 12;
// Permissives Ergebnis-Schema fuer den stdio-Fall ueber den typisierten SDK-Client - Namen
// sind ein Standardfeld (ueberlebt die SDK-Zod-Schemas unveraendert), nur annotations/_meta
// koennten gestrippt werden (hier ungenutzt, K6 prueft nur Namen).
const RAW_TOOLS_LIST_RESULT = z.object({ tools: z.array(z.any()) });

function readDoc() {
  return fs.readFileSync(DOC_PATH, "utf8");
}

function parseBlock(doc, beginMarker, endMarker) {
  const begin = doc.indexOf(beginMarker);
  const end = doc.indexOf(endMarker);
  assert.ok(begin !== -1 && end !== -1 && end > begin, `Block ${beginMarker}..${endMarker} fehlt`);
  const body = doc.slice(begin + beginMarker.length, end);
  const rawLines = body.split("\n");
  const trimmedLines = rawLines.map((line) => line.trim());
  return trimmedLines.filter((line) => line.length > 0);
}

function parseTableA(doc) {
  const lines = parseBlock(doc, "TABLE-A-BEGIN", "TABLE-A-END");
  return lines.map((line) => {
    const [name, condition, readOnlyHint, destructiveHint, openWorldHint, idempotentHint] =
      line.split("|");
    return { name, condition, readOnlyHint, destructiveHint, openWorldHint, idempotentHint };
  });
}

function parseTableB(doc) {
  const lines = parseBlock(doc, "TABLE-B-BEGIN", "TABLE-B-END");
  const rows = new Map();
  for (const line of lines) {
    const [k, transport, count, names] = line.split("|");
    rows.set(k, { transport, count: Number(count), names: names.split(",") });
  }
  return rows;
}

// tools/list ueber HTTP, ROH gelesen (readToolResult parst nur JSON.parse(...).result,
// keine SDK-Zod-Schemas - annotations/Namen kommen unveraendert durch).
async function httpToolsList(baseUrl, token) {
  const res = await mcpPost(baseUrl, token, TOOLS_LIST_BODY);
  const result = await readToolResult(res);
  return result.tools;
}

async function stdioToolNames(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER_ENTRYPOINT],
    cwd: ROOT,
    env: { ...BASE_ENV, ...env },
    stderr: "pipe",
  });
  let stderrOutput = "";
  transport.stderr?.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });
  const client = new Client({ name: "p10a-h7-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    const result = await client.request({ method: "tools/list" }, RAW_TOOLS_LIST_RESULT);
    return { names: result.tools.map((tool) => tool.name), stderrOutput: () => stderrOutput };
  } finally {
    await client.close();
  }
}

function sortedNames(names) {
  return [...names].sort();
}

function assertNameSetMatches(label, actualNames, expectedNames) {
  assert.deepEqual(
    sortedNames(actualNames),
    sortedNames(expectedNames),
    `${label}: Namensmenge weicht von der Doku ab (ist: ${sortedNames(actualNames).join(",")})`,
  );
}

// ==================== Tabelle A: 12 Zeilen, Namensmenge == K1 ====================
test("P10a (H7/H8): Tabelle A hat genau 12 Zeilen, ihre Namensmenge ist gleich K1", () => {
  const doc = readDoc();
  const tableA = parseTableA(doc);
  assert.equal(tableA.length, EXPECTED_TABLE_A_ROWS, "Tabelle A traegt genau 12 Werkzeuge");
  const tableB = parseTableB(doc);
  assertNameSetMatches("Tabelle A vs. K1", tableA.map((row) => row.name), tableB.get("K1").names);
});

// ==================== K1 (HTTP, Bootstrap-Owner, Consult+Context an) ====================
test("P10a (H7/H8, K1 - HTTP Bootstrap-Owner, Consult+Context an): Namensmenge, Anzahl und alle vier Hints stimmen mit der Doku", async () => {
  const doc = readDoc();
  const tableA = parseTableA(doc);
  const tableB = parseTableB(doc);
  const expected = tableB.get("K1");

  const srv = await startServer({
    seed: seedState({}),
    env: { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" },
  });
  try {
    const tools = await httpToolsList(`${srv.localUrl}/mcp`, null);
    assert.equal(tools.length, expected.count, "K1: Anzahl");
    assertNameSetMatches("K1", tools.map((tool) => tool.name), expected.names);

    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const row of tableA) {
      const tool = byName.get(row.name);
      assert.ok(tool, `K1: ${row.name} fehlt im echten tools/list`);
      const annotations = tool.annotations || {};
      assert.equal(
        String(annotations.readOnlyHint),
        row.readOnlyHint,
        `${row.name}: readOnlyHint weicht von Tabelle A ab`,
      );
      assert.equal(
        String(annotations.destructiveHint),
        row.destructiveHint,
        `${row.name}: destructiveHint weicht von Tabelle A ab`,
      );
      assert.equal(
        String(annotations.openWorldHint),
        row.openWorldHint,
        `${row.name}: openWorldHint weicht von Tabelle A ab`,
      );
      const expectedIdempotent = row.idempotentHint === "-" ? undefined : row.idempotentHint === "true";
      assert.equal(
        annotations.idempotentHint,
        expectedIdempotent,
        `${row.name}: idempotentHint weicht von Tabelle A ab`,
      );
    }
  } finally {
    await srv.stop();
  }
});

// ==================== K2 (HTTP, Bootstrap-Owner, Consult aus) ====================
test("P10a (H7/H8, K2 - HTTP Bootstrap-Owner, Consult aus/BASE_ENV-Default): Namensmenge + Anzahl stimmen mit der Doku", async () => {
  const doc = readDoc();
  const expected = parseTableB(doc).get("K2");
  const srv = await startServer({ seed: seedState({}) }); // BASE_ENV: CONSULT_ENABLED=false
  try {
    const tools = await httpToolsList(`${srv.localUrl}/mcp`, null);
    assert.equal(tools.length, expected.count, "K2: Anzahl");
    assertNameSetMatches("K2", tools.map((tool) => tool.name), expected.names);
  } finally {
    await srv.stop();
  }
});

// ==================== K3/K4 (HTTP OAuth, Consult global an) ====================
const TENANT_DEFAULT = "t_p10a_default"; // kein gespeichertes Profil -> DEFAULT_PROFILE
const TENANT_PAID = "t_p10a_paid"; // planProfileFor("starter")
const SUB_DEFAULT = "sub-p10a-default";
const SUB_PAID = "sub-p10a-paid";

function seedOauthTenants(profilesOverride) {
  return seedState({
    tenants: [
      { id: TENANT_DEFAULT, status: "active", idpSubject: SUB_DEFAULT },
      { id: TENANT_PAID, status: "active", idpSubject: SUB_PAID },
    ],
    profiles: profilesOverride,
  });
}

test("P10a (H7/H8, K3 - HTTP OAuth, Tenant ohne Profil, Consult global an): Namensmenge + Anzahl stimmen mit der Doku", async () => {
  const doc = readDoc();
  const expected = parseTableB(doc).get("K3");
  const idp = await startIdp();
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" },
    seed: seedOauthTenants({}), // TENANT_DEFAULT hat KEIN gespeichertes Profil
  });
  try {
    const token = await idp.sign({ sub: SUB_DEFAULT });
    const tools = await httpToolsList(`${srv.localUrl}/mcp`, token);
    assert.equal(tools.length, expected.count, "K3: Anzahl");
    assertNameSetMatches("K3", tools.map((tool) => tool.name), expected.names);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

test("P10a (H7/H8, K4 - HTTP OAuth, Tenant mit planProfileFor('starter'), Consult global an): Namensmenge + Anzahl stimmen mit der Doku", async () => {
  const doc = readDoc();
  const expected = parseTableB(doc).get("K4");
  const idp = await startIdp();
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" },
    seed: seedOauthTenants({ [TENANT_PAID]: planProfileFor("starter") }),
  });
  try {
    const token = await idp.sign({ sub: SUB_PAID });
    const tools = await httpToolsList(`${srv.localUrl}/mcp`, token);
    assert.equal(tools.length, expected.count, "K4: Anzahl");
    assertNameSetMatches("K4", tools.map((tool) => tool.name), expected.names);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

// ==================== K5 (HTTP OAuth, Consult global aus) ====================
test("P10a (H7/H8, K5 - HTTP OAuth, Tenant mit Plan-Profil, Consult global aus): Namensmenge + Anzahl stimmen mit der Doku", async () => {
  const doc = readDoc();
  const expected = parseTableB(doc).get("K5");
  const idp = await startIdp();
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer }, // BASE_ENV: CONSULT_ENABLED=false
    seed: seedOauthTenants({ [TENANT_PAID]: planProfileFor("starter") }),
  });
  try {
    const token = await idp.sign({ sub: SUB_PAID });
    const tools = await httpToolsList(`${srv.localUrl}/mcp`, token);
    assert.equal(tools.length, expected.count, "K5: Anzahl");
    assertNameSetMatches("K5", tools.map((tool) => tool.name), expected.names);
  } finally {
    await srv.stop();
    await idp.close();
  }
});

// ==================== K6 (stdio, kein Tenant) ====================
test("P10a (H7/H8, K6 - stdio Kindprozess src/mcp-server.js): Namensmenge + Anzahl stimmen mit der Doku", async () => {
  const doc = readDoc();
  const expected = parseTableB(doc).get("K6");
  const { names, stderrOutput } = await stdioToolNames({});
  assert.equal(names.length, expected.count, `K6: Anzahl (stderr: ${stderrOutput()})`);
  assertNameSetMatches("K6", names, expected.names);
});
