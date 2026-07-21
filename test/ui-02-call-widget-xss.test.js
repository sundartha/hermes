// UI-02 (PLAN-LAUNCH-TESTS.md, Launch-Testlauf 1): boesartiges Transkript durch den
// call.html-Poll-Pfad (get_transcript + get_call_status). Bekannte XSS-Payloads
// (Transkript-Zeile, call_id, result_summary) landen NUR als sichtbarer Text
// (textContent) - nie als DOM-Node/geparstes Markup/Event-Handler.
//
// Technik (Regel 2, kein jsdom): 1:1 das Muster aus test/mcp-ui-w1-call-widget.test.js
// - das eigene Inline-Skript von call.html wird aus widgetHtml("call") extrahiert und in
// einer node:vm-Sandbox mit einem minimalen Fake-DOM ausgefuehrt (Node-Bordmittel, kein
// neuer Dependency). Die Payloads laufen dabei ueber den ECHTEN Empfangspfad
// (applyCallStatus/applyTranscript -> renderTranscriptLines/setSlotText), nicht ueber
// eine Testattrappe - bewiesen wird die tatsaechliche Verdrahtung, nicht nur die Form.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { widgetHtml, WIDGET_CALL } from "../src/ui/widget-catalog.js";
import { BIND_SCRIPT, signalUiReady } from "../src/ui/widget-bind.js";

// XSS-Payloads aus dem Testplan (UI-02): <img onerror>, Tag-Breakout, Anfuehrungszeichen.
const PAYLOAD_IMG = '<img src=x onerror=alert(1)>';
const PAYLOAD_BREAKOUT = '</div><script>alert(1)</script>';
const PAYLOAD_SINGLE_QUOTE = "'";
const PAYLOAD_DOUBLE_QUOTE = '"';
const ALL_PAYLOADS = [PAYLOAD_IMG, PAYLOAD_BREAKOUT, PAYLOAD_SINGLE_QUOTE, PAYLOAD_DOUBLE_QUOTE];

// ---- Fake-DOM (1:1 Muster aus test/mcp-ui-w1-call-widget.test.js: nur die Selektoren,
// die das Inline-Skript von call.html tatsaechlich anfasst) ----
const SLOT_NAMES = ["status", "last_transcript_lines", "call_id", "result_summary"];
const DISPLAY_SELECTORS = ["[data-duration-display]", "[data-failure-display]", "[data-objective-display]"];
const ROW_NAMES = ["lines", "failure", "summary", "objective"];

