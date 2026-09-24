// P5b (O-13 Teil 2, O-27 Teil 2): Datenminimierung am Geldpfad.
//
// Erster Abschnitt (Faelle A-E): callOutcomeView() liefert an der MCP-Kante nur noch
// das BASIS-Token von failure_reason (z.B. NOT_PLACED), nicht mehr die volle Diagnose
// (NOT_PLACED plus SIP-/Carrier-Detail). Fall D ist die Geldpfad-Gegenprobe: der Riegel
// gegen teure Wiederwahl haengt an failure_reason.startsWith(NOT_PLACED) - bricht das
// Praefix, wiederholt der Host jeden Fehlschlag, jeder Versuch kostet Carrier-Geld.
// Deshalb wird ausschliesslich gegen die importierte Konstante NOT_PLACED geprueft,
// nirgends gegen ein getipptes Literal (Gegenprobe-Kommando im Abschlussbericht: die
// gesamte Datei traegt den Wert von NOT_PLACED an keiner Stelle in Anfuehrungszeichen
// getippt).
//
// Zweiter Abschnitt (Faelle F-G): consultPermissionHint beschreibt die Voraussetzung
// statt eine Host-Sicherheitseinstellung einzufordern - in allen drei Sprachen
// (SUPPORTED_LANGUAGES), mit Positiv-Kontrolle gegen die ALTEN Aufforderungs-Texte.
//
// Testnamen tragen KEIN Katalog-Praefix (Lehre catalog-id-prefix-misroutes-tests) -
// sie laufen in npm test, nicht im Gates-Lauf.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerTools } from "../src/mcp-tools.js";
import { NOT_PLACED, failureReasonBase } from "../src/telephony/failure-reason.js";
import { CAP_FAILURE_REASON, BUDGET_FAILURE_REASON } from "../src/telephony/call-lifecycle.js";
import { MCP_BASE_INSTRUCTIONS } from "../src/mcp-server-info.js";
import { FAILURE_REASON_TEXTS } from "../src/i18n/failure-reason-texts.js";
import { localeFor, SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import {
  startServer,
  seedState,
  seedCall,
  mcpPost,
  toolCall,
  readToolResult,
  ROOT,
  BASE_ENV,
} from "./helpers.js";

const CALL_ID = "call_p5b";
const HTTP_OK = 200;

// ==================== Gemeinsame Test-Infrastruktur (Faelle A-E) ====================

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

// Lokaler Gateway-Mock: /consult liefert consultBody, jeder andere Pfad callBody.
// Muster test/mcp-fehlergrund-rueckweg.test.js#startGatewayMock.
async function startGatewayMock({ consultBody, callBody }) {
  const server = http.createServer((req, res) => {
    const body = req.url.includes("/consult") ? consultBody : callBody;
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(body ?? {}));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function withGateway({ consultBody = null, callBody }, fn) {
  const mock = await startGatewayMock({ consultBody, callBody });
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

const DONE_CONSULT = { event: "done", eventId: null, questions: [] };

function finishedCall(overrides = {}) {
  return {
    status: "failed",
    startedAt: "2026-09-01T10:00:00.000Z",
    endedAt: "2026-09-01T10:00:20.000Z",
    transcript: [],
    summary: null,
    objectiveAchieved: "unclear",
    failureReason: null,
    result: null,
    ...overrides,
  };
}

async function getCallStatusFailureReason(failureReason) {
  return withGateway({ callBody: finishedCall({ failureReason }) }, async () => {
    const handlers = captureTools({ identity: null, scopedTenant: "tenant_p5b", language: "de" });
    const result = await handlers.get("get_call_status")({ call_id: CALL_ID });
    return result.structuredContent.failure_reason;
  });
}

// ==================== Fall A (in-process, beide Werkzeuge) ====================

test("P5b (O-13 Teil 2, Fall A): get_call_status UND await_call_event liefern nur noch das Basis-Token, result_summary bleibt die volle Phrase", async () => {
  const rohesToken = `${NOT_PLACED}:invite-403-D51`;
  const callBody = finishedCall({ failureReason: rohesToken });
  // Positiv-Kontrolle: der Mock-Body traegt tatsaechlich das volle Token - sonst waere
  // die Kuerzungs-Zusicherung unten trivial gruen.
  assert.equal(callBody.failureReason, rohesToken, "Mock traegt das volle Diagnose-Token");

  await withGateway({ consultBody: DONE_CONSULT, callBody }, async () => {
    const handlers = captureTools({
      identity: null,
      scopedTenant: "tenant_p5b",
      consultAllowed: true,
      language: "de",
    });

    const statusResult = await handlers.get("get_call_status")({ call_id: CALL_ID });
    assert.equal(statusResult.structuredContent.failure_reason, NOT_PLACED);

    const eventResult = await handlers.get("await_call_event")({
      call_id: CALL_ID,
      after_event_id: undefined,
    });
    assert.equal(eventResult.structuredContent.failure_reason, NOT_PLACED);
    const textBlock = eventResult.content[0].text;
    assert.ok(!textBlock.includes("invite-403"), "Textblock traegt das SIP-Detail nicht");
    assert.ok(!textBlock.includes("D51"), "Textblock traegt den Carrier-Code nicht");

    // Die Kuerzung darf den Nutzertext nicht beruehren - result_summary bleibt die
    // lokalisierte Phrase auf dem BASIS-Token.
    assert.ok(
      eventResult.structuredContent.result_summary.includes(
        FAILURE_REASON_TEXTS.de.phrases[NOT_PLACED],
      ),
    );
  });
});

// ==================== Fall E (Durchreiche detailfreier Token) ====================

test("P5b (O-13 Teil 2, Fall E): detailfreie Token reisen unveraendert durch - die Kuerzung nimmt nichts weg, was kein Detail ist", async () => {
  const tabelle = ["no-answer", "busy", "canceled", CAP_FAILURE_REASON, BUDGET_FAILURE_REASON, null];
  for (const token of tabelle) {
    const emitted = await getCallStatusFailureReason(token);
    assert.equal(emitted, token, `Token ${JSON.stringify(token)} bleibt unveraendert`);
  }
});

// ==================== Fall B (HTTP /mcp, echter Serverprozess) ====================

test("P5b (O-13 Teil 2, Fall B, HTTP): der echte Serverprozess kuerzt failure_reason im Tool-Output, /api/calls/:id traegt das volle Token weiter", async () => {
  const rohesToken = `${NOT_PLACED}:start-403`;
  const srv = await startServer({
    seed: seedState({
      calls: [
        seedCall({
          id: CALL_ID,
          status: "failed",
          tenantId: BOOTSTRAP_TENANT_ID,
          transcript: [],
          failureReason: rohesToken,
        }),
      ],
    }),
  });
  try {
    // Positiv-Kontrolle: /api/* ist NICHT Gegenstand dieser Phase (Abschnitt 4) - ohne
    // diese Zeile beweist der Tool-Test unten nichts.
    const apiRes = await fetch(`${srv.localUrl}/api/calls/${CALL_ID}`);
    const apiBody = await apiRes.json();
    assert.equal(apiBody.failureReason, rohesToken, "/api/calls/:id traegt das volle Token weiter");

    const toolRes = await mcpPost(
      `${srv.localUrl}/mcp`,
      null,
      toolCall("get_call_status", { call_id: CALL_ID }),
    );
    const toolResult = await readToolResult(toolRes);
    assert.notEqual(toolResult.isError, true, "Erfolgslauf ist kein Fehler");
    assert.equal(toolResult.structuredContent.failure_reason, NOT_PLACED);
  } finally {
    await srv.stop();
  }
});

// ==================== Fall C (stdio, echter Kindprozess, DP-1) ====================

test("P5b (O-13 Teil 2, Fall C, stdio): der echte stdio-Kindprozess kuerzt failure_reason ueber einen echten tools/call", async () => {
  const rohesToken = `${NOT_PLACED}:invite-403-D51`;
  const callBody = finishedCall({ failureReason: rohesToken });
  const mockServer = http.createServer((req, res) => {
    res.writeHead(HTTP_OK, { "content-type": "application/json" });
    res.end(JSON.stringify(callBody));
  });
  await new Promise((resolve) => mockServer.listen(0, "127.0.0.1", resolve));
  const gatewayUrl = `http://127.0.0.1:${mockServer.address().port}`;

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/mcp-server.js"],
    cwd: ROOT,
    // GATEWAY_URL wird NUR diesem Kindprozess mitgegeben, NICHT in BASE_ENV
    // aufgenommen - sonst leakte er in jeden anderen Spawn-Test.
    env: { ...BASE_ENV, GATEWAY_URL: gatewayUrl },
    stderr: "pipe",
  });
  let stderrOutput = "";
  transport.stderr?.on("data", (chunk) => {
    stderrOutput += chunk.toString();
  });
  const client = new Client({ name: "hermes-p5b-stdio-client", version: "0.0.0" });
  try {
    await client.connect(transport);
    // Ausdruecklich ein echter tools/call, kein tools/list: das Schema aendert sich in
    // dieser Phase nicht, eine Schema-Pruefung wuerde hier nichts beweisen.
    const result = await client.callTool({
      name: "get_call_status",
      arguments: { call_id: CALL_ID },
    });
    assert.notEqual(result.isError, true, `Erfolgslauf ist kein Fehler (stderr: ${stderrOutput})`);
    assert.equal(result.structuredContent.failure_reason, NOT_PLACED);
  } finally {
    await client.close();
    await new Promise((resolve) => mockServer.close(resolve));
  }
});

// ==================== Fall D (Geldpfad-Gegenprobe gegen die KONSTANTE) ====================

test("P5b (O-13 Teil 2, Fall D): der Riegel gegen teure Wiederwahl bleibt intakt - alles gegen die Konstante NOT_PLACED, nichts getippt", async () => {
  // 1) der Riegel in den Server-Instruktionen nennt das Token ueber die Konstante.
  assert.ok(
    MCP_BASE_INSTRUCTIONS.includes(NOT_PLACED),
    "MCP_BASE_INSTRUCTIONS nennt NOT_PLACED",
  );
  // Positiv-Kontrolle: das Kommando findet ueberhaupt etwas in der Instruktion.
  assert.ok(
    MCP_BASE_INSTRUCTIONS.includes("get_call_result"),
    "Positiv-Kontrolle: get_call_result wird genannt",
  );

  // 2) der von get_call_status gelieferte Wert erfuellt beide Formen der Zusicherung.
  const rohesToken = `${NOT_PLACED}:invite-403-D51`;
  const emitted = await getCallStatusFailureReason(rohesToken);
  assert.equal(emitted.startsWith(NOT_PLACED), true);
  assert.equal(emitted, NOT_PLACED);

  // 3) das Werkzeug benutzt die GETEILTE Zerlegeregel, keine zweite - fuer eine ganze
  // Tabelle von Token, inklusive nie gesehener.
  const tabelle = [
    `${NOT_PLACED}:invite-403-D51`,
    `${NOT_PLACED}:start-403`,
    "unreachable:invite-404",
    "result-unknown:poll-timeout",
    "failed:603",
    "brandneu-nie-gesehen:42",
  ];
  for (const roh of tabelle) {
    const wert = await getCallStatusFailureReason(roh);
    assert.equal(wert, failureReasonBase(roh), `Token ${roh}: geteilte Zerlegeregel`);
  }

  // 4) Negativ-Waechter gegen den Pre-Mortem-Fall (zusaetzliche Bindestrich-Trennung
  // wie reasonWithoutCarrier() bricht das Praefix: aus NOT_PLACED wuerde "not").
  assert.notEqual(emitted, "not");
  assert.ok(NOT_PLACED.includes("-"), "NOT_PLACED traegt selbst einen Bindestrich");

  // 5) Waechter gegen ein zweites Literal: beide Seiten (Instruktion + Werkzeug-Ausgang)
  // werden aus DERSELBEN importierten Konstante gebildet.
  assert.ok(MCP_BASE_INSTRUCTIONS.includes(`"${NOT_PLACED}"`));
  assert.equal(emitted, NOT_PLACED);
});

// ==================== Fall F/G (consultPermissionHint, O-27 Teil 2) ====================

async function placeCallText({ consultAllowed, language }) {
  return withGateway({ callBody: { callId: "call_hint" } }, async () => {
    const handlers = captureTools({
      identity: null,
      scopedTenant: "tenant_p5b",
      consultAllowed,
      language,
    });
    const result = await handlers.get("place_call")({
      to: "+4915112345678",
      objective: "Test",
    });
    return result.content[0].text;
  });
}

test("P5b (O-27 Teil 2, Fall F): der Hinweis haengt weiterhin an jedem place_call-Ergebnis mit Consult, in JEDER unterstuetzten Sprache", async () => {
  for (const language of SUPPORTED_LANGUAGES) {
    const hint = localeFor(language).mcp.consultPermissionHint;
    const withConsult = await placeCallText({ consultAllowed: true, language });
    assert.ok(withConsult.includes(hint), `Sprache ${language}: Hinweis vorhanden mit Consult`);
    const withoutConsult = await placeCallText({ consultAllowed: false, language });
    assert.ok(
      !withoutConsult.includes(hint),
      `Sprache ${language}: kein Hinweis ohne Consult-Faehigkeit`,
    );
  }
});

// Eingefrorene Marker der ALTEN Aufforderungs-Formulierung, je Sprache: Wert-Label +
// Modalverb. Dient NUR der Pruefung, dass diese Marker in den NEUEN Texten fehlen.
const AUFFORDERUNGS_MARKER = {
  de: ["Zulassen", "muss"],
  en: ["Allow", "needs to be set"],
  fr: ["Autoriser", "doit être"],
};

// Die drei ALTEN Formulierungen (vor P5b), woertlich - Positiv-Kontrolle: jede wird von
// ihren eigenen Markern gefangen (Lehre pruefkommando-ohne-positiv-kontrolle).
const BESTAND_VORHER = {
  de:
    "Hinweis: Falls waehrend des Anrufs keine Live-Rueckfragen ankommen, muss die " +
    "Werkzeug-Berechtigung des Connectors auf 'Zulassen' stehen.",
  en:
    "Note: if no live questions arrive during the call, the connector's tool permission " +
    "needs to be set to 'Allow'.",
  fr:
    "Remarque : si aucune question en direct n'arrive pendant l'appel, l'autorisation " +
    "d'outil du connecteur doit être réglée sur « Autoriser ».",
};

const SACHINFORMATION_MARKER = {
  de: "Berechtigung",
  en: "permission",
  fr: "autorisation",
};

test("P5b (O-27 Teil 2, Fall G): keine Aufforderung in irgendeiner Sprachfassung, mit Positiv-Kontrolle gegen den Bestand", () => {
  // 1) AUFFORDERUNGS_MARKER deckt SUPPORTED_LANGUAGES vollstaendig ab - eine vierte
  // Sprache kann nicht stillschweigend durchrutschen.
  assert.deepEqual(
    Object.keys(AUFFORDERUNGS_MARKER).sort(),
    [...SUPPORTED_LANGUAGES].sort(),
  );

  for (const language of SUPPORTED_LANGUAGES) {
    const [wertLabel, modalverb] = AUFFORDERUNGS_MARKER[language];

    // 2) Positiv-Kontrolle: der ALTE Text wird von BEIDEN Markern gefangen - sonst ist
    // "kein Marker gefunden" unten nicht von "der Waechter sucht nichts" zu
    // unterscheiden.
    assert.ok(
      BESTAND_VORHER[language].includes(wertLabel),
      `${language}: Positiv-Kontrolle Wert-Label im Bestandstext`,
    );
    assert.ok(
      BESTAND_VORHER[language].includes(modalverb),
      `${language}: Positiv-Kontrolle Modalverb im Bestandstext`,
    );

    // 3) die NEUE Fassung traegt keinen der beiden Marker mehr.
    const neu = localeFor(language).mcp.consultPermissionHint;
    assert.ok(!neu.includes(wertLabel), `${language}: kein Wert-Label 'Zulassen'/'Allow'/...`);
    assert.ok(!neu.includes(modalverb), `${language}: kein Modalverb 'muss'/'needs to be set'/...`);

    // 4) die Sachinformation bleibt erhalten - nicht ersatzlos entkernt.
    assert.ok(
      neu.includes(SACHINFORMATION_MARKER[language]),
      `${language}: Gegenstand (Berechtigung/permission/autorisation) bleibt genannt`,
    );
  }
});
