// T2-12 Gegenprobe (d), PLAN-OPENAI-TECHNIK-2.md Abschnitt T2-12: das Call-Widget wird
// per resources/read VOM LAUFENDEN SERVER geholt (nicht aus der Datei/widgetHtml()-
// Import wie test/mcp-ui-w1-call-widget.test.js), in einer node:vm-Fake-Sandbox von
// in_progress bis completed gefahren, und JEDER params.name jeder gesendeten
// tools/call-Nachricht wird gegen die tools/list-Namensmenge DESSELBEN Servers geprueft.
//
// Schliesst die Luecke aus dem Review-Nachtrag zu
// test/openai-t2-11-werkzeugtexte.test.js:386 (T11-f): T11-f prueft nur statisch die
// Bruecken-Konstanten (var TOOL_* = "...") und Tokens in Werkzeugnamen-Form im
// ausgelieferten HTML. Ein Widget, das einen Namen zur LAUFZEIT zusammensetzt (z.B.
// "get_" + suffix), faellt dort nicht auf - hier schon, weil tatsaechlich ausgefuehrt
// und der geSENDETE Wert geprueft wird, nicht der Quelltext.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { startServer, seedState, mcpPost, readToolResult } from "./helpers.js";
import { BIND_SCRIPT, signalUiReady } from "../src/ui/widget-bind.js";

const UI_ENV = { MCP_UI_ENABLED: "true" };
const OLD_CALL_RESULT_NAME = "get_transcript";
const CALL_ID = "call_t12d";

async function httpToolsList(baseUrl) {
  const res = await mcpPost(baseUrl, null, { jsonrpc: "2.0", id: 1, method: "tools/list" });
  return (await readToolResult(res)).tools;
}

async function httpResourceRead(baseUrl, uri) {
  const res = await mcpPost(baseUrl, null, {
    jsonrpc: "2.0",
    id: 2,
    method: "resources/read",
    params: { uri },
  });
  return await readToolResult(res);
}

// Holt Werkzeugmenge + Call-Widget-HTML vom selben laufenden Server ueber denselben
// Pfad (HTTP Legacy) - place_call traegt die resourceUri des vereinten Call-Widgets
// (src/mcp-tools.js:1328, WIDGET_CALL).
async function fetchToolsAndCallWidget(baseUrl) {
  const tools = await httpToolsList(baseUrl);
  const placeCall = tools.find((tool) => tool.name === "place_call");
  assert.ok(placeCall?._meta?.ui?.resourceUri, "place_call traegt die Call-Widget-resourceUri");
  const read = await httpResourceRead(baseUrl, placeCall._meta.ui.resourceUri);
  const html = read.contents.map((content) => content.text || "").join("\n");
  return { tools, html };
}

// Minimaler Fake: JEDER Selektor bekommt automatisch ein eigenes Fake-Element (statt
// der gepflegten Selektor-Liste aus mcp-ui-w1-call-widget.test.js) - diese Gegenprobe
// prueft NUR die gesendeten Werkzeugnamen, nicht das Rendering; eine zweite gepflegte
// Selektor-Liste waere hier eine Kopie ohne Mehrwert (G5/S2, keine doppelte Wartung).
function makeAutoElement() {
  const listeners = {};
  return {
    _text: "",
    className: "",
    children: [],
    style: {},
    disabled: false,
    attrs: {},
    get textContent() {
      return this._text;
    },
    set textContent(text) {
      this._text = text;
      this.children = [];
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((other) => other !== child);
      return child;
    },
    addEventListener(type, handler) {
      (listeners[type] = listeners[type] || []).push(handler);
    },
    click() {
      for (const handler of listeners.click || []) handler();
    },
    setAttribute(name, value) {
      this.attrs[name] = value;
      if (name === "class") this.className = value;
    },
    getAttribute(name) {
      return name in this.attrs ? this.attrs[name] : null;
    },
  };
}

function makeAutoDocument() {
  const bySelector = new Map();
  function get(sel) {
    if (!bySelector.has(sel)) bySelector.set(sel, makeAutoElement());
    return bySelector.get(sel);
  }
  get("[data-wing] img").src = "data:image/png;base64,FAKE";
  return {
    querySelector: get,
    querySelectorAll: () => [],
    createElement: () => makeAutoElement(),
    slot: (name) => get(`[data-mcp="${name}"]`),
  };
}

