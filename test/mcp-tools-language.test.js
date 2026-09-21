// P12 (MCP-Textkanal): Regressionssuite fuer die Sprachverzweigung der MCP-Tool-Schicht.
// Uebernimmt fuenf der sechs SOLL-Tests aus test/mcp-tools-i18n.test.js NACH deren
// gruenem Gate-Lauf (A3-Umzug, s. PLAN-I18N-FIX P12 Abschnitt 5.3) - Namenskonvention
// "beschreibender Name + (ex <ID>)" (Praezedenz: f1-geo-port.test.js, fmt-28-timezone-
// field.test.js). T7-T10 sind additiv (Regressionsschutz gegen P12 Pre-Mortem 1/2/3).
//
// ZWINGEND eine eigene Datei: MCP-12 (P13) zaehlt EN-Sprachfaelle NUR in genau
// test/mcp-tools.test.js, test/mcp-ui.test.js, test/mcp-ui-widget-i18n.test.js - neue
// EN-Faelle dort wuerden MCP-12 vorzeitig gruen faerben und P13 seinen Kanarienvogel
// stehlen.
//
// Harness-Muster (kopiert/angepasst aus test/mcp-tools-i18n.test.js; Dedup dort bereits
// begruendet, s. Kommentar in mcp-ui-i18n-divergence.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerTools } from "../src/mcp-tools.js";
import { config } from "../src/config.js";
import { localeFor, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { MCP_TEXTS, MCP_ERROR_CODE } from "../src/i18n/mcp-texts.js";
import { setWorldDefaultLanguageEnabled } from "../src/store/defaults.js";
import { makeConfigOverrides, startServer, seedState, seedCall, mcpPost, toolCall, readToolResult } from "./helpers.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { withConfig } = makeConfigOverrides(config);

// ---- geteilter Mini-Harness (Muster test/mcp-tools-i18n.test.js) ----

// server.tool(name, desc, schema, annotations, handler) seit E2 - Restparameter statt
// eines fuenften benannten Parameters (annotations sitzt an Position 4; max-params haelt).
function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    tool(name, _desc, _schema, ...rest) {
      handlers.set(name, rest.at(-1));
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

const MCP_TOOLS_SRC = fs.readFileSync(path.join(ROOT, "src", "mcp-tools.js"), "utf8");

const RICH_CALL = (lines) => ({
  status: "active",
  answeredAt: "2026-06-26T10:00:00.000Z",
  startedAt: "2026-06-26T09:59:50.000Z",
  transcript: lines,
});
const CALL_LINES_EN = [
  { role: "agent", text: "Hello, this is Hermes." },
  { role: "callee", text: "Hi, what is this about?" },
];

const AGENT_STATE_FIXTURE = {
  agent: { number: "+18643028341", owner: "Antonio", voiceEngine: "budget", model: "claude-haiku" },
  usage: { calls: 3, planUsagePercent: 40 },
  settings: { allowSummaries: true, allowPersonalData: false, allowBankData: false },
};

// ==================== T1 (ex MCP-04) ====================
test("requireFields-Fehler folgt der Tenant-Sprache; DE ist byte-identisch zum Bestand (ex MCP-04)", async () => {
  await withGateway({}, async () => {
    const handlersEn = captureTools({ identity: null, scopedTenant: "tenant-en-us", allowCalendar: true, language: "en" });
    const resultEn = await handlersEn.get("get_calendar")();
    assert.ok(resultEn?.isError, "degradierte Antwort -> isError-Tool-Antwort");
    assert.equal(toolText(resultEn), MCP_TEXTS.en.errors[MCP_ERROR_CODE.UPSTREAM_INCOMPLETE]);

    const handlersDe = captureTools({ identity: null, scopedTenant: "tenant-de", allowCalendar: true, language: "de" });
    const resultDe = await handlersDe.get("get_calendar")();
    assert.equal(
      toolText(resultDe),
      "Der Telefon-Agent hat eine unvollstaendige Antwort geliefert. Bitte spaeter erneut versuchen.",
      "DE bleibt byte-identisch zum frueheren Inline-String",
    );
  });
});

// ==================== T2 (ex MCP-06) ====================
test("Transkript-Rollen-Praefix folgt der Tenant-Sprache (ex MCP-06)", async () => {
  const cases = [
    ["en", "Other party:"],
    ["fr", "Interlocuteur:"],
    ["de", "Gegenseite:"],
  ];
  for (const [language, prefix] of cases) {
    await withGateway(RICH_CALL(CALL_LINES_EN), async () => {
      const handlers = captureTools({ identity: null, scopedTenant: `tenant-${language}`, language });
      const result = await handlers.get("get_call_status")({ call_id: "call_1" });
      const lines = result.structuredContent.last_transcript_lines;
      assert.ok(
        lines.some((l) => l.startsWith(prefix)),
        `Sprache ${language} muss das Rollen-Praefix "${prefix}" tragen`,
      );
    });
  }
});

// ==================== T3 (ex FMT-03) ====================
test("list_calls formatiert startedAt nach dateLocale der Tenant-Sprache (ex FMT-03)", async () => {
  const calls = [{ id: "c1", direction: "outbound", to: "+491511234", status: "completed", startedAt: "2026-06-26T09:59:50.000Z" }];
  await withGateway({ calls }, async () => {
    const handlersDe = captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" });
    const resultDe = await handlersDe.get("list_calls")();
    const startedAtDe = resultDe.structuredContent.calls[0].startedAt;

    const handlersEn = captureTools({ identity: null, scopedTenant: "tenant-en", language: "en" });
    const resultEn = await handlersEn.get("list_calls")();
    const startedAtEn = resultEn.structuredContent.calls[0].startedAt;

    // Zeitzonen-unabhaengige Formprobe (kein Uhrzeit-Pin): de-DE nutzt Punkt-Trenner,
    // en-GB Schraegstrich - der Unterschied belegt, dass dateLocale konsumiert wird.
    assert.match(startedAtDe, /\d{2}\.\d{2}\./, "de-DE-Format nutzt Punkt-Trenner");
    assert.match(startedAtEn, /\d{2}\/\d{2}/, "en-GB-Format nutzt Schraegstrich-Trenner");
    assert.notEqual(startedAtDe, startedAtEn, "unterschiedliche Sprachen formatieren unterschiedlich");
  });
});

// ==================== T4 (ex FMT-03 b) ====================
test("get_calendar formatiert start/end ueber denselben Formatter (ex FMT-03 b)", async () => {
  const calendar = [{ title: "Termin", start: "2026-06-26T09:59:50.000Z", end: "2026-06-26T10:30:00.000Z" }];
  await withGateway({ calendar }, async () => {
    const handlersDe = captureTools({ identity: null, scopedTenant: "tenant-de", allowCalendar: true, language: "de" });
    const resultDe = await handlersDe.get("get_calendar")();
    const startDe = resultDe.structuredContent.calendar[0].start;

    const handlersEn = captureTools({ identity: null, scopedTenant: "tenant-en", allowCalendar: true, language: "en" });
    const resultEn = await handlersEn.get("get_calendar")();
    const startEn = resultEn.structuredContent.calendar[0].start;

    assert.match(startDe, /\d{2}\.\d{2}\./);
    assert.match(startEn, /\d{2}\/\d{2}/);
    assert.notEqual(startDe, startEn);
  });
});

// ==================== T5 (ex PROMPT-09) ====================
test("mcp-tools.js traegt kein hartes de-DE-Literal mehr (ex PROMPT-09)", async () => {
  assert.doesNotMatch(MCP_TOOLS_SRC, /toLocaleString\("de-DE"/);
  await withGateway({}, async () => {
    const handlersDe = captureTools({ identity: null, scopedTenant: "tenant-de", allowCalendar: true, language: "de" });
    const handlersEn = captureTools({ identity: null, scopedTenant: "tenant-en", allowCalendar: true, language: "en" });
    const textDe = toolText(await handlersDe.get("get_calendar")());
    const textEn = toolText(await handlersEn.get("get_calendar")());
    assert.notEqual(textDe, textEn, "dieselbe Fixture liefert unter de/en unterschiedliche Texte");
  });
});

// ==================== T6 (ex MCP-08, KS-P8 umgebaut) ====================
// Die Praemisse von T6 (Belastungswaehrung im Textblock) entfaellt mit KS-P8/E4 - der
// Textblock nennt ueberhaupt keinen Kostenbetrag mehr. Statt geloescht wird der Test zum
// Waechter der neuen Zusage: schlaegt kuenftig rot, sobald irgendein Betrag/Waehrungslabel
// in genau diese Nutzer-Flaeche zurueckkehrt (Pre-Mortem 3 aus dem KS-P8-Plan). Kein
// Katalog-ID-Praefix am Namensanfang -> bleibt im npm test-Regressionslauf (Lehre
// catalog-id-prefix-misroutes-tests).
test("get_agent_status-Textblock nennt ueberhaupt keine Waehrung mehr (ex MCP-08, KS-P8/E4)", async () => {
  await withConfig("paymentCurrency", "usd", async () => {
    await withGateway(AGENT_STATE_FIXTURE, async () => {
      const handlers = captureTools({ identity: null, scopedTenant: "tenant-us" });
      const text = toolText(await handlers.get("get_agent_status")());
      assert.doesNotMatch(text, /\bEUR\b|\bUSD\b|€|\$/, "kein Kostenbetrag in der Nutzer-Sicht");
    });
  });
  await withConfig("paymentCurrency", "eur", async () => {
    await withGateway(AGENT_STATE_FIXTURE, async () => {
      const handlers = captureTools({ identity: null, scopedTenant: "tenant-eu" });
      const text = toolText(await handlers.get("get_agent_status")());
      assert.doesNotMatch(text, /\bEUR\b|\bUSD\b|€|\$/, "kein Kostenbetrag in der Nutzer-Sicht");
    });
  });
});

// ==================== T7 ====================
// Regressionsschutz gegen Pre-Mortem (1): der MCP-Textkanal darf NICHT ueber den
// Weltdefault aufgeloest werden - ein DE-Tenant bleibt deutsch, SELBST wenn der
// Weltdefault scharf auf "en" steht.
test("Tenant mit language=de bleibt im MCP-Kanal deutsch, auch bei scharfem Weltdefault", async () => {
  setWorldDefaultLanguageEnabled(true);
  try {
    await withGateway({}, async () => {
      const handlers = captureTools({ identity: null, scopedTenant: "tenant-de", allowCalendar: true, language: "de" });
      const resultCalendar = await handlers.get("get_calendar")();
      assert.equal(
        toolText(resultCalendar),
        "Der Telefon-Agent hat eine unvollstaendige Antwort geliefert. Bitte spaeter erneut versuchen.",
      );
    });
    await withGateway(RICH_CALL(CALL_LINES_EN), async () => {
      const handlers = captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" });
      const result = await handlers.get("get_call_status")({ call_id: "call_1" });
      assert.ok(result.structuredContent.last_transcript_lines.some((l) => l.startsWith("Gegenseite:")));
    });
  } finally {
    setWorldDefaultLanguageEnabled(false);
  }
});

// ==================== T8 ====================
test("unbekannte/leere Sprache faellt auf den EINEN Fallback (localeFor), nicht auf einen zweiten", async () => {
  const expected = localeFor(null).mcp.errors[MCP_ERROR_CODE.UPSTREAM_INCOMPLETE];
  for (const language of ["xx", "", null]) {
    await withGateway({}, async () => {
      const handlers = captureTools({ identity: null, scopedTenant: "tenant-unknown", allowCalendar: true, language });
      const result = await handlers.get("get_calendar")();
      assert.equal(toolText(result), expected, `language=${JSON.stringify(language)} muss auf localeFor(null) fallen`);
    });
  }
});

// ==================== T9 ====================
test("MCP_TEXTS ist fuer jede unterstuetzte Sprache vollstaendig", () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const texts = MCP_TEXTS[language];
    assert.ok(texts, `MCP_TEXTS[${language}] fehlt`);
    assert.ok(texts.roleAgent, `roleAgent fehlt fuer ${language}`);
    assert.ok(texts.roleCounterparty, `roleCounterparty fehlt fuer ${language}`);
    for (const code of Object.values(MCP_ERROR_CODE)) {
      assert.ok(
        typeof texts.errors[code] === "string" && texts.errors[code].length > 0,
        `Fehlertext fuer Code "${code}" fehlt in Sprache "${language}" (sonst landet der rohe Code im Chat)`,
      );
    }
    for (const key of ["summaries", "personalData", "bankData"])
      assert.ok(texts.permissionLabels?.[key], `permissionLabels.${key} fehlt fuer ${language}`);
    // P15/T3a: Leertexte + Feldnamen des get_agent_status-Blocks. Eine Luecke wuerde
    // "undefined" in einen tenant-sichtbaren Text rendern (G27: Struktur statt Disziplin).
    // INBOX-P3: emptyInbox/inboxSummaryUnavailable ergaenzt - ein fehlender Schluessel
    // schriebe "undefined" in genau die Antwort, die "kurz und eindeutig leer" sein soll.
    for (const key of [
      "emptyCalls",
      "emptyCalendar",
      "callStillRunning",
      "emptyInbox",
      "inboxSummaryUnavailable",
      // E3 (N-11): Dedup-Hinweis - eine Luecke schriebe "undefined" in den Textblock der
      // Antwort auf einen deduplizierten place_call.
      "callAlreadyRunningHint",
    ])
      assert.ok(
        typeof texts[key] === "string" && texts[key].length > 0,
        `${key} fehlt fuer ${language}`,
      );
    for (const key of ["number", "owner", "voiceEngine", "model", "calls", "permissions", "planUsageUnknown"])
      assert.ok(texts.agentStatus?.[key], `agentStatus.${key} fehlt fuer ${language}`);
    for (const key of ["planUsage"])
      assert.equal(
        typeof texts.agentStatus?.[key],
        "function",
        `agentStatus.${key} fehlt fuer ${language}`,
      );
    // OUTBOUND-E3a: ein fehlender callFailedSummary schriebe "undefined" in genau den
    // Text, der dem Nutzer erklaeren soll, warum sein Anruf nicht zustande kam.
    assert.equal(
      typeof texts.callFailedSummary,
      "function",
      `callFailedSummary fehlt fuer ${language}`,
    );
  }
});

// ==================== T10 (Verdrahtung, Spawn) ====================
test("/mcp loest die Sprache aus dem Tenant-Feld auf (Wiring, Spawn)", async () => {
  const seed = seedState({
    settings: { language: "en" },
    calls: [seedCall({ transcript: [{ role: "agent", text: "Hello" }, { role: "callee", text: "Hi" }] })],
  });
  const srv = await startServer({ seed });
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("get_call_status", { call_id: "call_test1" }));
    assert.equal(res.status, 200);
    const result = await readToolResult(res);
    const lines = result.structuredContent.last_transcript_lines;
    assert.ok(lines.some((l) => l.startsWith("Other party: ")));
    assert.ok(!lines.some((l) => l.includes("Gegenseite")));
  } finally {
    await srv.stop();
  }
});

