// Haelt docs/OPENAI-POLICY-ABGLEICH.md an Code und Draht fest. Das Dokument behauptet
// Mechanismen und Luecken mit Code-Stellen (datei:zeile) und zitiert Werkzeugtexte. Beides
// driftet still, sobald sich Zeilen verschieben oder Beschreibungen aendern - dieser Test
// macht die Drift laut:
//   1. Anker-Block: an jeder genannten Stelle steht der Anker-Text; jede datei:zeile-Angabe
//      im Fliesstext steht im Block (und umgekehrt).
//   2. Werkzeug-Zitate: jedes Zitat steht woertlich im ECHTEN tools/list - ueber HTTP /mcp
//      (Legacy-Token, mit Consult = alle 11 Werkzeuge) UND ueber stdio. Nie das
//      registerTool-Konfigobjekt pruefen: das SDK verwirft unbekannte Felder still, ein Test
//      darauf beweist nichts.
//   3. Jedes Policy-Zitat (Zeile "> \"...") nennt eine OpenAI-URL.
//   4. Hygiene: das Dokument kann mit eingereicht werden - keine internen Kennungen, keine
//      Nummern, keine Secret-Muster.
//   5. Ehrlichkeit der Quellen: jedes Zitat aus einer Seite, die beim Abgleich nicht direkt
//      abrufbar war, traegt den Nachpruef-Vermerk. Wer den Vermerk entfernt, muss die Seite
//      gegengelesen haben und diesen Test bewusst anpassen.
//   6. Jede Luecke in Teil C nennt ein Ziel (geplant, keinem Arbeitspaket zugeordnet oder
//      ohne Betreiber-Entscheidung) - keine Luecke ohne Aussage, wie es mit ihr weitergeht.
//
// Testnamen tragen KEIN Katalog-/ABNAHME-Praefix (package.json i18nCatalogPattern/
// abnahmePattern), sonst landet dieser Test im falschen Lauf.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startServer, seedState, mcpPost, readToolResult, ROOT, BASE_ENV } from "./helpers.js";

const DOC_PATH = path.join(ROOT, "docs", "OPENAI-POLICY-ABGLEICH.md");
const MCP_SERVER_ENTRYPOINT = "src/mcp-server.js";
const TOOLS_LIST_BODY = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const CONSULT_ON = { CONSULT_ENABLED: "true", ASSISTANT_CONTEXT_ENABLED: "true" };
const EXPECTED_HTTP_TOOL_COUNT = 11;
const RAW_TOOLS_LIST_RESULT = z.object({ tools: z.array(z.any()) });

const ANCHOR_BLOCK = { begin: "ANKER-BEGIN", end: "ANKER-END" };
const QUOTE_BLOCK = { begin: "WERKZEUGZITAT-BEGIN", end: "WERKZEUGZITAT-END" };
// datei:zeile bzw. datei:von-bis; nur Repo-Pfade, deren Zeilen dieser Test lesen kann.
const CODE_REF = /\b((?:src|elevenlabs)\/[\w./-]+\.(?:js|mjs|sql|json)):(\d+(?:-\d+)?)/g;
const PROSE_TOOL_QUOTE = /Werkzeugtext \(([a-z_]+)\): "([^"]+)"/g;
const POLICY_QUOTE_PREFIX = '> "';
const BLOCK_SEPARATOR = " | ";
// Laenge des Zeilenauszugs in einer Fehlermeldung.
const ERROR_EXCERPT_CHARS = 80;
const USAGE_POLICIES_URL = "https://openai.com/policies/usage-policies/";
const OPENAI_SOURCE_URLS = [USAGE_POLICIES_URL, "https://developers.openai.com/plugins/app-guidelines"];
const SOURCES_SECTION = { begin: "## Quellen", end: "## Uebersicht" };
const SOURCE_ITEM_START = /^- /m;
// Jede zitierte OpenAI-Quelle muss im Quellen-Abschnitt als direkt an der Primaerquelle
// Zeichen fuer Zeichen geprueft ausgewiesen sein - eine Kopie Dritter ist kein Beleg.
const PRIMARY_SOURCE_CLAIMS = ["direkt von der Primaerquelle", "Zeichen fuer Zeichen"];
const GAPS_SECTION = { begin: "## Teil C: Luecken", end: "## Anker (maschinenlesbar)" };
const GAP_ITEM_START = /^\d+\. \*\*/m;
// Der Ziel-Wert darf ueber einen Zeilenumbruch laufen; geprueft wird der Text mit
// zusammengezogenem Leerraum.
const GAP_TARGET = /Ziel[^:]*: (planned: |open, not yet assigned to a work package|open, no owner decision yet)/;
// Interne Kennungen (Phasen, Befunde, Owner-Punkte, Branches), E.164-artige Nummern,
// Secret-Muster. Das Dokument kann an OpenAI gehen.
const FORBIDDEN_PATTERNS = [
  /\bT2-\d/,
  /\bO-\d/,
  /\bOW-/,
  /\bH\d+\b/,
  /\bP\d+[a-z]?\b/,
  /phase\//,
  /\bN-\d/,
  /\bX-\d/,
  /\bT-\d/,
  /\+\d{6,}/,
  /sk_/,
  /whsec_/,
  /Bearer /,
];

