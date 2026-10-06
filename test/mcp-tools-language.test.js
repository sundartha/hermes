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

const HTTP_OK = 200;

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((resolveClose) => server.close(resolveClose)) };
}

function sendJson(res, { body = null, status = HTTP_OK } = {}) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body == null ? "" : JSON.stringify(body));
}

async function startGatewayMock({ body = null, status = HTTP_OK } = {}) {
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
  return (result?.content || []).map((content) => content.text).join("\n");
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

test("requireFields-Fehler folgt der Tenant-Sprache; DE ist byte-identisch zum Bestand (ex MCP-04)", async () => {
  await withGateway({}, async () => {
    const handlersEn = captureTools({ identity: null, scopedTenant: "tenant-en-us", language: "en" });
    const resultEn = await handlersEn.get("list_calls")();
    assert.ok(resultEn?.isError, "degradierte Antwort -> isError-Tool-Antwort");
    assert.equal(toolText(resultEn), MCP_TEXTS.en.errors[MCP_ERROR_CODE.UPSTREAM_INCOMPLETE]);

    const handlersDe = captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" });
    const resultDe = await handlersDe.get("list_calls")();
    assert.equal(
      toolText(resultDe),
      "Der Telefon-Agent hat eine unvollstaendige Antwort geliefert. Bitte spaeter erneut versuchen.",
      "DE bleibt byte-identisch zum frueheren Inline-String",
    );
  });
});

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
        lines.some((line) => line.startsWith(prefix)),
        `Sprache ${language} muss das Rollen-Praefix "${prefix}" tragen`,
      );
    });
  }
});

function firstCallStartedAt(result) {
  const { calls } = result.structuredContent;
  return calls[0].startedAt;
}

test("list_calls formatiert startedAt nach dateLocale der Tenant-Sprache (ex FMT-03)", async () => {
  const calls = [{ id: "c1", direction: "outbound", to: "+491511234", status: "completed", startedAt: "2026-06-26T09:59:50.000Z" }];
  await withGateway({ calls }, async () => {
    const handlersDe = captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" });
    const resultDe = await handlersDe.get("list_calls")();
    const startedAtDe = firstCallStartedAt(resultDe);

    const handlersEn = captureTools({ identity: null, scopedTenant: "tenant-en", language: "en" });
    const resultEn = await handlersEn.get("list_calls")();
    const startedAtEn = firstCallStartedAt(resultEn);

    assert.match(startedAtDe, /\d{2}\.\d{2}\./, "de-DE-Format nutzt Punkt-Trenner");
    assert.match(startedAtEn, /\d{2}\/\d{2}/, "en-GB-Format nutzt Schraegstrich-Trenner");
    assert.notEqual(startedAtDe, startedAtEn, "unterschiedliche Sprachen formatieren unterschiedlich");
  });
});

