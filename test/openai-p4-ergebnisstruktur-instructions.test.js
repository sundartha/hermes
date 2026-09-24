// P4 (T-19, T-20, T-21, O-27 Teil 1): zwei echte Defekte + der Instruktionstext.
//
// T-19/T-20: ein Werkzeug mit outputSchema darf NIE ohne structuredContent UND ohne
// isError zurueckkehren - sonst wirft der SDK-Validator "Output validation error" und
// der Client sieht die Systemmeldung statt der eigentlichen Antwort. Faelle 1+2.
//
// T-21/O-27: die Server-instructions sind IMMER gesetzt (auch ohne Consult-Freigabe,
// auch ueber stdio), das Wichtigste (der not-placed-Wiederhol-Riegel) steht in den
// ersten 512 Zeichen, und die Aufzaehlung fremder Werkzeugklassen
// ("calendar, mail, files, this chat") ist gestrichen. Faelle 3-6.
//
// Doppelte Pfade: Fall 1/4 pruefen HTTP /mcp, Fall 5 den echten stdio-Kindprozess,
// Fall 2/3/6 die geteilte Quelle beider Transporte.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerTools } from "../src/mcp-tools.js";
import {
  MCP_BASE_INSTRUCTIONS,
  MCP_CONSULT_INSTRUCTIONS,
  mcpServerOptions,
} from "../src/mcp-server-info.js";
import { NOT_PLACED } from "../src/telephony/failure-reason.js";
import { MCP_TEXTS } from "../src/i18n/mcp-texts.js";
import {
  startServer,
  seedState,
  seedCall,
  mcpPost,
  toolCall,
  readToolResult,
  ROOT,
  BASE_ENV,
  TOOLS_WITH_OUTPUT_SCHEMA,
} from "./helpers.js";

// Vollstaendiger initialize-Body: die SDK-Schema-Pruefung verlangt protocolVersion/
// capabilities/clientInfo (Muster test/mcp-server-icon.test.js, empirisch verifiziert).
const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test-client", version: "0.0.1" },
  },
};

function toolResultText(result) {
  return (result?.content || []).map((block) => block.text).join("\n");
}

// ==================== Fall 1 (Abnahmekriterium 1) ====================
test('P4 (T-19/T-20): get_call_result bei laufendem Anruf liefert isError + den lokalisierten Satz, nicht "Output validation error"', async () => {
  // Sprache explizit gesetzt (statt aus dem Weltdefault abgeleitet): DEFAULT_LANGUAGE
  // ist ein modul-globaler Schalter (src/store/defaults.js), den config.js beim ERSTEN
  // Import auf den WORLD_DEFAULT_LANGUAGE_ENABLED-Wert DIESES Testprozesses dreht - das
  // waere ein zweiter, unabhaengiger Env-Pfad neben BASE_ENV des gespawnten Servers und
  // liesse den erwarteten Text vom Testprozess-Env abhaengen statt vom Server-Verhalten.
  const seed = seedState({
    calls: [seedCall({ id: "call_active1" })],
    settings: { language: "de" },
  });
  const srv = await startServer({ seed });
  try {
    const res = await mcpPost(
      `${srv.localUrl}/mcp`,
      null,
      toolCall("get_call_result", { call_id: "call_active1" }),
    );
    const result = await readToolResult(res);
    assert.equal(result.isError, true, "laufender Anruf ist ein Fehlerergebnis im MCP-Sinn");
    // Die Assertion geht auf den TEXTINHALT, nicht nur auf isError - sonst waere der
    // Bestandsdefekt (der ebenfalls isError:true liefert, aber "Output validation
    // error" als Text) von der Reparatur nicht unterscheidbar.
    assert.equal(toolResultText(result), MCP_TEXTS.de.callStillRunning);
    assert.doesNotMatch(toolResultText(result), /Output validation error/);
  } finally {
    await srv.stop();
  }
});

