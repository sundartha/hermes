// i18n-Launch-Testkatalog, Block B3 (MCP-Schicht und Widgets).
// Katalog-IDs in dieser Datei: PROMPT-09, FMT-03, MCP-04, MCP-05, MCP-06, MCP-08, MCP-09,
// MCP-12. Spezifikation: tasks/i18n-tests/02-llm-prompts.md (PROMPT-09),
// tasks/i18n-tests/10-zeit-format-daten.md (FMT-03), tasks/i18n-tests/04-mcp-und-widgets.md
// (MCP-04..MCP-12). Polaritaet je Test steht im Kopfkommentar des jeweiligen Testfalls.
//
// Alle Tests hier sind SOLL-Formulierungen (Regel R1 aus tasks/i18n-tests/00-kanonische-
// liste.md: bei Polaritaets-Konflikt gewinnt die SOLL-Fassung) und damit Launch-Gates, KEINE
// Charakterisierungstests. Sie faellen heute rot - das ist der Befund, nicht ein Fehler
// dieser Datei. Kein Produktionscode wird angefasst (Auftrag B3).
//
// Harness-Muster (kopiert/angepasst aus test/mcp-tools.test.js + test/mcp-ui.test.js -
// beide Dateien gehoeren NICHT zu diesem Block und werden nicht editiert).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerTools } from "../src/mcp-tools.js";
import { config } from "../src/config.js";
import { makeConfigOverrides } from "./helpers.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { withConfig } = makeConfigOverrides(config);

// ---- geteilter Mini-Harness (Muster test/mcp-tools.test.js) ----

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

async function listen(server) {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((r) => server.close(r)) };
}

function sendJson(res, { body = null, status = 200 } = {}) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(body == null ? "" : JSON.stringify(body));
}

async function startGatewayMock({ body = null, status = 200 } = {}) {
  const server = http.createServer((req, res) => sendJson(res, { body, status }));
  return listen(server);
}

