// W1: das vereinte Call-Widget (src/ui/widgets/call.html). Prueft die statische
// Slot-/String-Form ueber widgetHtml() UND das eigene Inline-Skript dynamisch ueber
// eine Fake-DOM/Fake-Window-Ausfuehrung mit node:vm (Node-Bordmittel, kein neuer
// Dependency) - analog dem Fake-DOM-Muster aus mcp-ui-w1-bind.test.js, diesmal auf
// den tatsaechlich ausgelieferten Skript-Text angewendet statt auf importierte
// ESM-Funktionen (call.html hat keinen Import, self-contained Iframe).
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { hasWidget, widgetTitle, widgetHtml, WIDGET_CALL } from "../src/ui/widget-catalog.js";
import { BIND_SCRIPT } from "../src/ui/widget-bind.js";
import { WING_PNG } from "../design-system/components/brand/wing-image.js";

const SLOT_NAMES = [
  "status",
  "duration_s",
  "last_transcript_lines",
  "call_id",
  "failure_reason",
  "result_summary",
  "objective_achieved",
  "bridge_format",
  "last_update",
];
const ROW_NAMES = ["lines", "failure", "summary", "objective"];

// Minimal-Fake eines DOM-Elements: textContent (Setter leert Kinder wie echtes DOM),
// style.display, disabled, Kind-Verwaltung, addEventListener/click - genau die
// Oberflaeche, die call.html anfasst.
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

// Fake-Document: kennt genau die Selektoren, die call.html abfragt
// ([data-mcp="..."], [data-row="..."], [data-cancel]). Jeder Selektor bekommt ein
// EIGENES Fake-Element (kein geteiltes DOM-Knoten-Modell noetig - das Skript liest/
// schreibt jeden Slot ausschliesslich ueber seinen eigenen Selektor).
function makeFakeDocument() {
  const bySelector = new Map();
  for (const name of SLOT_NAMES) bySelector.set(`[data-mcp="${name}"]`, makeFakeElement());
  for (const name of ROW_NAMES) bySelector.set(`[data-row="${name}"]`, makeFakeElement());
  bySelector.set("[data-cancel]", makeFakeElement());
  bySelector.set("[data-wing]", makeFakeElement());
  return {
    querySelector: (sel) => bySelector.get(sel) || null,
    createElement: () => makeFakeElement(),
    slot: (name) => bySelector.get(`[data-mcp="${name}"]`),
    row: (name) => bySelector.get(`[data-row="${name}"]`),
    cancelButton: () => bySelector.get("[data-cancel]"),
    wing: () => bySelector.get("[data-wing]"),
  };
}

// Objekte, die IM vm-Sandbox-Skript entstehen (z.B. die geposteten JSON-RPC-params),
// leben in einer eigenen Realm mit eigenem Object.prototype. node:assert/strict
// vergleicht bei deepEqual zusaetzlich den Prototyp und wirft sonst "same structure
// but not reference-equal", obwohl die Daten identisch sind. JSON-Rundreise
// normalisiert auf reine Daten (hier immer einfache {call_id} Objekte, kein Verlust).
function crossRealmPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

// Extrahiert NUR das eigene Inline-Skript von call.html (ohne das angehaengte
// BIND_SCRIPT, das die Katalog-Ladefunktion injiziert - widget-catalog.js:withBindScript).
function ownScriptSource() {
  const html = widgetHtml(WIDGET_CALL).replace(BIND_SCRIPT, "");
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(match, "eigenes Inline-Skript in call.html gefunden");
  return match[1];
}

