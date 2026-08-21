// INBOX-P3: das MCP-Werkzeug check_inbox. Regressionsschutz, KEINE Katalog-Kennung am
// Namensanfang (Lehre catalog-id-prefix-misroutes-tests) - laeuft in npm test.
//
// Harness (a)-(h): lokaler captureTools + Gateway-Attrappe, Muster
// test/mcp-tools-language.test.js. Die Duplizierung dieses ~40-Zeilen-Mini-Harness ist
// Bestandspraxis (derselbe Code steht bereits in mcp-tools-language.test.js,
// al-p11-result-card.test.js, p15-mcp-tool-descriptions-en.test.js) - ihn hier zu
// vereinheitlichen waere ein Test-Harness-Refactoring ueber vier Bestandsdateien und
// damit ausserhalb des Auftrags dieser Etappe (Regel 6, S3 bewusst akzeptiert).
//
// (i) ist Ende-zu-Ende ueber den echten Spawn-Server (Muster T10 in
// test/mcp-tools-language.test.js): /mcp -> registerTools -> api() -> internalOnly ->
// requireTenant -> takeInboxEntries -> save().
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { registerTools } from "../src/mcp-tools.js";
import { MCP_TEXTS } from "../src/i18n/mcp-texts.js";
import { SUPPORTED_LANGUAGES } from "../src/i18n/locales.js";
import * as ops from "../src/store/state-ops.js";
import { BOOTSTRAP_TENANT_ID } from "../src/store/defaults.js";
import { seedState, seedCall, startServer, mcpPost, toolCall, readToolResult } from "./helpers.js";

// Bestandsstil test/inbox-poll-route.test.js: benannte Konstante statt nackter Zahl (G25).
const HTTP_OK = 200;

// ---- lokaler Mini-Harness (Dedup bewusst akzeptiert, s. Datei-Kopf) ----
function captureTools(ctx) {
  const handlers = new Map();
  const fakeServer = {
    // Positions-Signatur ist von registerTools vorgegeben (server.tool(name, desc,
    // schema, handler)) - ...args statt vier benannter Parameter haelt max-params (3) ein.
    tool(...args) {
      const [name, , , handler] = args;
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
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { url, close: () => new Promise((resolve) => server.close(resolve)) };
}

// writeHead statt res.statusCode=/res.setHeader() als Property-Zuweisungen auf dem
// Funktionsparameter (no-param-reassign, P6/F2).
function sendJson(res, { body = null, status = HTTP_OK } = {}) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(body == null ? "" : JSON.stringify(body));
}

// captured (optional): sammelt jeden empfangenen Request-Body - der einzige Weg, Fall
// (g) zu behaupten (welchen Wert reicht der Handler UNVERAENDERT an den Endpunkt durch).
async function startGatewayMock({ body = null, status = HTTP_OK, captured = null } = {}) {
  const server = http.createServer((req, res) => {
    if (!captured) return sendJson(res, { body, status });
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      captured.push(raw ? JSON.parse(raw) : null);
      sendJson(res, { body, status });
    });
  });
  return listen(server);
}

async function withGateway(opts, fn) {
  const mock = await startGatewayMock(opts);
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
  return (result?.content || []).map((line) => line.text).join("\n");
}

// PII-Regel (Bestandsstil): fiktive Nummern, keine echten. CALLER = seedCall-Default
// "from", OWNER_DID = die Magic-Range-Owner-Nummer (Bestandsstil test/inbox-poll-route.test.js).
const CALLER = "+4915112345678";
const OWNER_DID = "+15005550006";

function qualifiedCall(overrides = {}) {
  return seedCall({
    id: "call_inbox_p3",
    direction: "inbound",
    from: CALLER,
    to: OWNER_DID,
    status: "completed",
    startedAt: "2026-08-21T09:05:00.000Z",
    summary: "Testanliegen",
    result: {
      outcome: "Rueckruf zugesagt",
      commitments: ["Unterlagen senden"],
      counterpartyCommitments: ["Rueckruf bis Montag"],
      openPoints: ["Adresse bestaetigen"],
      nextStep: "Termin eintragen",
      facts: ["GEHEIM-FACT"],
    },
    inboxEntryAt: "2026-08-21T10:00:00.000Z",
    inboxSeenAt: null,
    ...overrides,
  });
}

// Baut die REST-Antwort mit dem ECHTEN Produzenten (state-ops.takeInboxEntries) - kein
// handgetippter Erwartungswert. Damit prueft (b) tatsaechlich "REST-Schluesselsatz minus
// started_at plus at" und nicht eine abgeschriebene Liste, die mitdriftet (Pre-Mortem P3-A).
// prepare (optional): mutiert den State VOR der Operation (Fall e: zusaetzliches Action Item).
function restBodyFor(calls, prepare = () => {}) {
  const state = seedState({ calls });
  prepare(state);
  const { entries, remaining } = ops.takeInboxEntries(state, BOOTSTRAP_TENANT_ID, {
    limit: 10,
    includeSeen: false,
  });
  return { entries, remaining };
}