function makeFakeElement() {
  const listeners = {};
  return {
    _text: "",
    className: "",
    children: [],
    style: {},
    disabled: false,
    get firstChild() {
      return this.children.length ? this.children[0] : null;
    },
    get textContent() {
      return this._text;
    },
    set textContent(v) {
      this._text = v;
      this.children = [];
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
      return child;
    },
    addEventListener(type, handler) {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    click() {
      for (const h of listeners.click || []) h();
    },
  };
}

function makeFakeDocument() {
  const bySelector = new Map();
  for (const name of SLOT_NAMES) bySelector.set(`[data-mcp="${name}"]`, makeFakeElement());
  for (const sel of DISPLAY_SELECTORS) bySelector.set(sel, makeFakeElement());
  for (const name of ROW_NAMES) bySelector.set(`[data-row="${name}"]`, makeFakeElement());
  bySelector.set("[data-cancel]", makeFakeElement());
  const wingEl = makeFakeElement();
  wingEl.className = "wing wing--dark wing--idle";
  bySelector.set("[data-wing]", wingEl);
  bySelector.set("[data-wing-canvas]", makeFakeElement());
  const wingImg = makeFakeElement();
  wingImg.src = "data:image/png;base64,FAKE";
  bySelector.set("[data-wing] img", wingImg);
  bySelector.set("[data-status-pill]", makeFakeElement());
  bySelector.set("[data-status-dot]", makeFakeElement());
  bySelector.set("[data-status-label]", makeFakeElement());
  bySelector.set("[data-hud-phase]", makeFakeElement());
  const ringSvg = makeFakeElement();
  ringSvg.setAttribute = function (attr, value) {
    if (attr === "class") this.className = value;
  };
  bySelector.set("[data-ring]", ringSvg);
  const ringArc = makeFakeElement();
  ringArc.setAttribute = function (attr, value) {
    if (attr === "stroke-dasharray") this.strokeDasharray = value;
  };
  bySelector.set("[data-ring-arc]", ringArc);
  return {
    querySelector: (sel) => bySelector.get(sel) || null,
    createElement: () => makeFakeElement(),
    slot: (name) => bySelector.get(`[data-mcp="${name}"]`),
    row: (name) => bySelector.get(`[data-row="${name}"]`),
  };
}

// Extrahiert NUR das eigene Inline-Skript von call.html (ohne das angehaengte
// BIND_SCRIPT) - identisch zu ownScriptSource() in mcp-ui-w1-call-widget.test.js.
function ownScriptSource() {
  const html = widgetHtml(WIDGET_CALL).replace(BIND_SCRIPT, "");
  const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(matches.length >= 1, "eigenes Inline-Skript in call.html gefunden");
  return matches[matches.length - 1][1];
}

// Fuehrt das eigene Inline-Skript in einer frischen vm-Sandbox aus (window === die
// Sandbox selbst, wie im echten Iframe). Timer sind No-op-Fakes - dieser Test braucht
// kein echtes Polling, nur den Empfangspfad (handleMessage -> applyCallStatus/applyTranscript).
function runOwnScript(doc) {
  const sandbox = {};
  sandbox.document = doc;
  sandbox.window = sandbox;
  sandbox._posted = [];
  sandbox.parent = { postMessage: (msg) => sandbox._posted.push(msg) };
  const listeners = {};
  sandbox.addEventListener = (type, handler) => {
    listeners[type] = listeners[type] || [];
    listeners[type].push(handler);
  };
  sandbox.CustomEvent = function CustomEvent(type) {
    this.type = type;
  };
  sandbox.dispatchEvent = (event) => {
    for (const h of listeners[event.type] || []) h(event);
  };
  sandbox.setInterval = () => 1;
  sandbox.clearInterval = () => {};
  sandbox.setTimeout = () => 1;
  sandbox.clearTimeout = () => {};

  vm.createContext(sandbox);
  vm.runInContext(ownScriptSource(), sandbox);

  return {
    emit: (data) => {
      for (const h of listeners.message || []) h({ data });
    },
    posted: sandbox._posted,
    uiReady: () => signalUiReady(sandbox),
  };
}

test("UI-02 statisch: call.html enthaelt kein innerHTML (Slot-Fuellung ausschliesslich ueber textContent)", () => {
  const html = widgetHtml("call");
  assert.ok(!html.includes("innerHTML"), "kein innerHTML im ausgelieferten call.html (XSS-Gate)");
  // renderTranscriptLines/setSlotText/setDisplayText sind die einzigen Slot-Schreibpfade
  // des eigenen Inline-Skripts - alle drei muessen textContent nutzen.
  assert.match(html, /function renderTranscriptLines\(lines\)/);
  assert.match(html, /div\.textContent\s*=\s*String\(lines\[i\]\)/);
  assert.match(html, /function setSlotText\(name, value\)/);
  assert.match(html, /el\.textContent\s*=\s*value/);
});

test("UI-02: get_call_status-Push mit boesartigen Transkriptzeilen -> renderTranscriptLines legt sie ausschliesslich als textContent ab (kein DOM-Node/Event/alert)", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  doc.slot("call_id").textContent = "call_xss1";

  // Simuliert die Kanal-A-Notification, die get_call_status ausloest (Wire-Form
  // identisch zum initialen place_call-Push, s. Datei-Kommentar in call.html).
  env.emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      structuredContent: {
        call_id: "call_xss1",
        status: "in_progress",
        duration_s: 3,
        last_transcript_lines: ALL_PAYLOADS,
        failure_reason: null,
      },
    },
  });

  const container = doc.slot("last_transcript_lines");
  assert.equal(container.children.length, ALL_PAYLOADS.length, "je Payload GENAU ein Zeilen-Knoten");
  container.children.forEach((div, i) => {
    assert.equal(div.className, "turn", "Zeile traegt die erwartete CSS-Klasse, kein Fremd-Markup");
    assert.equal(div.textContent, ALL_PAYLOADS[i], "Payload roh als textContent, byte-identisch");
    assert.equal(div.children.length, 0, "kein aus dem Payload geparstes DOM-Kind (kein innerHTML-Pfad)");
  });

  // call_id selbst laeuft ueber dieselbe setSlotText()-Funktion (generische Slot-
  // Fuellung) - auch hier nur textContent, kein Markup-Parsing.
  env.emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      structuredContent: {
        call_id: PAYLOAD_IMG,
        status: "in_progress",
        duration_s: 3,
        last_transcript_lines: [],
        failure_reason: null,
      },
    },
  });
  assert.equal(doc.slot("call_id").textContent, PAYLOAD_IMG, "call_id-Slot: Payload roh als Text");
  assert.equal(doc.slot("call_id").children.length, 0, "call_id-Slot: kein DOM-Kind erzeugt");
});