// ==================== T11 (ex MCP-09) ====================
// Die Feldnamen der Berechtigungs-Zusammenfassung folgen der Tenant-Sprache. DE bleibt
// byte-identisch (derselbe String, den test/mcp-ui.test.js als Widget-Wert pinnt).
test("permissionsSummary-Feldnamen folgen der Tenant-Sprache; DE byte-identisch (ex MCP-09)", async () => {
  await withGateway(AGENT_STATE_FIXTURE, async () => {
    const de = await captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" })
      .get("get_agent_status")();
    assert.equal(
      de.structuredContent.permissions,
      "Summaries=true, PersoenlicheDaten=false, Bankdaten=false",
      "DE bleibt byte-identisch zum Bestand",
    );
    for (const language of ["en", "fr"]) {
      const r = await captureTools({ identity: null, scopedTenant: `tenant-${language}`, language })
        .get("get_agent_status")();
      assert.doesNotMatch(r.structuredContent.permissions, /PersoenlicheDaten|Bankdaten/,
        `Sprache ${language} darf keine deutschen Feldnamen tragen`);
      assert.match(r.structuredContent.permissions,
        new RegExp(`^${MCP_TEXTS[language].permissionLabels.summaries}=true, `),
        "Wert kommt aus DEMSELBEN Locale-Buendel, kein zweiter Katalog");
    }
  });
});