function readDoc() {
  return fs.readFileSync(DOC_PATH, "utf8");
}

function blockBounds(doc, { begin, end }) {
  const start = doc.indexOf(begin);
  const stop = doc.indexOf(end);
  assert.ok(start !== -1 && stop > start, `Block ${begin}..${end} fehlt`);
  return { start, stop: stop + end.length, body: doc.slice(start + begin.length, stop) };
}

// "links | rechts" je nichtleerer Zeile; nur das ERSTE " | " trennt (der Anker darf "|"
// enthalten).
function parseBlockPairs(doc, markers) {
  const lines = blockBounds(doc, markers).body.split("\n").map((raw) => raw.trim());
  return lines
    .filter((line) => line.length > 0)
    .map((line) => {
      const cut = line.indexOf(BLOCK_SEPARATOR);
      assert.ok(cut > 0, `Blockzeile ohne Trenner: ${line}`);
      return { key: line.slice(0, cut).trim(), value: line.slice(cut + BLOCK_SEPARATOR.length) };
    });
}

// Fliesstext = Dokument ohne die beiden Maschinenbloecke.
function proseOf(doc) {
  let prose = doc;
  for (const markers of [ANCHOR_BLOCK, QUOTE_BLOCK]) {
    const { start, stop } = blockBounds(prose, markers);
    prose = prose.slice(0, start) + prose.slice(stop);
  }
  return prose;
}

function lineRange(spec) {
  const [from, to] = spec.split("-").map(Number);
  return { from, to: to ?? from };
}

function codeRefsIn(text) {
  return new Set([...text.matchAll(CODE_REF)].map(([, file, lines]) => `${file}:${lines}`));
}

// Beschreibung plus alle Eingabe-Beschreibungen (rekursiv durch verschachtelte Objekte).
function describedTexts(schemaNode) {
  if (!schemaNode || typeof schemaNode !== "object") return [];
  const own = typeof schemaNode.description === "string" ? [schemaNode.description] : [];
  const children = Object.values(schemaNode.properties || {}).flatMap(describedTexts);
  return [...own, ...children];
}

function toolTexts(tool) {
  return [tool.description || "", ...describedTexts(tool.inputSchema)];
}

async function httpToolsList() {
  const srv = await startServer({ seed: seedState({}), env: CONSULT_ON });
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, TOOLS_LIST_BODY);
    return (await readToolResult(res)).tools;
  } finally {
    await srv.stop();
  }
}

async function stdioToolsList() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_SERVER_ENTRYPOINT],
    cwd: ROOT,
    env: { ...BASE_ENV },
    stderr: "pipe",
  });
  const client = new Client({ name: "policy-abgleich-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    return (await client.request({ method: "tools/list" }, RAW_TOOLS_LIST_RESULT)).tools;
  } finally {
    await client.close();
  }
}

// Sequenziell: jede Messung startet einen Kindprozess (Lastgrenze). EINMAL je Datei.
let wirePromise = null;
function wireMeasurements() {
  wirePromise ||= (async () => ({ http: await httpToolsList(), stdio: await stdioToolsList() }))();
  return wirePromise;
}

function assertQuoteOnWire(label, tools, { key: toolName, value: quote }) {
  const tool = tools.find((candidate) => candidate.name === toolName);
  assert.ok(tool, `${label}: Werkzeug ${toolName} fehlt im tools/list`);
  assert.ok(
    toolTexts(tool).some((text) => text.includes(quote)),
    `${label}: Zitat steht nicht im tools/list von ${toolName}: "${quote}"`,
  );
}

test("Policy-Abgleich: an jeder genannten Code-Stelle steht der Anker-Text", () => {
  const anchors = parseBlockPairs(readDoc(), ANCHOR_BLOCK);
  assert.ok(anchors.length > 0, "Anker-Block ist leer");
  for (const { key, value: anchor } of anchors) {
    const cut = key.lastIndexOf(":");
    const file = key.slice(0, cut);
    const { from, to } = lineRange(key.slice(cut + 1));
    const filePath = path.join(ROOT, file);
    assert.ok(fs.existsSync(filePath), `${key}: Datei fehlt`);
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    const window = lines.slice(from - 1, to).join("\n");
    assert.ok(window.includes(anchor), `${key}: Anker "${anchor}" steht nicht in Zeile ${from}-${to}`);
  }
});