// Extrahiert das eigene Inline-Skript aus dem WIRE-HTML: letztes <script>-Element nach
// Entfernen von BIND_SCRIPT (Autorenregel im call.html-Kopfkommentar: das eigene Skript
// bleibt immer das letzte Element; Muster ownScriptSource() aus
// test/mcp-ui-w1-call-widget.test.js, hier auf den Draht-Text statt auf widgetHtml()
// angewendet).
function ownScriptFromWire(html) {
  const withoutBind = html.replace(BIND_SCRIPT, "");
  const matches = [...withoutBind.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(matches.length >= 1, "eigenes Inline-Skript im Draht-HTML gefunden");
  return matches[matches.length - 1][1];
}

// Faehrt ein Skript vom Handshake bis completed (Muster runOwnScript aus
// mcp-ui-w1-call-widget.test.js, hier lokal und ohne dessen HUD-spezifische
// Selektor-Liste): liefert jede via parent.postMessage geSENDETE Nachricht.
function driveToCompletion(scriptSource) {
  const doc = makeAutoDocument();
  const sandbox = { document: doc };
  sandbox.window = sandbox;
  sandbox._posted = [];
  sandbox.parent = { postMessage: (msg) => sandbox._posted.push(msg) };
  const listeners = {};
  sandbox.addEventListener = (type, handler) => {
    (listeners[type] = listeners[type] || []).push(handler);
  };
  sandbox.CustomEvent = function CustomEvent(type) {
    this.type = type;
  };
  sandbox.dispatchEvent = (event) => {
    for (const handler of listeners[event.type] || []) handler(event);
  };
  const intervalFns = new Map();
  let intervalSeq = 0;
  sandbox.setInterval = (fn) => {
    intervalSeq += 1;
    intervalFns.set(intervalSeq, fn);
    return intervalSeq;
  };
  sandbox.clearInterval = (id) => intervalFns.delete(id);
  const timeoutFns = new Map();
  let timeoutSeq = 0;
  sandbox.setTimeout = (fn) => {
    timeoutSeq += 1;
    timeoutFns.set(timeoutSeq, fn);
    return timeoutSeq;
  };
  sandbox.clearTimeout = (id) => timeoutFns.delete(id);

  vm.createContext(sandbox);
  vm.runInContext(scriptSource, sandbox);

  // Echter Handshake-Signalpfad (widget-bind.js), kein Test-Attrappen-Pfad. Der erste,
  // hier ausgeloeste Poll-Tick trifft auf einen noch leeren call_id-Slot und ist ein
  // No-Op (currentCallId() liest ""); das ist der reale Ablauf (place_call-Push kommt
  // erst danach), nicht ein Test-Artefakt.
  signalUiReady(sandbox);
  doc.slot("call_id").textContent = CALL_ID;
  for (const fn of intervalFns.values()) fn(); // Poll-Tick jetzt MIT call_id -> get_call_status

  const emit = (data) => {
    for (const handler of listeners.message || []) handler({ data });
  };
  emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      structuredContent: {
        call_id: CALL_ID,
        status: "in_progress",
        duration_s: 5,
        last_transcript_lines: [],
        failure_reason: null,
      },
    },
  });
  emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      structuredContent: {
        call_id: CALL_ID,
        status: "completed",
        duration_s: 12,
        last_transcript_lines: [],
        failure_reason: null,
      },
    },
  });

  return sandbox._posted;
}

function sentToolNames(posted) {
  return posted.filter((msg) => msg.params && msg.params.name).map((msg) => msg.params.name);
}

// Die eigentliche Pruefung aus T12-d, als eigene Funktion: von BEIDEN Tests genutzt,
// damit die Gegenprobe unten dieselbe Pruefung ausfuehrt (nicht nur eine aehnliche) und
// tatsaechlich zeigen kann, dass sie rot wird - nicht nur, dass ihre Zutaten es waeren.
function assertSentNamesMatchToolsList(sentNames, toolNames) {
  assert.ok(sentNames.length > 0, "Positiv-Kontrolle: mindestens ein tools/call gesendet");
  assert.ok(sentNames.includes("get_call_status"), "Positiv-Kontrolle: get_call_status gesendet");
  assert.equal(
    sentNames.filter((name) => name === "get_call_result").length,
    1,
    "Positiv-Kontrolle: get_call_result genau einmal gesendet",
  );
  for (const name of sentNames) {
    assert.ok(toolNames.has(name), `gesendeter Name "${name}" steht nicht in tools/list desselben Servers`);
  }
}

test("T12-d: Call-Widget vom Draht - jeder gesendete tools/call-Name steht in tools/list desselben Servers", async () => {
  const srv = await startServer({ seed: seedState({}), env: UI_ENV });
  try {
    const { tools, html } = await fetchToolsAndCallWidget(srv.localUrl + "/mcp");
    const toolNames = new Set(tools.map((tool) => tool.name));
    const posted = driveToCompletion(ownScriptFromWire(html));
    assertSentNamesMatchToolsList(sentToolNames(posted), toolNames);
  } finally {
    await srv.stop();
  }
});

// Beweiskraft-Nachweis (Pre-Mortem 1 aus dem Plan): setzt man den Altnamen wieder ein,
// muss DIESELBE Pruefung wie oben (assertSentNamesMatchToolsList, nicht nur eine
// aehnliche) tatsaechlich rot werden - sonst waere "nichts gefunden" wertlos (Lehre
// "Pruefkommando ohne Positiv-Kontrolle").
test("T12-d Gegenprobe: wird der alte Name wieder eingesetzt, wird die Pruefung von oben tatsaechlich rot", async () => {
  const srv = await startServer({ seed: seedState({}), env: UI_ENV });
  try {
    const { tools, html } = await fetchToolsAndCallWidget(srv.localUrl + "/mcp");
    const toolNames = new Set(tools.map((tool) => tool.name));
    const original = ownScriptFromWire(html);
    const mutated = original.replace(/"get_call_result"/g, `"${OLD_CALL_RESULT_NAME}"`);
    assert.notEqual(mutated, original, "Mutation griff tatsaechlich - sonst waere die Gegenprobe wirkungslos");

    // Positiv-Kontrolle fuer die Gegenprobe selbst: das mutierte Skript sendet den alten
    // Namen ueberhaupt (sonst wuerde der assert.throws unten aus dem falschen Grund
    // greifen, z.B. weil die Mutation gar nicht griff).
    const sentNames = sentToolNames(driveToCompletion(mutated));
    assert.ok(sentNames.includes(OLD_CALL_RESULT_NAME), "Positiv-Kontrolle: das mutierte Skript sendet den alten Namen");

    assert.throws(
      () => assertSentNamesMatchToolsList(sentNames, toolNames),
      "die Hauptpruefung (T12-d oben), auf das mutierte Skript angewendet, wirft - am Zwischenstand ohne diese Gegenprobe waere sie gruen geblieben",
    );
  } finally {
    await srv.stop();
  }
});