const THREE_CALLS_COUNT = 3; // G25: benannte Konstante statt nackter Zahl

test("INBOX-P3 (a): Text- und structuredContent-Sicht lesen DIESELBE Struktur", async () => {
  const restBody = restBodyFor([
    qualifiedCall({ id: "call_1" }),
    qualifiedCall({ id: "call_2", startedAt: "2026-08-21T09:10:00.000Z" }),
    qualifiedCall({ id: "call_3", startedAt: "2026-08-21T09:15:00.000Z" }),
  ]);
  await withGateway({ body: restBody }, async () => {
    const handlers = captureTools({ language: "de" });
    const result = await handlers.get("check_inbox")({});
    const entries = result.structuredContent.entries;
    assert.equal(entries.length, THREE_CALLS_COUNT);
    const lines = toolText(result).split("\n");
    assert.equal(lines.length, THREE_CALLS_COUNT);
    for (const [i, entry] of entries.entries()) {
      assert.ok(lines[i].includes(entry.call_id));
      assert.ok(lines[i].includes(entry.caller));
      assert.ok(lines[i].includes(entry.at));
      assert.ok(lines[i].includes(entry.summary));
    }
  });
});

test("INBOX-P3 (b): der MCP-Eintrag traegt EXAKT die REST-Schluessel, minus started_at, plus at", async () => {
  const restBody = restBodyFor([qualifiedCall()]);
  await withGateway({ body: restBody }, async () => {
    const handlers = captureTools({ language: "de" });
    const result = await handlers.get("check_inbox")({});
    const mcpEntry = result.structuredContent.entries[0];
    const restEntry = restBody.entries[0];
    // In zwei Schritte gebrochen (G36, Demeter): Object.keys(...).filter().concat().sort()
    // in einem Ausdruck reisst die Vier-Zugriffe-Grenze.
    const restKeysWithoutStartedAt = Object.keys(restEntry).filter((key) => key !== "started_at");
    const expectedKeys = restKeysWithoutStartedAt.concat("at").sort();
    assert.deepEqual(Object.keys(mcpEntry).sort(), expectedKeys);
    assert.ok(!("started_at" in mcpEntry));
    assert.notEqual(mcpEntry.at, restEntry.started_at);
    assert.equal(mcpEntry.caller, restEntry.caller);
    // Positiv-Kontrolle: ein geschmuggeltes Feld MUSS den Vergleich brechen, sonst prueft
    // er nichts (Lehre pruefkommando-ohne-positiv-kontrolle).
    assert.notDeepEqual(Object.keys({ ...mcpEntry, transcript: [] }).sort(), expectedKeys);
  });
});

test("INBOX-P3 (c): nichts Neues -> Leertext der Tenant-Sprache UND leeres structuredContent", async () => {
  await withGateway({ body: { entries: [], remaining: 0 } }, async () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const handlers = captureTools({ language });
      const result = await handlers.get("check_inbox")({});
      assert.equal(toolText(result), MCP_TEXTS[language].emptyInbox);
      assert.deepEqual(result.structuredContent, { entries: [], remaining: 0 });
    }
    const de = await captureTools({ language: "de" }).get("check_inbox")({});
    assert.equal(toolText(de), "Keine neuen Anrufe.");
  });
});

test("INBOX-P3 (d): die Antwort traegt kein Transkript, kein facts, kein evidence, kein Audio", async () => {
  const restBody = restBodyFor([
    qualifiedCall({
      result: {
        outcome: "Rueckruf zugesagt",
        commitments: [],
        counterpartyCommitments: [],
        openPoints: [],
        nextStep: null,
        facts: ["GEHEIM-FACT"],
        evidence: ["woertliches Zitat"],
      },
    }),
  ]);
  await withGateway({ body: restBody }, async () => {
    const handlers = captureTools({ language: "de" });
    const result = await handlers.get("check_inbox")({});
    const serialized = JSON.stringify(result);
    for (const forbidden of [
      "transcript",
      "facts",
      "GEHEIM-FACT",
      "evidence",
      "audioUrl",
      "recordingUrl",
      "streamToken",
      "inboxEntryAt",
      "inboxSeenAt",
      "started_at",
    ]) {
      assert.ok(!serialized.includes(forbidden), `Antwort leakt "${forbidden}"`);
    }
    // Positiv-Kontrolle: derselbe Detektor MUSS anschlagen, wenn transcript geschmuggelt wird.
    const sabotaged = JSON.stringify({ ...result, transcript: [] });
    assert.ok(sabotaged.includes("transcript"));
  });
});