test("mcp-tools.js traegt kein hartes de-DE-Literal mehr (ex PROMPT-09)", async () => {
  assert.doesNotMatch(MCP_TOOLS_SRC, /toLocaleString\("de-DE"/);
  await withGateway({}, async () => {
    const handlersDe = captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" });
    const handlersEn = captureTools({ identity: null, scopedTenant: "tenant-en", language: "en" });
    const textDe = toolText(await handlersDe.get("list_calls")());
    const textEn = toolText(await handlersEn.get("list_calls")());
    assert.notEqual(textDe, textEn, "dieselbe Fixture liefert unter de/en unterschiedliche Texte");
  });
});

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

test("Tenant mit language=de bleibt im MCP-Kanal deutsch, auch bei scharfem Weltdefault", async () => {
  setWorldDefaultLanguageEnabled(true);
  try {
    await withGateway({}, async () => {
      const handlers = captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" });
      const callsResult = await handlers.get("list_calls")();
      assert.equal(
        toolText(callsResult),
        "Der Telefon-Agent hat eine unvollstaendige Antwort geliefert. Bitte spaeter erneut versuchen.",
      );
    });
    await withGateway(RICH_CALL(CALL_LINES_EN), async () => {
      const handlers = captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" });
      const result = await handlers.get("get_call_status")({ call_id: "call_1" });
      assert.ok(result.structuredContent.last_transcript_lines.some((line) => line.startsWith("Gegenseite:")));
    });
  } finally {
    setWorldDefaultLanguageEnabled(false);
  }
});

test("unbekannte/leere Sprache faellt auf den EINEN Fallback (localeFor), nicht auf einen zweiten", async () => {
  const expected = localeFor(null).mcp.errors[MCP_ERROR_CODE.UPSTREAM_INCOMPLETE];
  for (const language of ["xx", "", null]) {
    await withGateway({}, async () => {
      const handlers = captureTools({ identity: null, scopedTenant: "tenant-unknown", language });
      const result = await handlers.get("list_calls")();
      assert.equal(toolText(result), expected, `language=${JSON.stringify(language)} muss auf localeFor(null) fallen`);
    });
  }
});

function assertErrorTextsComplete(texts, language) {
  for (const code of Object.values(MCP_ERROR_CODE)) {
    const entry = texts.errors[code];
    const rendered = typeof entry === "function" ? entry("feld") : entry;
    assert.ok(
      typeof rendered === "string" && rendered.length > 0,
      `Fehlertext fuer Code "${code}" fehlt in Sprache "${language}" (sonst landet der rohe Code im Chat)`,
    );
  }
}

function assertPermissionLabelsComplete(texts, language) {
  for (const key of ["summaries", "personalData", "bankData"])
    assert.ok(texts.permissionLabels?.[key], `permissionLabels.${key} fehlt fuer ${language}`);
}

function assertPlainTextsComplete(texts, language) {
  for (const key of [
    "emptyCalls",
    "callStillRunning",
    "emptyInbox",
    "inboxSummaryUnavailable",
    "callAlreadyRunningHint",
  ])
    assert.ok(
      typeof texts[key] === "string" && texts[key].length > 0,
      `${key} fehlt fuer ${language}`,
    );
}

function assertAgentStatusTextsComplete(texts, language) {
  for (const key of ["number", "owner", "calls", "permissions", "planUsageUnknown"])
    assert.ok(texts.agentStatus?.[key], `agentStatus.${key} fehlt fuer ${language}`);
  for (const key of ["planUsage"])
    assert.equal(
      typeof texts.agentStatus?.[key],
      "function",
      `agentStatus.${key} fehlt fuer ${language}`,
    );
}

test("MCP_TEXTS ist fuer jede unterstuetzte Sprache vollstaendig", () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const texts = MCP_TEXTS[language];
    assert.ok(texts, `MCP_TEXTS[${language}] fehlt`);
    assert.ok(texts.roleAgent, `roleAgent fehlt fuer ${language}`);
    assert.ok(texts.roleCounterparty, `roleCounterparty fehlt fuer ${language}`);
    assertErrorTextsComplete(texts, language);
    assertPermissionLabelsComplete(texts, language);
    assertPlainTextsComplete(texts, language);
    assertAgentStatusTextsComplete(texts, language);
    assert.equal(
      typeof texts.callFailedSummary,
      "function",
      `callFailedSummary fehlt fuer ${language}`,
    );
  }
});

test("/mcp loest die Sprache aus dem Tenant-Feld auf (Wiring, Spawn)", async () => {
  const seed = seedState({
    settings: { language: "en" },
    calls: [seedCall({ transcript: [{ role: "agent", text: "Hello" }, { role: "callee", text: "Hi" }] })],
  });
  const srv = await startServer({ seed });
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("get_call_status", { call_id: "call_test1" }));
    assert.equal(res.status, HTTP_OK);
    const result = await readToolResult(res);
    const lines = result.structuredContent.last_transcript_lines;
    assert.ok(lines.some((line) => line.startsWith("Other party: ")));
    assert.ok(!lines.some((line) => line.includes("Gegenseite")));
  } finally {
    await srv.stop();
  }
});

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
      const result = await captureTools({ identity: null, scopedTenant: `tenant-${language}`, language })
        .get("get_agent_status")();
      assert.doesNotMatch(result.structuredContent.permissions, /PersoenlicheDaten|Bankdaten/,
        `Sprache ${language} darf keine deutschen Feldnamen tragen`);
      assert.match(result.structuredContent.permissions,
        new RegExp(`^${MCP_TEXTS[language].permissionLabels.summaries}=true, `),
        "Wert kommt aus DEMSELBEN Locale-Buendel, kein zweiter Katalog");
    }
  });
});