// ==================== T13 (P15/T3a) ====================
// Die Leer-/Zwischenzustaende der Tool-Antworten sind tenant-sichtbarer Text und folgen
// derselben Sprache wie Rollen-Praefix und Fehlertexte (loc.mcp) - kein zweiter Katalog.
test("list_calls: Leertext folgt der Tenant-Sprache; DE byte-identisch (P15/T3a)", async () => {
  await withGateway({ calls: [] }, async () => {
    const de = await captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" })
      .get("list_calls")();
    assert.equal(toolText(de), "Noch keine Anrufe.", "DE bleibt byte-identisch zum Bestand");
    for (const language of SUPPORTED_LANGUAGES) {
      const r = await captureTools({ identity: null, scopedTenant: `tenant-${language}`, language })
        .get("list_calls")();
      assert.equal(toolText(r), MCP_TEXTS[language].emptyCalls);
    }
  });
});

// ==================== T14 (P15/T3a) ====================
test("get_calendar: Leertext folgt der Tenant-Sprache; DE byte-identisch (P15/T3a)", async () => {
  await withGateway({ calendar: [] }, async () => {
    const de = await captureTools({ identity: null, scopedTenant: "tenant-de", allowCalendar: true, language: "de" })
      .get("get_calendar")();
    assert.equal(toolText(de), "Kalender ist leer.", "DE bleibt byte-identisch zum Bestand");
    for (const language of SUPPORTED_LANGUAGES) {
      const r = await captureTools({ identity: null, scopedTenant: `tenant-${language}`, allowCalendar: true, language })
        .get("get_calendar")();
      assert.equal(toolText(r), MCP_TEXTS[language].emptyCalendar);
    }
  });
});

