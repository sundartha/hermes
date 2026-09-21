// P10a (H7 + H8): haelt docs/OPENAI-TOOL-INVENTORY.md gegen den echten Draht. Die Doku
// behauptet eine Werkzeugmenge je Konfiguration (K1-K6, Tabelle B) und je Werkzeug Titel,
// Registrier-Bedingung und Annotationen (Tabelle A). Beide Tabellen stehen ZWEIMAL in der
// Doku: als Prosatabelle (die der OpenAI-Pruefer liest) und als maschinenlesbarer Block.
// Dieser Test liest BEIDE und misst sie GEGEN tools/list ueber HTTP (legacy + OAuth) und stdio.
//
// Nie das registerTool-Konfigobjekt pruefen: registerTool() des MCP-SDK verwirft unbekannte
// Felder still, ein Test auf das Registrierungsobjekt beweist nichts (Lehre der Phase). Alle
// Zusicherungen lesen deshalb den echten tools/list-Output.
//
// Messung EINMAL je Datei (memoisiertes Promise ueber alle sechs Konfigurationen): die
// Bedingungsspalte laesst sich nur aus dem Vergleich MEHRERER Konfigurationen ableiten, und
// Titel/Annotationen werden in JEDER Konfiguration geprueft, nicht nur in K1.
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
const CONFIG_KEYS = ["K1", "K2", "K3", "K4", "K5", "K6"];
const HINT_KEYS = ["readOnlyHint", "destructiveHint", "openWorldHint", "idempotentHint"];
const TABLE_A_COLUMNS = ["name", "title", "condition", ...HINT_KEYS];
const HINT_NOT_SET = "-";
// Kopfzeilen-Anfaenge der beiden Prosatabellen - daran findet der Parser sie.
const PROSE_A_HEADER = "| name | title | condition |";
const PROSE_B_HEADER = "| K | transport |";
// Permissives Ergebnis-Schema fuer den stdio-Fall ueber den typisierten SDK-Client: z.any()
// reicht jedes Werkzeug unveraendert durch (title/annotations werden NICHT gestrippt).
const RAW_TOOLS_LIST_RESULT = z.object({ tools: z.array(z.any()) });

// Bedingung aus dem Draht: in welchen Konfigurationen taucht das Werkzeug auf?
// Anwesenheits-Signatur (K1..K6 als 0/1) -> Bedingungsspalte.
const CONDITION_BY_PRESENCE = new Map([
  ["111111", "always"],
  ["100100", "consult"],
  ["110001", "calendar"],
]);

function readDoc() {
  return fs.readFileSync(DOC_PATH, "utf8");
}

function parseBlock(doc, beginMarker, endMarker) {
  const begin = doc.indexOf(beginMarker);
  const end = doc.indexOf(endMarker);
  assert.ok(begin !== -1 && end !== -1 && end > begin, `Block ${beginMarker}..${endMarker} fehlt`);
  const body = doc.slice(begin + beginMarker.length, end);
  const trimmedLines = body.split("\n").map((line) => line.trim());
  return trimmedLines.filter((line) => line.length > 0);
}

function rowObject(cells) {
  return Object.fromEntries(TABLE_A_COLUMNS.map((column, i) => [column, cells[i]]));
}

function parseTableA(doc) {
  const lines = parseBlock(doc, "TABLE-A-BEGIN", "TABLE-A-END");
  return lines.map((line) => rowObject(line.split("|")));
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

// Markdown-Tabelle ab der Kopfzeile bis zur ersten Nicht-Tabellenzeile; Trennzeile (|---|)
// faellt weg. Liefert je Datenzeile die getrimmten Zellen.
function parseProseTable(doc, headerPrefix) {
  const lines = doc.split("\n");
  const start = lines.findIndex((line) => line.startsWith(headerPrefix));
  assert.ok(start !== -1, `Prosatabelle "${headerPrefix}" fehlt`);
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (!line.startsWith("|")) break;
    if (/^\|[-|\s]+\|$/.test(line)) continue;
    rows.push(line.split("|").slice(1, -1).map((cell) => cell.trim()));
  }
  return rows;
}