// Fuehrt das eigene Inline-Skript in einer frischen vm-Sandbox aus (window === die
// Sandbox selbst, wie im echten Iframe window === globalThis). Timer sind synchron
// erfassbare Fakes (F.I.R.S.T. - Fast, kein echtes Warten im Test).
function runOwnScript(doc, options) {
  const sandbox = {};
  sandbox.document = doc;
  sandbox.window = sandbox;
  sandbox.openai = options && options.openai;
  sandbox._posted = [];
  sandbox.parent = { postMessage: (msg) => sandbox._posted.push(msg) };
  const listeners = {};
  sandbox.addEventListener = (type, handler) => {
    listeners[type] = listeners[type] || [];
    listeners[type].push(handler);
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
  vm.runInContext(ownScriptSource(), sandbox);

  return {
    emit: (data) => {
      for (const h of listeners.message || []) h({ data });
    },
    posted: sandbox._posted,
    intervalFns,
    timeoutFns,
    fireInterval: () => {
      for (const fn of intervalFns.values()) fn();
    },
    fireTimeout: () => {
      for (const fn of timeoutFns.values()) fn();
    },
  };
}

test("T-W1-call-AC1: hasWidget/widgetTitle kennen das call-Widget", () => {
  assert.equal(WIDGET_CALL, "call");
  assert.equal(hasWidget("call"), true);
  assert.equal(widgetTitle("call"), "Hermes Call");
});

test('T-W1-call-AC2: BIND_SCRIPT genau einmal in widgetHtml("call")', () => {
  const html = widgetHtml("call");
  assert.equal(html.split(BIND_SCRIPT).length, 2, "BIND_SCRIPT genau einmal eingefuegt");
  assert.ok(html.lastIndexOf(BIND_SCRIPT) < html.lastIndexOf("</body>"), "BIND_SCRIPT vor </body>");
});

test("T-W1-call-AC3: alle 9 data-mcp-Slots vorhanden", () => {
  const html = widgetHtml("call");
  for (const name of SLOT_NAMES) {
    assert.match(html, new RegExp(`data-mcp="${name}"`), `Slot ${name} vorhanden`);
  }
});

test("T-W1-call-AC4: Inline-Skript enthaelt Poll-Konstante + alle Tool-/Bruecken-Strings", () => {
  const html = widgetHtml("call");
  assert.match(html, /setInterval/);
  assert.match(html, /POLL_INTERVAL_MS\s*=\s*8000/);
  assert.match(html, /"get_call_status"/);
  assert.match(html, /"get_transcript"/);
  assert.match(html, /"cancel_call"/);
  assert.match(html, /window\.openai/);
  assert.match(html, /"tools\/call"/);
  assert.match(html, /"ui\/tool-call"/);
});

test("T-W1-call-AC6: kein innerHTML/@import/<link/href= im Widget", () => {
  const html = widgetHtml("call");
  assert.ok(!html.includes("innerHTML"), "kein innerHTML (XSS-Gate, S1)");
  assert.ok(!html.includes("@import"), "kein @import");
  assert.doesNotMatch(html, /<link[\s>]/, "kein <link>-Element");
  assert.doesNotMatch(html, /href\s*=/, "kein href-Linkback");
});

test("T-W1-call-AC5/AC7a: Terminal-Notification (completed) fuellt Slots, deaktiviert Cancel, erreicht clearInterval, holt get_transcript GENAU EINMAL", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);

  // Simuliert den bereits bewiesenen Empfangspfad (widget-bind.js bindet call_id aus
  // dem initialen place_call-Push, BEVOR unser eigenes Skript pollt).
  doc.slot("call_id").textContent = "call_1";

  // Vor dem ersten Poll-Response darf get_transcript NICHT versucht worden sein.
  assert.equal(env.posted.filter((m) => m.params && m.params.name === "get_transcript").length, 0);

  // Zwischenschritt: in_progress darf get_transcript weiterhin NICHT ausloesen.
  env.emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      structuredContent: {
        call_id: "call_1",
        status: "in_progress",
        duration_s: 5,
        last_transcript_lines: ["Agent: hallo"],
        failure_reason: null,
      },
    },
  });
  assert.equal(doc.slot("status").textContent, "in_progress");
  assert.equal(doc.row("lines").style.display, "", "Transkriptzeilen sichtbar bei in_progress");
  assert.equal(doc.cancelButton().disabled, false, "Cancel bleibt aktiv, nicht terminal");
  assert.equal(env.posted.filter((m) => m.params && m.params.name === "get_transcript").length, 0);

  // Terminal-Notification: completed.
  env.emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      structuredContent: {
        call_id: "call_1",
        status: "completed",
        duration_s: 42,
        last_transcript_lines: [],
        failure_reason: null,
      },
    },
  });

  assert.equal(doc.slot("status").textContent, "completed");
  assert.equal(doc.slot("duration_s").textContent, "42");
  assert.equal(env.intervalFns.size, 0, "clearInterval erreicht - kein weiterer Poll (AC7)");
  assert.equal(env.timeoutFns.size, 0, "auch der 15s-Fallback-Timer wird gestoppt");
  assert.equal(doc.cancelButton().disabled, true, "Cancel deaktiviert bei Terminal-Status (AC5)");
  assert.equal(doc.cancelButton().style.display, "none", "Cancel zusaetzlich versteckt");
  assert.equal(doc.row("lines").style.display, "none", "Transkriptzeilen ausgeblendet nach Terminal");
  assert.equal(
    env.posted.filter((m) => m.params && m.params.name === "get_transcript").length,
    2,
    "get_transcript NUR im Terminal-Zweig (completed) versucht - beide Kandidaten, da noch kein Format bestaetigt",
  );

  // Get-transcript-Antwort einspielen -> result_summary/objective_achieved gefuellt.
  const transcriptReq = env.posted.find((m) => m.params && m.params.name === "get_transcript");
  env.emit({
    jsonrpc: "2.0",
    id: transcriptReq.id,
    result: { structuredContent: { call_id: "call_1", result_summary: "Termin gebucht.", objective_achieved: true } },
  });
  assert.equal(doc.slot("result_summary").textContent, "Termin gebucht.");
  assert.equal(doc.slot("objective_achieved").textContent, "true");
  assert.equal(doc.row("summary").style.display, "", "Ergebnis-Zeile sichtbar nach completed");

  // Erneutes Terminal-Signal darf get_transcript NICHT erneut ausloesen (Guard).
  env.emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: { structuredContent: { call_id: "call_1", status: "completed", duration_s: 43, last_transcript_lines: [], failure_reason: null } },
  });
  assert.equal(env.posted.filter((m) => m.params && m.params.name === "get_transcript").length, 2, "get_transcript bleibt einmalig");
});