test("Policy-Abgleich: jede datei:zeile-Angabe im Fliesstext steht im Anker-Block und umgekehrt", () => {
  const doc = readDoc();
  const prose = codeRefsIn(proseOf(doc));
  const block = new Set(parseBlockPairs(doc, ANCHOR_BLOCK).map((anchor) => anchor.key));
  assert.ok(prose.size > 0, "Fliesstext nennt keine Code-Stelle - der Extraktor greift nicht");
  const missingInBlock = [...prose].filter((ref) => !block.has(ref));
  const unusedInBlock = [...block].filter((ref) => !prose.has(ref));
  assert.deepEqual(missingInBlock, [], "Stellen im Fliesstext ohne Anker");
  assert.deepEqual(unusedInBlock, [], "Anker ohne Stelle im Fliesstext");
});

test("Policy-Abgleich: jedes Werkzeugtext-Zitat im Fliesstext steht im Zitat-Block und umgekehrt", () => {
  const doc = readDoc();
  const asKey = ({ key, value }) => `${key} | ${value}`;
  const prose = new Set(
    [...proseOf(doc).matchAll(PROSE_TOOL_QUOTE)].map(([, key, value]) => asKey({ key, value })),
  );
  const block = new Set(parseBlockPairs(doc, QUOTE_BLOCK).map(asKey));
  assert.ok(prose.size > 0, "Fliesstext zitiert kein Werkzeug - der Extraktor greift nicht");
  assert.deepEqual([...prose].filter((quote) => !block.has(quote)), [], "Zitate ohne Block-Eintrag");
  assert.deepEqual([...block].filter((quote) => !prose.has(quote)), [], "Block-Eintraege ohne Zitat");
});

test("Policy-Abgleich: jedes Werkzeug-Zitat steht woertlich im echten tools/list (HTTP /mcp und stdio)", async () => {
  const quotes = parseBlockPairs(readDoc(), QUOTE_BLOCK);
  const { http, stdio } = await wireMeasurements();
  assert.equal(http.length, EXPECTED_HTTP_TOOL_COUNT, "HTTP-Messung ist nicht die volle Werkzeugmenge");
  const stdioNames = new Set(stdio.map((tool) => tool.name));
  assert.ok(stdioNames.has("place_call"), "stdio-Messung liefert place_call nicht - stdio waere ungeprueft");
  for (const quote of quotes) {
    assertQuoteOnWire("HTTP /mcp", http, quote);
    if (stdioNames.has(quote.key)) assertQuoteOnWire("stdio", stdio, quote);
  }
});

test("Policy-Abgleich: jedes Policy-Zitat nennt seine OpenAI-Quelle", () => {
  const quoteLines = readDoc()
    .split("\n")
    .filter((line) => line.startsWith(POLICY_QUOTE_PREFIX));
  assert.ok(quoteLines.length > 0, "keine Policy-Zitate gefunden - der Filter greift nicht");
  for (const line of quoteLines) {
    assert.ok(
      OPENAI_SOURCE_URLS.some((url) => line.includes(url)),
      `Policy-Zitat ohne OpenAI-URL: ${line.slice(0, ERROR_EXCERPT_CHARS)}`,
    );
  }
});

test("Policy-Abgleich: keine internen Kennungen, Nummern oder Secret-Muster im Dokument", () => {
  const doc = readDoc();
  for (const pattern of FORBIDDEN_PATTERNS) {
    const hit = doc.match(pattern);
    assert.equal(hit, null, `verbotenes Muster ${pattern} gefunden: "${hit?.[0]}"`);
  }
});

test("Policy-Abgleich: jede zitierte OpenAI-Quelle ist als an der Primaerquelle geprueft ausgewiesen", () => {
  const { body } = blockBounds(readDoc(), SOURCES_SECTION);
  const items = body.split(SOURCE_ITEM_START).map((item) => item.replace(/\s+/g, " "));
  for (const url of OPENAI_SOURCE_URLS) {
    const item = items.find((candidate) => candidate.includes(url));
    assert.ok(item, `Quelle ${url} fehlt im Quellen-Abschnitt`);
    for (const claim of PRIMARY_SOURCE_CLAIMS) {
      assert.ok(item.includes(claim), `Quelle ${url} ohne Primaerquellen-Nachweis "${claim}"`);
    }
  }
});

test("Policy-Abgleich: jede Luecke in Teil C nennt ein Ziel", () => {
  const { body } = blockBounds(readDoc(), GAPS_SECTION);
  const items = body.split(GAP_ITEM_START).slice(1);
  assert.ok(items.length > 0, "keine Luecken gefunden - der Filter greift nicht");
  for (const item of items) {
    const flat = item.replace(/\s+/g, " ");
    assert.match(flat, GAP_TARGET, `Luecke ohne Ziel: ${flat.slice(0, ERROR_EXCERPT_CHARS)}`);
  }
});