function parseProseTableA(doc) {
  return parseProseTable(doc, PROSE_A_HEADER).map(rowObject);
}

function parseProseTableBCounts(doc) {
  const rows = parseProseTable(doc, PROSE_B_HEADER);
  return new Map(rows.map((cells) => [cells[0], Number(cells[cells.length - 1])]));
}

// tools/list ueber HTTP, ROH gelesen (readToolResult parst nur JSON.parse(...).result,
// keine SDK-Zod-Schemas - annotations/Namen kommen unveraendert durch).
async function httpToolsList(baseUrl, token) {
  const res = await mcpPost(baseUrl, token, TOOLS_LIST_BODY);
  const result = await readToolResult(res);
  return result.tools;
}

async function stdioToolsList(env) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER_ENTRYPOINT],
    cwd: ROOT,
    env: { ...BASE_ENV, ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "p10a-h7-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    const result = await client.request({ method: "tools/list" }, RAW_TOOLS_LIST_RESULT);
    return result.tools;
  } finally {
    await client.close();
  }
}

// ==================== Konfigurationen K1-K6 ====================
const CONSULT_ON = { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" };
const TENANT_DEFAULT = "t_p10a_default"; // kein gespeichertes Profil -> DEFAULT_PROFILE
const TENANT_PAID = "t_p10a_paid"; // planProfileFor("starter")
const SUB_DEFAULT = "sub-p10a-default";
const SUB_PAID = "sub-p10a-paid";

function seedOauthTenants() {
  return seedState({
    tenants: [
      { id: TENANT_DEFAULT, status: "active", idpSubject: SUB_DEFAULT },
      { id: TENANT_PAID, status: "active", idpSubject: SUB_PAID },
    ],
    // TENANT_DEFAULT hat bewusst KEIN gespeichertes Profil
    profiles: { [TENANT_PAID]: planProfileFor("starter") },
  });
}

async function measureLegacyHttp(env) {
  const srv = await startServer({ seed: seedState({}), env });
  try {
    return await httpToolsList(`${srv.localUrl}/mcp`, null);
  } finally {
    await srv.stop();
  }
}

async function measureOauthHttp(env, subject) {
  const idp = await startIdp();
  const srv = await startServer({
    env: { MCP_AUTH: "oauth", OAUTH_ISSUER_URL: idp.issuer, ...env },
    seed: seedOauthTenants(),
  });
  try {
    const token = await idp.sign({ sub: subject });
    return await httpToolsList(`${srv.localUrl}/mcp`, token);
  } finally {
    await srv.stop();
    await idp.close();
  }
}

// Sequenziell, nicht parallel: jede Messung startet einen Kindprozess (Lastgrenze).
async function measureAllConfigurations() {
  const wire = new Map();
  wire.set("K1", await measureLegacyHttp(CONSULT_ON)); // Bootstrap-Owner, Consult an
  wire.set("K2", await measureLegacyHttp({})); // BASE_ENV: CONSULT_ENABLED=false
  wire.set("K3", await measureOauthHttp(CONSULT_ON, SUB_DEFAULT));
  wire.set("K4", await measureOauthHttp(CONSULT_ON, SUB_PAID));
  wire.set("K5", await measureOauthHttp({}, SUB_PAID)); // Consult global aus
  wire.set("K6", await stdioToolsList({})); // stdio, kein Tenant
  return wire;
}

let wirePromise = null;
function wireMeasurements() {
  wirePromise ||= measureAllConfigurations();
  return wirePromise;
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

function hintAsDocCell(value) {
  return value === undefined ? HINT_NOT_SET : String(value);
}

// Titel (Top-Level UND annotations.title) und alle vier Hints eines Draht-Werkzeugs gegen
// EINE Tabellenzeile.
function assertToolMatchesRow(label, tool, row) {
  const annotations = tool.annotations || {};
  assert.equal(tool.title, row.title, `${label}: title weicht ab`);
  assert.equal(annotations.title, row.title, `${label}: annotations.title weicht ab`);
  for (const hint of HINT_KEYS) {
    assert.equal(hintAsDocCell(annotations[hint]), row[hint], `${label}: ${hint} weicht ab`);
  }
}

function wireCondition(name, wire) {
  const presence = CONFIG_KEYS.map((k) =>
    wire.get(k).some((tool) => tool.name === name) ? "1" : "0",
  ).join("");
  return CONDITION_BY_PRESENCE.get(presence) ?? `unerwartet:${presence}`;
}

// ==================== Tabelle A: 12 Zeilen, Namensmenge == K1 ====================
test("P10a (H7/H8): Tabelle A hat genau 12 Zeilen, ihre Namensmenge ist gleich K1", () => {
  const doc = readDoc();
  const tableA = parseTableA(doc);
  assert.equal(tableA.length, EXPECTED_TABLE_A_ROWS, "Tabelle A traegt genau 12 Werkzeuge");
  assertNameSetMatches("Tabelle A vs. K1", tableA.map((row) => row.name), parseTableB(doc).get("K1").names);
});

// ==================== Prosa == Maschinenblock ====================
test("P10a (H7/H8): Prosatabelle A stimmt Zeile fuer Zeile und Spalte fuer Spalte mit dem Maschinenblock", () => {
  const doc = readDoc();
  assert.deepEqual(parseProseTableA(doc), parseTableA(doc));
});

test("P10a (H7/H8): Anzahl-Spalte der Prosatabelle B stimmt mit dem Maschinenblock", () => {
  const doc = readDoc();
  const proseCounts = parseProseTableBCounts(doc);
  const tableB = parseTableB(doc);
  assert.deepEqual([...proseCounts.keys()], CONFIG_KEYS, "Prosatabelle B traegt genau K1-K6");
  for (const k of CONFIG_KEYS) assert.equal(proseCounts.get(k), tableB.get(k).count, `${k}: Anzahl`);
});

// ==================== Draht: Anzahl + Namensmenge je Konfiguration ====================
test("P10a (H7/H8, K1-K6 - HTTP legacy, HTTP OAuth, stdio): Anzahl (Prosa + Block) und Namensmenge stimmen je Konfiguration mit dem Draht", async () => {
  const doc = readDoc();
  const tableB = parseTableB(doc);
  const proseCounts = parseProseTableBCounts(doc);
  const wire = await wireMeasurements();
  for (const k of CONFIG_KEYS) {
    const tools = wire.get(k);
    assert.equal(tools.length, tableB.get(k).count, `${k}: Anzahl (Block)`);
    assert.equal(tools.length, proseCounts.get(k), `${k}: Anzahl (Prosa)`);
    assertNameSetMatches(k, tools.map((tool) => tool.name), tableB.get(k).names);
  }
});

// ==================== Draht: Titel + Hints in JEDER Konfiguration ====================
test("P10a (H7/H8, K1-K6): Titel und alle vier Hints stimmen in JEDER Konfiguration mit Prosatabelle UND Maschinenblock", async () => {
  const doc = readDoc();
  const tables = { Block: parseTableA(doc), Prosa: parseProseTableA(doc) };
  const wire = await wireMeasurements();
  for (const [source, rows] of Object.entries(tables)) {
    const byName = new Map(rows.map((row) => [row.name, row]));
    for (const k of CONFIG_KEYS) {
      for (const tool of wire.get(k)) {
        const row = byName.get(tool.name);
        assert.ok(row, `${source}/${k}: ${tool.name} fehlt in Tabelle A`);
        assertToolMatchesRow(`${source}/${k}/${tool.name}`, tool, row);
      }
    }
  }
});

// ==================== Draht: Bedingungsspalte ====================
test("P10a (H7/H8, K1-K6): Bedingungsspalte (Prosa + Block) stimmt mit der am Draht gemessenen Anwesenheit ueber alle Konfigurationen", async () => {
  const doc = readDoc();
  const tables = { Block: parseTableA(doc), Prosa: parseProseTableA(doc) };
  const wire = await wireMeasurements();
  for (const [source, rows] of Object.entries(tables)) {
    for (const row of rows) {
      assert.equal(row.condition, wireCondition(row.name, wire), `${source}: ${row.name} condition`);
    }
  }
});
