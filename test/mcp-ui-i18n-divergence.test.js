// i18n-Launch-Testkatalog, Block B3 (MCP-Schicht und Widgets).
// Katalog-IDs in dieser Datei: UI-09, UI-14, UI-18.
// Spezifikation: tasks/i18n-tests/12-sprachachsen-ui.md.
//
// UI-14/UI-18 sind hier SOLL-Formulierungen (Owner-Entscheidung E4, PLAN-I18N-TESTS.md
// Abschnitt 7.0/4: "Agentensprache, serverseitig ins Widget-HTML gerendert" - beide Tests
// waren zuvor blockiert und sind jetzt entblockt) - abweichend von der Rohspezifikation in
// 12-sprachachsen-ui.md, die beide als gruenen Ist-Beleg fuer Kernfrage 2 formuliert (das
// war VOR der Owner-Entscheidung E4 geschrieben). Sie faellen heute rot: kein Mechanismus
// rendert die Widget-HTML server-seitig nach Tenant-/Agentensprache.
//
// UI-09 bleibt eine GRUENE Charakterisierung des heutigen Stands (Divergenz dreier
// Sprachachsen in EINER Karte) - siehe Kopfkommentar dort fuer die Ist-Pin-Falle, die
// bewusst vermieden wird.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../src/mcp-tools.js";
import { resolveLocale, WIDGET_DICT } from "../src/ui/widget-i18n.js";
import { widgetHtml, WIDGET_AGENT_STATUS } from "../src/ui/widget-catalog.js";
import { makeDefaultState, registerTenant, setTenantGeo, tenantGeo } from "../src/store/state-ops.js";

// ---- Mini-Harness (Muster test/mcp-tools.test.js, dupliziert - siehe dortiger Kommentar) ----
function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    tool(name, _desc, _schema, handler) {
      handlers.set(name, handler);
    },
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
    res.statusCode = 200;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((r) => server.close(r)),
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
    const transcriptResult = await handlers.get("get_transcript")({ call_id: "call_1" });

    const summary = transcriptResult.structuredContent.result_summary;
    assert.match(summary, /[éèàâîïôûç]/i, "Achse D traegt franzoesische Zeichen (Fixture-Beweis)");

    const lines = statusResult.structuredContent.last_transcript_lines;
    const calleeLine = lines.find((l) => l.includes("Bonjour, de quoi"));
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
    const calleeLineOther = statusResultOther.structuredContent.last_transcript_lines.find((l) =>
      l.includes("Bonjour, de quoi"),
    );
    assert.equal(
      calleeLineOther.split(":")[0],
      prefix,
      "Praefix bleibt invariant, egal welcher Tenant (unabhaengig von Achse D)",
    );
  });
});

// ==================== UI-14 ====================
// Kein Host-Signal fuer Chat-Sprache/Land im gesamten MCP-Wire-Vertrag (SOLL nach E4, P0).
//
// Owner-Entscheidung E4 (PLAN-I18N-TESTS.md 7.0/4): das Widget soll der AGENTENSPRACHE
// folgen, serverseitig ins Widget-HTML gerendert - NICHT einem Host-Signal. Das heisst: die
// Rendering-Pipeline (widgetHtml, ueber registerResource/enableWidgetUi aufgerufen) MUSS
// nach Sprache unterschiedliches HTML liefern koennen. Heute ignoriert widgetHtml() jeden
// Zusatzparameter (Funktion nimmt nur widgetId entgegen, WIDGET_HTML wird EINMAL beim
// Modul-Load gebaut) - byte-identisches HTML fuer jede Sprache.
// Beleg: src/ui/widget-catalog.js:126-150 (WIDGET_HTML einmalig beim Modul-Load gebaut,
// widgetHtml(widgetId) ohne Sprachparameter); src/ui/registry.js:43-50, src/ui/contract.js
// (komplett, keine Locale-Konstante), src/ui/widget-bind.js:177-191 (ui/initialize-Message
// ohne Locale-Feld) - kein Kanal traegt heute ueberhaupt eine Sprache in diese Pipeline.
test("UI-14: widgetHtml() liefert fuer verschiedene Agentensprachen byte-identisches HTML (kein Server-Rendering-Kanal)", () => {
  const htmlFr = widgetHtml(WIDGET_AGENT_STATUS, "fr");
  const htmlEn = widgetHtml(WIDGET_AGENT_STATUS, "en");
  assert.notEqual(
    htmlFr,
    htmlEn,
    "Nach E4 (Widget folgt Agentensprache, serverseitig gerendert) MUESSEN sich die " +
      "servergerenderten HTML-Ausgaben zwischen Sprachen unterscheiden - heute ignoriert " +
      "widgetHtml() jeden Sprachparameter vollstaendig",
  );
});

// ==================== UI-18 ====================
// "Land = Frankreich" ohne Browser-Locale-Wechsel aendert die Widget-Sprache NICHT
// (Owner-Anforderung woertlich: "franzoesisch, wenn er in Frankreich ist") (SOLL nach E4, P0).
//
// Der Server KENNT das Land/die Sprache des Tenants bereits (setTenantGeo/tenantGeo,
// src/store/state-ops.js:1187-1201) - das reicht aber nirgends bis in die servergerenderte
// Widget-HTML (siehe UI-14). Diese Owner-Anforderung ist damit strukturell unerfuellt.
// Beleg: src/store/state-ops.js:1187-1201 (setTenantGeo/tenantGeo); src/ui/widget-catalog.js
// (widgetHtml ohne Sprachparameter, s. UI-14).
test("UI-18: tenant.country=FR aendert die servergerenderte Widget-Sprache NICHT", () => {
  const s = makeDefaultState();
  registerTenant(s, "tenant_fr");
  setTenantGeo(s, "tenant_fr", { country: "FR", defaultLanguage: "fr" });
  const geo = tenantGeo(s, "tenant_fr");
  assert.equal(geo.country, "FR", "Server kennt das Land des Tenants");
  assert.equal(geo.defaultLanguage, "fr", "Server kennt die abgeleitete Sprache des Tenants");

  const htmlForTenant = widgetHtml(WIDGET_AGENT_STATUS, geo.defaultLanguage);
  const htmlDefault = widgetHtml(WIDGET_AGENT_STATUS);
  assert.notEqual(
    htmlForTenant,
    htmlDefault,
    "Land=FR (tenant.defaultLanguage=fr) MUESSTE die servergerenderte Widget-Sprache " +
      "aendern (Owner-Anforderung), tut es aber nicht - tenant.country/defaultLanguage " +
      "wird an keiner Stelle im Widget-Rendering-Pfad konsultiert",
  );
});