// ==================== T15 (P15/T3a) ====================
test("get_transcript bei laufendem Anruf: Hinweistext folgt der Tenant-Sprache (P15/T3a)", async () => {
  await withGateway({ status: "active" }, async () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const r = await captureTools({ identity: null, scopedTenant: `tenant-${language}`, language })
        .get("get_transcript")({ call_id: "call_1" });
      // T-19: der Satz bleibt byte-identisch, die JSON-Huelle faellt weg - errText()
      // setzt isError statt eines {"error": ...}-Textblocks (siehe src/mcp-tools.js).
      assert.equal(r.isError, true, `isError fuer Sprache ${language}`);
      assert.equal(toolText(r), MCP_TEXTS[language].callStillRunning);
    }
    const de = await captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" })
      .get("get_transcript")({ call_id: "call_1" });
    assert.equal(de.isError, true, "isError fuer DE");
    assert.equal(
      toolText(de),
      "Anruf laeuft noch. Bitte get_call_status pollen und spaeter erneut versuchen.",
      "der SATZ bleibt byte-identisch, die JSON-Huelle faellt weg (T-19)",
    );
  });
});

// ==================== T16 (P15/T3a) ====================
// Der get_agent_status-Textblock traegt die Feldnamen der Tenant-Sprache. Der DE-Block ist
// VOLLSTAENDIG byte-identisch zum Bestand (voller String-Vergleich, nicht nur Stichprobe).
const AGENT_STATUS_TEXT_DE =
  "Agent-Nummer: +18643028341\n" +
  "Besitzer: Antonio\n" +
  "Voice-Engine: budget\n" +
  "Modell: claude-haiku\n" +
  "Calls bisher: 3\n" +
  "Monatsnutzung: 40 % des Minuten-Kontingents\n" +
  "Berechtigungen: Summaries=true, PersoenlicheDaten=false, Bankdaten=false";