test("INBOX-P3 (e): action_required haengt ALLEIN an offenen Nachrichten", async () => {
  const withoutActionItems = restBodyFor([qualifiedCall()]);
  await withGateway({ body: withoutActionItems }, async () => {
    const handlers = captureTools({ language: "de" });
    const result = await handlers.get("check_inbox")({});
    const entry = result.structuredContent.entries[0];
    assert.equal(entry.action_required, false);
    assert.ok(entry.next_step, "next_step bleibt trotzdem ausgeliefert");
    assert.ok(entry.open_points.length > 0, "open_points bleiben trotzdem ausgeliefert");
    assert.deepEqual(entry.action_items, []);
  });

  const withActionItem = restBodyFor([qualifiedCall()], (state) => {
    ops.addActionItem(state, "call_inbox_p3", "Rueckruf notieren");
  });
  await withGateway({ body: withActionItem }, async () => {
    const handlers = captureTools({ language: "de" });
    const result = await handlers.get("check_inbox")({});
    const entry = result.structuredContent.entries[0];
    assert.equal(entry.action_required, true);
    assert.deepEqual(entry.action_items, ["Rueckruf notieren"]);
  });
});

test("INBOX-P3 (f): summary=null liefert summary_unavailable=true und die Ersatzzeile der Tenant-Sprache", async () => {
  const restBody = restBodyFor([qualifiedCall({ summary: null })]);
  await withGateway({ body: restBody }, async () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const handlers = captureTools({ language });
      const result = await handlers.get("check_inbox")({});
      const entry = result.structuredContent.entries[0];
      assert.equal(entry.summary, null);
      assert.equal(entry.summary_unavailable, true);
      assert.ok(toolText(result).includes(MCP_TEXTS[language].inboxSummaryUnavailable));
    }
    const de = await captureTools({ language: "de" }).get("check_inbox")({});
    assert.ok(toolText(de).includes("Zusammenfassung nicht verfuegbar (technischer Fehler)."));
  });
});

test("INBOX-P3 (g): include_seen wird unveraendert durchgereicht, Default ist false", async () => {
  const captured = [];
  await withGateway({ body: { entries: [], remaining: 0 }, captured }, async () => {
    const handlers = captureTools({ language: "de" });
    await handlers.get("check_inbox")({});
    await handlers.get("check_inbox")({ include_seen: true });
    await handlers.get("check_inbox")({ include_seen: "true" });
  });
  assert.deepEqual(captured, [
    { include_seen: false },
    { include_seen: true },
    { include_seen: "true" },
  ]);
});

test("INBOX-P3 (h): degradierte Gateway-Antwort wird zur sauberen Tool-Fehlermeldung", async () => {
  await withGateway({ body: {} }, async () => {
    for (const language of SUPPORTED_LANGUAGES) {
      const handlers = captureTools({ language });
      const result = await handlers.get("check_inbox")({});
      assert.equal(result.isError, true);
      assert.equal(toolText(result), MCP_TEXTS[language].errors.upstream_incomplete);
    }
  });
});

test("INBOX-P3 (i, E2E): erster Aufruf liefert den Eintrag, zweiter ist eindeutig leer, dritter mit include_seen liefert ihn erneut", async () => {
  const seed = seedState({ settings: { language: "en" }, calls: [qualifiedCall()] });
  const srv = await startServer({ seed });
  try {
    const first = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("check_inbox", {})),
    );
    const firstEntries = first.structuredContent.entries;
    assert.equal(firstEntries.length, 1);
    assert.equal(firstEntries[0].call_id, "call_inbox_p3");
    assert.equal(first.structuredContent.remaining, 0);

    // Der Marker ist PERSISTIERT (der Wrapper hat save() gerufen) - nicht nur im Spiegel.
    const storeAfterFirst = srv.readStore();
    assert.notEqual(storeAfterFirst.calls[0].inboxSeenAt, null);

    const second = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("check_inbox", {})),
    );
    assert.deepEqual(second.structuredContent, { entries: [], remaining: 0 });
    assert.equal(toolText(second), MCP_TEXTS.en.emptyInbox); // kurz und EINDEUTIG leer

    const third = await readToolResult(
      await mcpPost(`${srv.localUrl}/mcp`, null, toolCall("check_inbox", { include_seen: true })),
    );
    assert.equal(third.structuredContent.entries.length, 1);
  } finally {
    await srv.stop(); // keine verwaisten Testserver
  }
});