async function withGateway(body, fn) {
  const mock = await startGatewayMock({ body });
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

function toolText(result) {
  return (result?.content || []).map((c) => c.text).join("\n");
}

// Quelltext einmal gelesen (statische Grep-Tests brauchen kein Netz/keinen Mock).
const MCP_TOOLS_SRC = fs.readFileSync(path.join(ROOT, "src", "mcp-tools.js"), "utf8");

// ==================== PROMPT-09 ====================
// mcp-tools.js verzweigt nach Sprache (Leittest des Clusters D28, SOLL).
//
// 00-kanonische-liste.md fuehrt D28 ("mcp-tools.js unlokalisiert") ausdruecklich als
// SOLL (rot) mit PROMPT-09 als Leittest - die Rohspezifikation in 02-llm-prompts.md
// formuliert PROMPT-09 selbst als Ist-Pin ("0 Treffer" ist heute gruen); nach Regel R1
// (Polaritaets-Konflikt -> SOLL gewinnt) wird hier die SOLL-Fassung umgesetzt: die Datei
// MUSS irgendeine Sprach-/Locale-Verzweigung enthalten (loc()/localeFor/call.language/
// settings.language), sonst bleibt JEDE Tool-Ausgabe unabhaengig von Tenant-/Anrufsprache.
test("PROMPT-09: mcp-tools.js verzweigt nach Sprache (loc()/localeFor/call.language/settings.language)", () => {
  const hits = (MCP_TOOLS_SRC.match(/loc\(|localeFor|call\.language|settings\.language/g) || [])
    .length;
  assert.ok(
    hits > 0,
    "mcp-tools.js MUSS mindestens eine Sprachverzweigung enthalten (heute 0 Treffer - " +
      "jede Tool-Beschreibung/jeder Text ist unabhaengig von Tenant-/Anrufsprache)",
  );
});

// ==================== FMT-03 ====================
// mcp-tools fmt() ist hart "de-DE" verdrahtet, nicht sprachabhaengig (SOLL, D13-Leittest).
// src/mcp-tools.js:48-55 (fmt); src/i18n/locales.js:98,170,219 (dateLocale existiert
// bereits je Sprache); src/claude.js:43 (nutzt dateLocale bereits fuer denselben Zweck -
// der Fix braucht keine neue Infrastruktur, nur einen Konsumenten in mcp-tools.js).
test("FMT-03: fmt() konsumiert dateLocale/localeFor statt hart 'de-DE'", () => {
  assert.match(
    MCP_TOOLS_SRC,
    /toLocaleString\("de-DE"/,
    'Beleg der Wurzel: Zeile 49 traegt heute das Literal "de-DE"',
  );
  const localeHits = (MCP_TOOLS_SRC.match(/localeFor|dateLocale/g) || []).length;
  assert.ok(
    localeHits > 0,
    "fmt() MUSS localeFor()/dateLocale konsumieren, damit list_calls/get_calendar " +
      "sprachabhaengig formatieren (heute 0 Treffer - fmt() ignoriert das existierende Feld)",
  );
});

// ==================== MCP-04 ====================
// requireFields-Fehlermeldungen sind fest Deutsch und laufen 1:1 in den Chat (SOLL, P0).
// Beleg: src/mcp-tools.js:63-82 (requireFields), :65-67, :77-79.
test("MCP-04: requireFields-Fehlermeldung bleibt fuer einen EN-Tenant nicht Deutsch", async () => {
  await withGateway({}, async () => {
    // leerer Gateway-Body ({}) -> requireFields({calendar:"array"}) schlaegt fehl (wie
    // T-P4-06 in test/mcp-tools.test.js, hier aber mit scopedTenant eines EN-Tenants).
    const handlers = captureTools({
      identity: null,
      scopedTenant: "tenant-en-us",
      allowCalendar: true,
    });
    const result = await handlers.get("get_calendar")();
    assert.ok(result?.isError, "degradierte Antwort -> isError-Tool-Antwort");
    assert.doesNotMatch(
      toolText(result),
      /Telefon-Agent hat (keine gueltige|eine unvollstaendige) Antwort geliefert/,
      "EN-Tenant darf keine deutsche requireFields-Meldung im Chat sehen",
    );
  });
});

// ==================== MCP-05 ====================
// wrapHandler-Catch-Fallback bei Netzwerkfehler ist fest Deutsch (SOLL, P0).
// Beleg: src/mcp-tools.js:333-344 (wrapHandler), :339-342.
//
// MESSUNG WEICHT VON DER KATALOG-ANNAHME AB (siehe Report/meldungen): der Katalog geht
// davon aus, dass ein ECONNREFUSED den deutschen Fallback ("... nicht erreichbar ...")
// auslaest, weil err?.message dann leer sei. Empirisch (dieser Node/undici-Stand) wirft
// fetch() bei einem nicht erreichbaren Host ein TypeError mit err.message === "fetch
// failed" - NIE leer. err?.message || FALLBACK greift damit nie den deutschen String,
// sondern reicht "fetch failed" (englisch, aber ein roher technischer String) durch. Der
// Test bleibt an der spezifizierten SOLL-Assertion (kein deutscher Fallback-Text fuer den
// EN-Tenant) - diese Assertion ist nach der Messung GRUEN, nicht rot wie im Katalog
// vorhergesagt (Polaritaets-Abweichung, siehe Report).
test("MCP-05: wrapHandler-Fallback bei Netzwerkfehler zeigt einem EN-Tenant keinen deutschen Text", async () => {
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = "http://127.0.0.1:1"; // kein lauschender Server -> ECONNREFUSED
  try {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant-en-us" });
    const result = await handlers.get("get_my_number")();
    assert.ok(result?.isError, "Netzwerkfehler -> isError-Tool-Antwort");
    assert.doesNotMatch(
      toolText(result),
      /nicht erreichbar/,
      "EN-Tenant darf keinen deutschen Fallback-Text sehen",
    );
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
  }
});

// ==================== MCP-06 ====================
// "Gegenseite:"-Praefix in Transkriptzeilen ist sprachunabhaengig hart Deutsch (SOLL, P0).
// Beleg: src/mcp-tools.js:103-115 (pickCallStatus), :108-110.
const RICH_CALL_EN = {
  status: "active",
  answeredAt: "2026-06-26T10:00:00.000Z",
  startedAt: "2026-06-26T09:59:50.000Z",
  transcript: [
    { role: "agent", text: "Hello, this is Hermes." },
    { role: "callee", text: "Hi, what is this about?" },
  ],
};
test("MCP-06: last_transcript_lines traegt fuer einen EN-Tenant kein 'Gegenseite:'-Praefix", async () => {
  await withGateway(RICH_CALL_EN, async () => {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant-en-us" });
    const result = await handlers.get("get_call_status")({ call_id: "call_1" });
    const lines = result.structuredContent.last_transcript_lines;
    assert.ok(
      !lines.some((l) => l.includes("Gegenseite")),
      "EN-Tenant darf kein deutsches Rollen-Praefix im Transkript sehen",
    );
  });
});

// ==================== MCP-08 ====================
// get_agent_status zeigt Kosten immer als "EUR", unabhaengig von paymentCurrency (SOLL, P0).
// Beleg: src/mcp-tools.js:707-710; src/config.js:362 (paymentCurrency, Default "eur").
const AGENT_STATE_FIXTURE = {
  agent: { number: "+18643028341", owner: "Antonio", voiceEngine: "budget", model: "claude-haiku" },
  usage: {
    calls: 3,
    costEur: 2.1,
    tenantCapEur: 10,
    spendMonthCostEur: 0.6,
    spendMonthKey: "2026-07",
    reservedEur: 0.6,
  },
  settings: { allowSummaries: true, allowPersonalData: false, allowBankData: false },
};
test("MCP-08: get_agent_status-Textblock zeigt USD, wenn paymentCurrency=usd konfiguriert ist", async () => {
  // config.js ist ein Singleton-Import (liest process.env beim Modul-Load) - withConfig
  // (test/helpers.js, makeConfigOverrides) mutiert das bereits geladene Objekt direkt statt
  // auf einen frischen Prozess-Restart angewiesen zu sein (Hinweis aus der Spezifikation).
  await withConfig("paymentCurrency", "usd", async () => {
    await withGateway(AGENT_STATE_FIXTURE, async () => {
      const handlers = captureTools({ identity: null, scopedTenant: "tenant-us" });
      const result = await handlers.get("get_agent_status")();
      const text = toolText(result);
      assert.doesNotMatch(text, /\bEUR\b/, "bei paymentCurrency=usd darf kein EUR-Label erscheinen");
      assert.match(text, /\bUSD\b/, "bei paymentCurrency=usd muss USD im Textblock stehen");
    });
  });
});

// ==================== MCP-09 ====================
// permissionsSummary() liefert deutsche Feldnamen, byte-gepinnt als Sollzustand (SOLL, P0).
// Beleg: src/mcp-tools.js:194-199 (permissionsSummary); test/mcp-ui.test.js:682
// (bestehender, GRUENER Pin auf denselben deutschen String - NICHT Teil dieses Blocks,
// bleibt unangetastet; ein spaeterer Fix muss ihn explizit mit anpassen, siehe Katalog).
test("MCP-09: structuredContent.permissions traegt fuer einen EN-Tenant keine deutschen Feldnamen", async () => {
  await withGateway(AGENT_STATE_FIXTURE, async () => {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant-en-us" });
    const result = await handlers.get("get_agent_status")();
    assert.doesNotMatch(
      result.structuredContent.permissions,
      /PersoenlicheDaten|Bankdaten/,
      "EN-Tenant darf keine deutschen Berechtigungs-Feldnamen sehen",
    );
  });
});

// ==================== MCP-12 ====================
// Kanarien-Test: keine bestehende Testdatei prueft ein EN-/US-Szenario der MCP-Schicht
// (SOLL, P0, als Gate gedacht - bewusst so konstruiert, dass er erst gruen wird, sobald
// echte EN-Testfaelle in den dort GENANNTEN Bestandsdateien existieren; diese Datei zaehlt
// nicht mit, weil der Katalog explizit die drei folgenden Bestandsdateien benennt).
// Beleg: test/mcp-tools.test.js, test/mcp-ui.test.js, test/mcp-ui-widget-i18n.test.js
// (alle drei NICHT Teil dieses Blocks - nur gelesen, nicht editiert).
test("MCP-12: Bestandstests (mcp-tools/mcp-ui/mcp-ui-widget-i18n) enthalten mindestens einen EN-Sprachfall", () => {
  const files = ["mcp-tools.test.js", "mcp-ui.test.js", "mcp-ui-widget-i18n.test.js"];
  let hits = 0;
  for (const f of files) {
    const src = fs.readFileSync(path.join(ROOT, "test", f), "utf8");
    hits += (src.match(/language\s*[:=]\s*["']en/g) || []).length;
  }
  assert.ok(
    hits > 0,
    "kein bestehender Bestandstest deckt heute ein EN-/US-Sprachszenario der MCP-Schicht ab",
  );
});
