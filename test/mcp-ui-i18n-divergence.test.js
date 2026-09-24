// i18n-Launch-Testkatalog, Block B3 (MCP-Schicht und Widgets).
// Katalog-IDs in dieser Datei: UI-09.
// Spezifikation: tasks/i18n-tests/12-sprachachsen-ui.md.
//
// UI-14/UI-18 (P13, Widget und Kanarienvogel) sind gefixt und als "ex UI-14"/"ex UI-18"
// nach test/mcp-ui-widget-i18n.test.js umgezogen (A3) - dort ist die etablierte Heimat der
// Widget-Lokalisierung.
//
// UI-09 bleibt eine GRUENE Charakterisierung des heutigen Stands (Divergenz dreier
// Sprachachsen in EINER Karte) - siehe Kopfkommentar dort fuer die Ist-Pin-Falle, die
// bewusst vermieden wird. UI-09 selbst bleibt woertlich unveraendert: sie variiert
// scopedTenant, nicht language, und ist von P13 nicht betroffen.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../src/mcp-tools.js";
import { resolveLocale, WIDGET_DICT } from "../src/ui/widget-i18n.js";

const HTTP_OK = 200;

// ---- Mini-Harness (Muster test/mcp-tools.test.js, dupliziert - siehe dortiger Kommentar) ----
// Einziger Registrierweg ist registerTool (src/mcp-tools.js uiTool); ein
// server.tool()-Aufruf wuerde hier absichtlich mit TypeError scheitern.
function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    registerTool(name, _config, handler) {
      handlers.set(name, handler);
    },
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return handlers;
}

async function startGatewayMock(body) {
  const server = http.createServer((req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withGateway(body, fn) {
  const mock = await startGatewayMock(body);
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = mock.url;
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await mock.close();
  }
}

// ==================== UI-09 ====================
// Charakterisierung - heutiger Stand: drei Sprachachsen liefern in EINER call.html-Karte
// gleichzeitig unterschiedliche/unabhaengige Werte. Der korrespondierende ROTE SOLL-Test
// fuer die Achse B2 (Transkript-Rollen-Praefix) ist MCP-06 in test/mcp-tools-i18n.test.js
// (selber Block) - der pinnt denselben Sachverhalt als Sollzustand ("kein 'Gegenseite:'
// fuer EN-Tenant") und wird nach einem Fix gruen, waehrend diese Charakterisierung dann
// veraltet und ueberprueft werden muss.
//
// IST-PIN-FALLE VERMIEDEN: diese Datei assertiert NICHT auf das deutsche Literal
// "Gegenseite: " (das wuerde nach einem MCP-06-Fix als falsche Regression brechen).
// Stattdessen wird die DIVERGENZ-Eigenschaft selbst geprueft: Achse A (Chrome/Browser-
// Locale) ist Englisch, Achse D (Anruf-/Tenant-Sprache, hier simuliert per franzoesischer
// Fixture-Zusammenfassung) ist Franzoesisch, und Achse B2 (Transkript-Rollen-Praefix) traegt
// einen WERT, der in KEINER der beiden Uebersetzungstabellen (WIDGET_DICT.de/.fr) und auch
// nicht unter den englischen Default-Keys selbst vorkommt - ein von der gesamten
// Widget-i18n-Uebersetzungswelt strukturell entkoppelter dritter Wert. Drei Karten-Elemente,
// drei voneinander unabhaengige Sprachquellen, gleichzeitig sichtbar in EINER Karte.
// Beleg: src/mcp-tools.js:110 (deutsches Praefix); src/mcp-tools.js:132-140 (result_summary
// = c.summary, sprachabhaengig via src/claude.js:665); src/ui/widget-i18n.js:113-120
// (Chrome-Locale unabhaengig davon).
test("UI-09: Charakterisierung heutiger Stand - drei Sprachachsen divergieren gleichzeitig in einer Karte", async () => {
  // Achse A: Chrome/Browser-Locale des Betrachters, hier simuliert als en-US.
  const chromeLocale = resolveLocale(["en-US"], WIDGET_DICT);
  assert.equal(chromeLocale, "en");

  const CALL_FIXTURE = {
    status: "completed",
    startedAt: "2026-06-26T09:59:50.000Z",
    endedAt: "2026-06-26T10:02:00.000Z",
    // Achse D: Anruf-/Tenant-Sprache. Franzoesischer Fixture-Text (wie claude.js
    // summarizeCall ihn fuer einen FR-Tenant erzeugen wuerde), erkennbar an franzoesischen
    // Akzentzeichen - deterministisch, weil WIR die Fixture kontrollieren.
    summary: "Rendez-vous confirmé pour samedi à onze heures.",
    transcript: [
      { role: "agent", text: "Bonjour, ici Hermes." },
      { role: "callee", text: "Bonjour, de quoi s'agit-il ?" },
    ],
  };

  await withGateway(CALL_FIXTURE, async () => {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant-fr" });
    const statusResult = await handlers.get("get_call_status")({ call_id: "call_1" });
    const transcriptResult = await handlers.get("get_call_result")({ call_id: "call_1" });

    const summary = transcriptResult.structuredContent.result_summary;
    assert.match(summary, /[éèàâîïôûç]/i, "Achse D traegt franzoesische Zeichen (Fixture-Beweis)");

    const lines = statusResult.structuredContent.last_transcript_lines;
    const calleeLine = lines.find((line) => line.includes("Bonjour, de quoi"));
    assert.ok(calleeLine, "Gegenseiten-Zeile muss im Fixture-Transkript vorkommen");
    const prefix = calleeLine.split(":")[0]; // dynamisch extrahiert, NICHT hartkodiert

    // Achse B2 ist in KEINER Uebersetzungstabelle der Widget-Chrome (Achse A) vertreten -
    // ein von deren Sprachsystem komplett entkoppelter dritter Wert.
    const dictUniverse = new Set([
      ...Object.keys(WIDGET_DICT.en ?? {}),
      ...Object.values(WIDGET_DICT.de),
      ...Object.values(WIDGET_DICT.fr),
    ]);
    assert.ok(
      !dictUniverse.has(prefix),
      `Rollen-Praefix "${prefix}" muesste aus der Widget-Chrome-Uebersetzungswelt stammen, ` +
        "tut es aber nicht - dritte, unkoordinierte Sprachquelle",
    );

    // Zusatzbeweis der Entkopplung: derselbe Praefix erscheint unabhaengig vom Tenant
    // (Achse B2 liest gar kein Sprachfeld, MCP-06 im selben Block).
    const handlersOther = captureTools({ identity: null, scopedTenant: "tenant-en-us" });
    const statusResultOther = await handlersOther.get("get_call_status")({ call_id: "call_1" });
    const calleeLineOther = statusResultOther.structuredContent.last_transcript_lines.find((line) =>
      line.includes("Bonjour, de quoi"),
    );
    assert.equal(
      calleeLineOther.split(":")[0],
      prefix,
      "Praefix bleibt invariant, egal welcher Tenant (unabhaengig von Achse D)",
    );
  });
});