test("T-W1-call-AC7b: alle drei Bruecken-Kandidaten werden auf einem Tick versucht (window.openai + beide postMessage-Methoden)", () => {
  const openaiCalls = [];
  const doc = makeFakeDocument();
  const env = runOwnScript(doc, {
    openai: { callTool: (name, args) => (openaiCalls.push({ name, args }), new Promise(() => {})) },
  });
  doc.slot("call_id").textContent = "call_1";

  env.fireInterval(); // simuliert den naechsten 8s-Tick

  assert.equal(openaiCalls.length >= 1, true, "window.openai.callTool versucht");
  assert.equal(openaiCalls[0].name, "get_call_status");
  const methods = env.posted.map((m) => m.method);
  assert.ok(methods.includes("tools/call"), "tools/call versucht");
  assert.ok(methods.includes("ui/tool-call"), "ui/tool-call versucht");
  for (const m of env.posted) {
    assert.equal(m.params.name, "get_call_status");
    assert.deepEqual(crossRealmPlain(m.params.arguments), { call_id: "call_1" });
  }
});

test("T-W1-call-AC7c: sobald ein Format bestaetigt ist, nutzen Folge-Ticks nur noch dieses (Kanal B, id-gematcht)", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  doc.slot("call_id").textContent = "call_1";

  env.fireInterval(); // 2 Kandidaten unterwegs (kein window.openai in diesem Test)
  const toolsCallReq = env.posted.find((m) => m.method === "tools/call");
  assert.ok(toolsCallReq, "tools/call-Versuch vorhanden");

  env.emit({
    jsonrpc: "2.0",
    id: toolsCallReq.id,
    result: { structuredContent: { call_id: "call_1", status: "in_progress", duration_s: 10, last_transcript_lines: [], failure_reason: null } },
  });
  assert.equal(doc.slot("bridge_format").textContent, "tools/call", "bestaetigtes Format in der Diagnose-Zeile");

  env.posted.length = 0;
  env.fireInterval(); // naechster Tick NACH Bestaetigung
  assert.equal(env.posted.length, 1, "nur noch EIN Versuch, nicht mehr drei");
  assert.equal(env.posted[0].method, "tools/call");
});