// Ein echtes call.html-Widget ist an GENAU EINEN Call gebunden (eine Karte pro Call) und
// bekaeme fuer seinen get_transcript-Request GENAU EINE Antwort. Die urspruengliche Fassung
// dieses Tests wiederverwendete dieselbe Widget-Instanz + dieselbe Request-Id fuer alle 4
// Payloads - dadurch beantwortete das Widget (nach dem ersten Resolve) den zweiten "completed"-
// Push ueberhaupt nicht mehr mit einem neuen get_transcript-Call. Das war ein Testbug (falsche
// Simulation der Widget-Lebensdauer), kein Produktbug - Fix: pro Payload eine FRISCHE
// Widget-Instanz (= frische Karte fuer einen neuen Call), exakt wie in der Realitaet.
for (const [idx, payload] of ALL_PAYLOADS.entries()) {
  test(`UI-02: get_transcript-Antwort (Kanal B) mit boesartigem result_summary -> nur Text, kein Markup (Payload ${idx + 1}/${ALL_PAYLOADS.length}: ${JSON.stringify(payload)})`, () => {
    const doc = makeFakeDocument();
    const env = runOwnScript(doc);
    env.uiReady();
    const callId = `call_xss2_${idx}`;
    doc.slot("call_id").textContent = callId;

    // completed-Push loest intern fetchTranscriptOnce() -> sendToolCall(get_transcript) aus
    // (bewiesener Pfad, s. T-W1-call-AC5 in mcp-ui-w1-call-widget.test.js) - wir kapern die
    // dabei tatsaechlich versandte Anfrage und beantworten sie mit dem Payload.
    env.emit({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        structuredContent: {
          call_id: callId,
          status: "completed",
          duration_s: 10,
          last_transcript_lines: [],
          failure_reason: null,
        },
      },
    });
    const transcriptReq = env.posted.find((m) => m.params && m.params.name === "get_transcript");
    assert.ok(transcriptReq, `get_transcript wurde fuer ${callId} versandt`);

    env.emit({
      jsonrpc: "2.0",
      id: transcriptReq.id,
      result: {
        structuredContent: { call_id: callId, result_summary: payload, objective_achieved: true },
      },
    });
    assert.equal(doc.slot("result_summary").textContent, payload, `result_summary bleibt roher Text fuer ${JSON.stringify(payload)}`);
    assert.equal(doc.slot("result_summary").children.length, 0, "kein DOM-Kind aus result_summary geparst");
  });
}

test("UI-02: failure_reason-Anzeige (unbekannter/boesartiger Token) landet ueber setDisplayText -> textContent, kein Markup", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  doc.slot("call_id").textContent = "call_xss3";

  env.emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      structuredContent: {
        call_id: "call_xss3",
        status: "failed",
        duration_s: 4,
        last_transcript_lines: [],
        failure_reason: PAYLOAD_IMG,
      },
    },
  });
  const el = doc.querySelector("[data-failure-display]");
  assert.equal(el.textContent, PAYLOAD_IMG, "unbekannter Reason-Token bleibt roh sichtbar, aber als Text");
  assert.equal(el.children.length, 0, "kein DOM-Kind aus dem Reason-Token geparst");
});