// ==================== Fall 2 (Abnahmekriterium 2) ====================
// Faengt registerTool(name, config, handler) EINGESCHLOSSEN config ein - die Pruefmenge
// entsteht aus der GELIEFERTEN Registrierung, nicht aus einer gepflegten Namensliste
// (Lehre pruefkommando-ohne-positiv-kontrolle: ohne Erfolgslauf waere der Test gruen,
// obwohl jeder Handler nur noch Fehler liefert).
function captureToolsWithConfig(ctx) {
  const registrations = new Map();
  const fakeServer = {
    registerTool(name, config, handler) {
      registrations.set(name, { config, handler });
    },
    registerResource() {},
  };
  registerTools(fakeServer, ctx);
  return registrations;
}

// G25: kein Magic-Number-Literal fuer den Erfolgsstatus des Gateway-Mocks.
const HTTP_OK = 200;

// Lokaler Gateway-Mock, GATEWAY_URL wird zur Aufrufzeit gelesen (resolveGatewayUrl in
// mcp-tools.js) - Muster test/mcp-tools.test.js. body:null -> leerer 200-Body -> api()
// degradiert via res.json().catch zu {} (der still-degradierte Pfad, ueber den die
// meisten Handler ihre requireFields()-Pruefung werfen).
async function withMock({ body = null, status = HTTP_OK } = {}, run) {
  const server = http.createServer((req, res) => {
    // writeHead() statt res.statusCode=/res.setHeader() Property-Zuweisungen (F2,
    // no-param-reassign): ein Methodenaufruf auf dem Parameter ist keine Mutation
    // seiner Properties.
    res.writeHead(status, { "content-type": "application/json" });
    res.end(body == null ? "" : JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const prev = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = url;
  try {
    await run();
  } finally {
    if (prev === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = prev;
    await new Promise((resolve) => server.close(resolve));
  }
}

// Ein Antwortkoerper je Werkzeug, mit dem der Handler OHNE Fehler durchlaeuft
// (Erfolgslauf/Positiv-Kontrolle). Leere Listen sind gueltige Erfolgsfaelle (list_calls
// etc. behandeln [] als validen, nicht-fehlerhaften Zustand - s. requireFields: Existenz/
// Typ wird geprueft, nicht Nicht-Leere).
const SUCCESS_BODY_OF = new Map([
  ["place_call", { callId: "call_success_place" }],
  ["await_call_event", { event: "none", eventId: null, questions: [] }],
  ["answer_consult", { merged_facts: 1 }],
  [
    "get_call_status",
    { status: "in_progress", transcript: [], startedAt: new Date().toISOString() },
  ],
  [
    "get_call_result",
    { status: "completed", transcript: [], summary: "Alles erledigt.", objectiveAchieved: true },
  ],
  ["get_agent_number", { agent: { number: "+491511234567" } }],
  ["list_calls", { calls: [] }],
  ["check_inbox", { entries: [], remaining: 0 }],
  ["get_agent_status", { agent: {}, usage: {}, settings: {} }],
]);

// Eingabeargumente je Werkzeug (Handler-Aufruf, kein Zod-Parsing - der Fake-Server
// reicht sie unveraendert durch, wie captureTools() in test/mcp-tools.test.js).
const ARGS_OF = new Map([
  ["place_call", { to: "+491511234567", objective: "Termin vereinbaren" }],
  ["await_call_event", { call_id: "call_1" }],
  ["answer_consult", { call_id: "call_1", event_id: "evt_1", status: "final", answers: ["ok"] }],
  ["get_call_status", { call_id: "call_1" }],
  ["get_call_result", { call_id: "call_1" }],
  ["get_agent_number", {}],
  ["list_calls", {}],
  ["check_inbox", { include_seen: false }],
  ["get_agent_status", {}],
]);

// Werkzeuge, deren Fehlerlauf NICHT ueber einen leeren Body (body:null -> {}) ausloest:
// await_call_event/answer_consult rufen kein requireFields() auf ihrem Ergebnis (die
// Payoff-Felder sind bei event="none"/status="working" strukturell optional befuellt) -
// sie werfen erst bei einem echten Gateway-Fehler (5xx, s. api()/err.httpStatus).
const ERROR_MOCK_OVERRIDE_OF = new Map([
  ["await_call_event", { body: { error: "boom" }, status: 500 }],
  ["answer_consult", { body: { error: "boom" }, status: 500 }],
]);

test("P4 (T-19/T-20 Regel): jedes Werkzeug mit outputSchema liefert in jedem Rueckgabepfad structuredContent ODER isError", async () => {
  const registrations = captureToolsWithConfig({
    identity: null,
    scopedTenant: null,
    consultAllowed: true,
    language: null,
  });
  const withSchema = new Map(
    [...registrations].filter(([, { config }]) => config.outputSchema),
  );
  assert.equal(
    withSchema.size,
    TOOLS_WITH_OUTPUT_SCHEMA,
    "die Pruefmenge entsteht aus der gelieferten Registrierung, nicht aus einer Namensliste",
  );

  for (const [name, { handler }] of withSchema) {
    assert.ok(
      ARGS_OF.has(name) && SUCCESS_BODY_OF.has(name),
      `Szenario-Tabelle hat keinen Eintrag fuer ${name} - ein neues Schema-Werkzeug muss hier ergaenzt werden`,
    );

    // Erfolgslauf (Positiv-Kontrolle): ohne diesen Lauf waere der Test gruen, obwohl
    // jeder Handler nur noch Fehler liefert.
    await withMock({ body: SUCCESS_BODY_OF.get(name) }, async () => {
      const result = await handler(ARGS_OF.get(name));
      assert.notEqual(result.isError, true, `${name}: Erfolgslauf darf kein isError sein`);
      assert.ok(
        Object.hasOwn(result, "structuredContent"),
        `${name}: Erfolgslauf traegt structuredContent`,
      );
    });

    // Fehlerlauf
    const errorMock = ERROR_MOCK_OVERRIDE_OF.get(name) || { body: null };
    await withMock(errorMock, async () => {
      const result = await handler(ARGS_OF.get(name));
      assert.equal(result.isError, true, `${name}: Fehlerlauf muss isError liefern`);
    });
  }

  // Der heute einzige bekannte fruehe Rueckgabepfad (Schritt 1): macht jemand ihn
  // rueckgaengig (return text(...) statt errText(...)), faellt dieser Lauf.
  const getTranscript = withSchema.get("get_call_result").handler;
  await withMock({ body: { status: "active", transcript: [] } }, async () => {
    const result = await getTranscript({ call_id: "call_1" });
    assert.equal(result.isError, true, "get_call_result bei laufendem Anruf bleibt isError");
  });
});

// T-21: "Wichtiges in die ersten 512 Zeichen" - Wortlaut der Anforderung
// (tasks/openai-audit/00-openai-anforderungen.md), kein geratener Wert.
const INSTRUCTIONS_HEAD_CHARS = 512;

// ==================== Fall 3 (Abnahmekriterium 3 + 6) ====================
test("P4 (T-21 Konstanten): MCP_CONSULT_INSTRUCTIONS traegt den Geld-Satz in den ersten 512 Zeichen, nicht mehr die Werkzeug-Aufzaehlung", () => {
  assert.ok(
    MCP_CONSULT_INSTRUCTIONS.slice(0, INSTRUCTIONS_HEAD_CHARS).includes(NOT_PLACED),
    "der not-placed-Wiederhol-Riegel steht in den ersten 512 Zeichen",
  );
  assert.ok(
    !MCP_CONSULT_INSTRUCTIONS.includes("calendar, mail, files"),
    "die Aufzaehlung fremder Werkzeugklassen ist gestrichen (O-27)",
  );
  // Positiv-Kontrolle: der Consult-Block selbst ist noch vollstaendig da.
  assert.ok(
    MCP_CONSULT_INSTRUCTIONS.includes("await_call_event"),
    "der Consult-Block bleibt Teil der Konstante",
  );
});

// ==================== Fall 4 (Abnahmekriterium 4) ====================
test("P4 (T-21): initialize ohne Consult-Freigabe traegt den Basis-Block, nicht undefined und nicht den Consult-Text", async () => {
  // KEIN CONSULT_ENABLED-Override: BASE_ENV setzt es bereits auf "false" (test/helpers.js).
  // Der Test prueft den Zustand "Tenant ohne Consult-Faehigkeit". Produktion laeuft NICHT
  // so: der Live-Wert ist Dashboard-gepflegt, render.yaml ist nicht massgeblich, und der
  // Live-Connector zeigte am 2026-09-21 die Consult-Werkzeuge und den Consult-
  // Instruktionsblock. Der Fall bleibt relevant fuer jeden Tenant ohne allowConsult
  // (DEFAULT_PROFILE, src/store/defaults.js:1069-1078).
  const srv = await startServer({ seed: seedState({}) });
  try {
    const res = await mcpPost(`${srv.localUrl}/mcp`, null, INITIALIZE_BODY);
    const result = await readToolResult(res);
    assert.equal(typeof result.instructions, "string");
    assert.ok(result.instructions.length > 0, "instructions ist nie mehr leer/undefined");
    assert.equal(
      result.instructions,
      MCP_BASE_INSTRUCTIONS,
      "ein Tenant ohne Consult-Freigabe bekommt den BASIS-Block, nicht den Consult-Text",
    );
    assert.ok(!result.instructions.includes("await_call_event"));
  } finally {
    await srv.stop();
  }
});

// ==================== Fall 5 (Abnahmekriterium 5) ====================
test("P4 (T-21 stdio, DP-1): der echte stdio-Kindprozess traegt instructions im initialize-Handshake", async () => {
  // Echter Kindprozess, echtes Protokoll ueber die Pipe - keine Quelltext-Inspektion,
  // kein InMemory-Transport (Muster test/openai-p3-security-schemes.test.js:278-303).
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/mcp-server.js"],
    cwd: ROOT,
    env: BASE_ENV,
    stderr: "pipe",
  });
  let stderrOutput = "";
  transport.stderr?.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });
  const client = new Client({ name: "hermes-p4-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    const instructions = client.getInstructions();
    assert.equal(
      typeof instructions,
      "string",
      `stdio-initialize traegt instructions (stderr: ${stderrOutput})`,
    );
    assert.ok(instructions.length > 0, `instructions ist nicht leer (stderr: ${stderrOutput})`);
    // STDIO_CONSULT_LOOP ist in mcp-server.js hart auf false gepinnt (await_call_event/
    // answer_consult sind in diesem Prozess gar nicht registriert) - deshalb muss ueber
    // stdio exakt der BASIS-Block ankommen, dieselbe Schaerfe wie Fall 4 (HTTP).
    assert.equal(
      instructions,
      MCP_BASE_INSTRUCTIONS,
      "stdio traegt den BASIS-Block, nicht den Consult-Text",
    );
    assert.ok(!instructions.includes("await_call_event"));
  } finally {
    await client.close();
  }
});

// ==================== Fall 6 (Abnahmekriterium 7) ====================
test("P4 (T-21/O-27 Wirkung): der ausgelieferte Consult-Text traegt die vier Wirkungen, nicht die Aufzaehlung", () => {
  // Gegen den AUSGELIEFERTEN Text, nicht gegen die Konstante direkt (mcpServerOptions
  // ist der Bauer, den beide Transporte tatsaechlich aufrufen).
  const text = mcpServerOptions({ uiEnabled: false, consultLoop: true }).instructions;
  // (a) Poll-Schleife bis "done"
  assert.match(text, /until it returns event="done"/);
  // (b) Quittung "working" binnen Sekunden
  assert.match(text, /status="working"/);
  assert.match(text, /within seconds/);
  // (c) eigene Quellen zuerst + nur bei echter Anwesenheit fragen + nichts erfinden -
  // die WIRKUNG, nicht die Aufzaehlung. Ein Pin auf "calendar, mail, files" waere mit
  // Abnahmekriterium 6 unvereinbar - diese Zusicherung macht den Widerspruch unmoeglich.
  assert.match(text, /answer from your own tools and context first/);
  assert.match(text, /only ask the user when they are actually present/);
  assert.match(text, /never invent an answer/);
  assert.doesNotMatch(text, /calendar, mail, files/);
  // (d) not-placed nicht wiederholen
  assert.ok(text.includes(NOT_PLACED));
  assert.match(text, /Do NOT retry the call/);
});

// ==================== Fall 7 (Review-Runde 2, Befund 1) ====================
// Reviewer-Befund: MCP_BASE_INSTRUCTIONS schickte das Modell auf "the result_summary
// text", ohne zu sagen, WELCHES Werkzeug das Feld traegt (get_call_result) und dass das
// auch bei status=failed gilt. get_call_result's eigene Beschreibung sagte "call this
// only once status=completed" - ein Tenant ohne Consult-Faehigkeit (Fall 4 oben; NICHT
// notwendig der Produktions-Normalfall, s. dortiger Kommentar) hatte damit keinen
// textuellen Weg zu result_summary fuer einen NICHT platzierten Anruf (status=failed).
test("P4 (Review-Runde 2, Befund 1): MCP_BASE_INSTRUCTIONS nennt get_call_result und schliesst status=failed nicht aus", () => {
  assert.match(
    MCP_BASE_INSTRUCTIONS,
    /call get_call_result/,
    "das Modell muss wissen, WELCHES Werkzeug result_summary traegt",
  );
  assert.match(
    MCP_BASE_INSTRUCTIONS,
    /failed call/,
    "der Basis-Block sagt ausdruecklich, dass get_call_result auch fuer einen fehlgeschlagenen Anruf gilt",
  );
});

test("P4 (Review-Runde 2, Befund 1): get_call_result-Beschreibung schliesst status=failed/cancelled NICHT mehr aus", () => {
  const registrations = captureToolsWithConfig({
    identity: null,
    scopedTenant: null,
    consultAllowed: false,
    language: null,
  });
  const description = registrations.get("get_call_result").config.description;
  assert.doesNotMatch(
    description,
    /only once get_call_status reports status=completed/,
    "die alte Formulierung war enger als der Handler (der lehnt nur status===active ab)",
  );
  assert.match(description, /failed/, "die Beschreibung nennt status=failed als gueltigen Fall");
});

// Funktionaler Beleg (kein reiner Text-Pin): ein Tenant OHNE Consult-Freigabe
// (BASE_ENV CONSULT_ENABLED=false, wie Fall 4) ruft get_call_result fuer einen NICHT
// platzierten Anruf (status=failed, failure_reason mit dem NOT_PLACED-Praefix) direkt
// auf - der Pfad, den der Reviewer als kaputt beschrieben hat (place_call ->
// failure_reason -> result_summary, ohne await_call_event). Erwartet: kein isError, der
// lokalisierte Fehlschlagstext kommt an, nicht der Warte-Platzhalter und nicht das
// rohe Diagnose-Token.
test("P4 (Review-Runde 2, Befund 1): get_call_result liefert result_summary fuer einen NICHT platzierten Anruf, auch ohne Consult-Kanal", async () => {
  const failureReason = `${NOT_PLACED}:invite-403-D51`;
  const seed = seedState({
    calls: [
      seedCall({
        id: "call_notplaced1",
        status: "failed",
        failureReason,
        endedAt: new Date().toISOString(),
      }),
    ],
    settings: { language: "de" },
  });
  const srv = await startServer({ seed });
  try {
    const res = await mcpPost(
      `${srv.localUrl}/mcp`,
      null,
      toolCall("get_call_result", { call_id: "call_notplaced1" }),
    );
    const result = await readToolResult(res);
    assert.notEqual(
      result.isError,
      true,
      "ein NICHT platzierter Anruf ist ein gueltiger get_call_result-Aufruf, kein Fehlerergebnis",
    );
    const expected = MCP_TEXTS.de.callFailedSummary(failureReason);
    assert.equal(
      result.structuredContent.result_summary,
      expected,
      "result_summary traegt den lokalisierten Fehlschlagstext, nicht den Warte-Platzhalter und nicht das rohe Token",
    );
    assert.doesNotMatch(toolResultText(result), /invite-403-D51/);
  } finally {
    await srv.stop();
  }
});