test("T-W1-call-AC7d: Fallback nach 15s ohne jede Antwort - clearInterval, Diagnose 'kein Live-Update', initialer Zustand bleibt", () => {
  const doc = makeFakeDocument();
  doc.slot("status").textContent = "dialing";
  const env = runOwnScript(doc);
  doc.slot("call_id").textContent = "call_1";

  env.fireTimeout(); // simuliert Ablauf von FALLBACK_TIMEOUT_MS ohne jede Host-Antwort

  assert.equal(env.intervalFns.size, 0, "Polling gestoppt");
  assert.equal(doc.slot("bridge_format").textContent, "kein Live-Update");
  assert.equal(doc.slot("status").textContent, "dialing", "initialer Status bleibt sichtbar (nie leer)");
});

test("T-W1-call-AC7e: failed-Status zeigt failure_reason, holt KEIN get_transcript", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  doc.slot("call_id").textContent = "call_1";

  env.emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      structuredContent: {
        call_id: "call_1",
        status: "failed",
        duration_s: 12,
        last_transcript_lines: [],
        failure_reason: "Keine Antwort",
      },
    },
  });

  assert.equal(doc.slot("failure_reason").textContent, "Keine Antwort");
  assert.equal(doc.row("failure").style.display, "", "Grund-Zeile sichtbar bei failed");
  assert.equal(doc.row("summary").style.display, "none", "Ergebnis-Zeile bleibt versteckt bei failed");
  assert.equal(env.posted.filter((m) => m.params && m.params.name === "get_transcript").length, 0);
  assert.equal(doc.cancelButton().disabled, true);
});

test("T-W1-call-AC-cancel: Cancel-Klick ruft cancel_call ueber dieselbe Bruecke, no-op ohne gebundene call_id", () => {
  const docNoCallId = makeFakeDocument();
  const envNoCallId = runOwnScript(docNoCallId);
  docNoCallId.cancelButton().click();
  assert.equal(envNoCallId.posted.length, 0, "kein Aufruf ohne call_id (fail-safe)");

  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  doc.slot("call_id").textContent = "call_1";
  doc.cancelButton().click();

  assert.equal(doc.cancelButton().disabled, true, "Button deaktiviert sich optimistisch");
  const cancelReqs = env.posted.filter((m) => m.params && m.params.name === "cancel_call");
  assert.equal(cancelReqs.length, 2, "beide Kandidaten versucht (noch kein Format bestaetigt)");
  assert.deepEqual(crossRealmPlain(cancelReqs[0].params.arguments), { call_id: "call_1" });
});

test("T-W1-call-AC-wing-static: alle 6 Wing-Keyframes + reduced-motion + idle-Default + byte-identisches WING_PNG", () => {
  const html = widgetHtml("call");
  const keyframes = [
    "hermesWingDrift", "hermesWingBob", "hermesWingConnect",
    "hermesWingFlap", "hermesWingSuccess", "hermesWingError",
  ];
  for (const name of keyframes) {
    assert.match(html, new RegExp("@keyframes\\s+" + name + "\\s*\\{"), `Keyframe ${name} vorhanden`);
  }
  assert.match(html, /prefers-reduced-motion/, "reduced-motion-Regel vorhanden");
  assert.match(html, /class="wing wing--idle"[^>]*data-wing/, "Wing-Wrapper startet idle, ueber data-wing markiert");
  assert.ok(html.includes(WING_PNG), "WING_PNG byte-identisch aus wing-image.js eingebettet (kein Transkriptionsfehler)");
});

test("T-W1-call-AC-wing: Statuswechsel spiegelt sich als Klassenwechsel auf dem Wing-Wrapper (WingMark 5 States, cancelled->error)", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  doc.slot("call_id").textContent = "call_1";

  const statusToWingClass = [
    ["dialing", "wing wing--connecting"],
    ["in_progress", "wing wing--working"],
    ["completed", "wing wing--success"],
    ["failed", "wing wing--error"],
    ["cancelled", "wing wing--error"],
  ];
  for (const [status, expectedClass] of statusToWingClass) {
    env.emit({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        structuredContent: { call_id: "call_1", status, duration_s: 1, last_transcript_lines: [], failure_reason: null },
      },
    });
    assert.equal(doc.wing().className, expectedClass, `Status ${status} -> ${expectedClass}`);
  }
});