test("list_calls: Leertext folgt der Tenant-Sprache; DE byte-identisch (P15/T3a)", async () => {
  await withGateway({ calls: [] }, async () => {
    const de = await captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" })
      .get("list_calls")();
    assert.equal(toolText(de), "Noch keine Anrufe.", "DE bleibt byte-identisch zum Bestand");
    for (const language of SUPPORTED_LANGUAGES) {
      const result = await captureTools({ identity: null, scopedTenant: `tenant-${language}`, language })
        .get("list_calls")();
      assert.equal(toolText(result), MCP_TEXTS[language].emptyCalls);
    }
  });
});

test("get_call_result bei laufendem Anruf: Hinweistext folgt der Tenant-Sprache (P15/T3a)", async () => {
  await withGateway({ status: "active" }, async () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const result = await captureTools({ identity: null, scopedTenant: `tenant-${language}`, language })
        .get("get_call_result")({ call_id: "call_1" });
      assert.equal(result.isError, true, `isError fuer Sprache ${language}`);
      assert.equal(toolText(result), MCP_TEXTS[language].callStillRunning);
    }
    const de = await captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" })
      .get("get_call_result")({ call_id: "call_1" });
    assert.equal(de.isError, true, "isError fuer DE");
    assert.equal(
      toolText(de),
      "Anruf laeuft noch. Bitte get_call_status pollen und spaeter erneut versuchen.",
      "der SATZ bleibt byte-identisch, die JSON-Huelle faellt weg (T-19)",
    );
  });
});

const AGENT_STATUS_TEXT_DE =
  "Agent-Nummer: +18643028341\n" +
  "Besitzer: Antonio\n" +
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
        const result = await captureTools({ identity: null, scopedTenant: `tenant-${language}`, language })
          .get("get_agent_status")();
        const text = toolText(result);
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

test("Bestandstests der MCP-Schicht decken ein EN-Sprachszenario ab (ex MCP-12)", () => {
  const files = ["mcp-tools.test.js", "mcp-ui.test.js", "mcp-ui-widget-i18n.test.js"];
  let hits = 0;
  for (const file of files) {
    const src = fs.readFileSync(path.join(ROOT, "test", file), "utf8");
    hits += (src.match(/language\s*[:=]\s*["']en/g) || []).length;
  }
  assert.ok(
    hits > 0,
    "kein bestehender Bestandstest deckt heute ein EN-/US-Sprachszenario der MCP-Schicht ab",
  );
});

test("list_action_items: Leertext + Termin-Praefix folgen der Tenant-Sprache; DE byte-identisch", async () => {
  await withGateway({ actionItems: [] }, async () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const result = await captureTools({ identity: null, scopedTenant: `tenant-${language}`, language })
        .get("list_action_items")();
      assert.equal(toolText(result), MCP_TEXTS[language].emptyActionItems);
    }
    const de = await captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" })
      .get("list_action_items")();
    assert.equal(toolText(de), "Keine offenen Action Items.", "DE bleibt byte-identisch");
  });
  await withGateway(
    { actionItems: [{ id: "a1", text: "Zahnarzt", type: "appointment", done: false }] },
    async () => {
      for (const language of SUPPORTED_LANGUAGES) {
        const result = await captureTools({ identity: null, scopedTenant: `tenant-${language}`, language })
          .get("list_action_items")();
        assert.equal(toolText(result), `${MCP_TEXTS[language].appointmentPrefix}Zahnarzt`);
      }
      const de = await captureTools({ identity: null, scopedTenant: "tenant-de", language: "de" })
        .get("list_action_items")();
      assert.equal(toolText(de), "(Termin) Zahnarzt", "DE bleibt byte-identisch (bis auf die entfallene ID)");
    },
  );
});