test("get_agent_status-Textblock: Feldnamen folgen der Sprache; DE byte-identisch (P15/T3a)", async () => {
  await withConfig("paymentCurrency", "eur", async () => {
    await withGateway(AGENT_STATE_FIXTURE, async () => {
      const de = await captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" })
        .get("get_agent_status")();
      assert.equal(toolText(de), AGENT_STATUS_TEXT_DE, "DE-Textblock byte-identisch zum Bestand");

      for (const language of ["en", "fr"]) {
        const r = await captureTools({ identity: null, scopedTenant: `tenant-${language}`, language })
          .get("get_agent_status")();
        const text = toolText(r);
        const labels = MCP_TEXTS[language].agentStatus;
        assert.match(text, new RegExp(`^${labels.number}: `), `${language}: uebersetztes Nummern-Label`);
        assert.ok(text.includes(`\n${labels.permissions}: `), `${language}: uebersetztes Berechtigungs-Label`);
        assert.doesNotMatch(
          text,
          /Agent-Nummer|Besitzer|Modell|Berechtigungen|Monatsnutzung/,
          `${language}: keine deutschen Feldnamen im Textblock`,
        );
      }
    });
  });
});

// ==================== T17 (P15/T3a) ====================
// registerTools OHNE language-Argument (stdio-Transport, der keinen Store hat) faellt auf
// den EINEN Fallback localeFor(null) = Weltdefault - nicht auf ein hartes "de".
test("registerTools ohne language-Argument nutzt den Weltdefault (P15/T3a)", async () => {
  setWorldDefaultLanguageEnabled(true);
  try {
    await withGateway({ calls: [] }, async () => {
      const result = await captureTools({}).get("list_calls")();
      assert.equal(toolText(result), MCP_TEXTS.en.emptyCalls);
    });
  } finally {
    setWorldDefaultLanguageEnabled(false);
  }
});

// ==================== T12 (ex MCP-12) ====================
// Kanarienvogel: die drei Bestands-Testdateien der MCP-Schicht decken mindestens ein
// EN-Sprachszenario ab. Bleibt als DAUERHAFTER Waechter stehen (nicht abgesenkt, nicht
// geloescht): faellt die EN-Abdeckung dort je wieder heraus, schlaegt er rot.
test("Bestandstests der MCP-Schicht decken ein EN-Sprachszenario ab (ex MCP-12)", () => {
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

// ==================== T16 (P10/MCP-14) ====================
// Leertext UND Termin-Praefix von list_action_items folgen der Tenant-Sprache; DE bleibt
// byte-identisch zum frueheren Inline-String. Die Schleife ueber SUPPORTED_LANGUAGES ist
// zugleich die Vollstaendigkeitsprobe: ein fehlender Buendel-Schluessel wuerde
// "undefined" in tenant-sichtbaren Text rendern und hier scheitern.
test("list_action_items: Leertext + Termin-Praefix folgen der Tenant-Sprache; DE byte-identisch", async () => {
  await withGateway({ actionItems: [] }, async () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const r = await captureTools({ identity: null, scopedTenant: `tenant-${language}`, language })
        .get("list_action_items")();
      assert.equal(toolText(r), MCP_TEXTS[language].emptyActionItems);
    }
    const de = await captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" })
      .get("list_action_items")();
    assert.equal(toolText(de), "Keine offenen Action Items.", "DE bleibt byte-identisch");
  });
  await withGateway(
    { actionItems: [{ id: "a1", text: "Zahnarzt", type: "appointment", done: false }] },
    async () => {
      for (const language of SUPPORTED_LANGUAGES) {
        const r = await captureTools({ identity: null, scopedTenant: `tenant-${language}`, language })
          .get("list_action_items")();
        assert.equal(toolText(r), `[a1] ${MCP_TEXTS[language].appointmentPrefix}Zahnarzt`);
      }
      const de = await captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" })
        .get("list_action_items")();
      assert.equal(toolText(de), "[a1] (Termin) Zahnarzt", "DE bleibt byte-identisch");
    },
  );
});

// ==================== T17 (P10/MCP-14) ====================
// Die befuellte get_calendar-Zeile folgt der Tenant-Sprache (nicht nur der Leertext), und
// der Verbinder kommt aus DEMSELBEN Buendel wie die Zeitwerte aus demselben Formatter.
test("get_calendar: die befuellte Zeile folgt der Tenant-Sprache; DE byte-identisch", async () => {
  const calendar = [
    { title: "Zahnarzt", start: "2026-06-26T09:59:50.000Z", end: "2026-06-26T10:30:00.000Z" },
  ];
  await withGateway({ calendar }, async () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const r = await captureTools({
        identity: null,
        scopedTenant: `tenant-${language}`,
        allowCalendar: true,
        language,
      }).get("get_calendar")();
      const e = r.structuredContent.calendar[0];
      assert.equal(toolText(r), MCP_TEXTS[language].calendarLine(e));
    }
    const de = await captureTools({
      identity: null,
      scopedTenant: "tenant-de",
      allowCalendar: true,
      language: "de",
    }).get("get_calendar")();
    assert.match(toolText(de), /^Zahnarzt: .+ bis .+$/, "DE bleibt byte-identisch (title: start bis end)");
    const en = await captureTools({
      identity: null,
      scopedTenant: "tenant-en",
      allowCalendar: true,
      language: "en",
    }).get("get_calendar")();
    assert.doesNotMatch(toolText(en), / bis /, "EN traegt keinen deutschen Verbinder");
  });
});
