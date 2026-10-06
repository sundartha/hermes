import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { hasWidget, widgetTitle, widgetHtml, WIDGET_CALL } from "../src/ui/widget-catalog.js";
import { BIND_SCRIPT, signalUiReady, UI_READY_FLAG, UI_READY_EVENT } from "../src/ui/widget-bind.js";
import { I18N_SCRIPT, WIDGET_LOCALE_META_KEY } from "../src/ui/widget-i18n.js";
import { WING_PNG } from "../design-system/components/brand/wing-image.js";

const SLOT_NAMES = [
  "status",
  "last_transcript_lines",
  "call_id",
  "result_summary",
  "outcome",
  "next_step",
];
const DISPLAY_SELECTORS = [
  "[data-duration-display]",
  "[data-failure-display]",
  "[data-objective-display]",
];
const REMOVED_SLOT_NAMES = ["duration_s", "failure_reason", "objective_achieved", "bridge_format", "last_update"];
const ROW_NAMES = ["lines", "failure", "summary", "objective", "outcome", "next_step"];

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
  ringSvg.setAttribute = function (attr, value) { if (attr === "class") this.className = value; };
  bySelector.set("[data-ring]", ringSvg);
  const ringArc = makeFakeElement();
  ringArc.setAttribute = function (attr, value) { if (attr === "stroke-dasharray") this.strokeDasharray = value; };
  bySelector.set("[data-ring-arc]", ringArc);
  return {
    querySelector: (sel) => bySelector.get(sel) || null,
    querySelectorAll: () => [],
    documentElement: { lang: "" },
    createElement: () => makeFakeElement(),
    slot: (name) => bySelector.get(`[data-mcp="${name}"]`),
    row: (name) => bySelector.get(`[data-row="${name}"]`),
    cancelButton: () => bySelector.get("[data-cancel]"),
    wing: () => bySelector.get("[data-wing]"),
    hudPhase: () => bySelector.get("[data-hud-phase]"),
    ring: () => bySelector.get("[data-ring]"),
    ringArc: () => bySelector.get("[data-ring-arc]"),
  };
}

function withMissingSelector(doc, missingSelector) {
  const original = doc.querySelector;
  doc.querySelector = (sel) => (sel === missingSelector ? null : original(sel));
  return doc;
}

function crossRealmPlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function ownScriptSource() {
  const html = widgetHtml(WIDGET_CALL).replace(BIND_SCRIPT, "");
  const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.ok(matches.length >= 1, "eigenes Inline-Skript in call.html gefunden");
  return matches[matches.length - 1][1];
}

function scriptBodyOf(script) {
  return script.match(/<script>([\s\S]*)<\/script>/)[1];
}

function runOwnScript(doc, options) {
  const sandbox = {};
  sandbox.document = doc;
  sandbox.window = sandbox;
  sandbox.HermesWingCanvas = options && options.hermesWingCanvas;
  sandbox._posted = [];
  sandbox.parent = { postMessage: (msg) => sandbox._posted.push(msg) };
  const listeners = {};
  sandbox.addEventListener = (type, handler) => {
    listeners[type] = listeners[type] || [];
    listeners[type].push(handler);
  };
  sandbox.CustomEvent = function CustomEvent(type) { this.type = type; };
  sandbox.dispatchEvent = (event) => {
    for (const h of listeners[event.type] || []) h(event);
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

  if (options && options.readyBeforeScript) sandbox[UI_READY_FLAG] = true;

  vm.createContext(sandbox);
  if (options && options.withI18n) vm.runInContext(scriptBodyOf(I18N_SCRIPT), sandbox);
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
    uiReady: () => signalUiReady(sandbox),
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

test("T-W1-call-AC3: data-mcp-Slots + Anzeige-Elemente vorhanden, Debug-Slots restlos raus", () => {
  const html = widgetHtml("call");
  for (const name of SLOT_NAMES) {
    assert.match(html, new RegExp(`data-mcp="${name}"`), `Slot ${name} vorhanden`);
  }
  for (const sel of DISPLAY_SELECTORS) {
    const attr = sel.slice(1, -1);
    assert.ok(html.includes(attr), `Anzeige-Element ${attr} vorhanden`);
  }
  for (const name of REMOVED_SLOT_NAMES) {
    assert.ok(!html.includes(`data-mcp="${name}"`), `kein data-mcp-Slot mehr fuer ${name}`);
  }
  assert.ok(!html.includes("id-block"), "ID-Block (call_id/Status roh) entfernt");
  assert.ok(!html.includes('class="diag"'), "Diagnose-Zeile entfernt");
  assert.ok(html.includes('class="foot-mark"'), "Fuss-Wortmarke vorhanden");
  assert.ok(html.includes('class="meander"'), "Maeander-Fries vorhanden");
});

test("T-W1-call-AC4: Inline-Skript enthaelt Poll-Konstante + alle Tool-Namen + den Sendeweg", () => {
  const html = widgetHtml("call");
  assert.match(html, /setInterval/);
  assert.match(html, /POLL_INTERVAL_MS\s*=\s*8000/);
  assert.match(html, /"get_call_status"/);
  assert.match(html, /"get_call_result"/);
  assert.match(html, /"cancel_call"/);
  assert.match(html, /"tools\/call"/);
});

test("T-W1-call-AC6: kein innerHTML/@import/<link/href= im Widget", () => {
  const html = widgetHtml("call");
  assert.ok(!html.includes("innerHTML"), "kein innerHTML (XSS-Gate, S1)");
  assert.ok(!html.includes("@import"), "kein @import");
  assert.doesNotMatch(html, /<link[\s>]/, "kein <link>-Element");
  assert.doesNotMatch(html, /href\s*=/, "kein href-Linkback");
});

test("T-W1-call-AC5/AC7a: Terminal-Notification (completed) fuellt Slots, deaktiviert Cancel, erreicht clearInterval, holt get_call_result GENAU EINMAL", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();

  doc.slot("call_id").textContent = "call_1";

  assert.equal(env.posted.filter((m) => m.params && m.params.name === "get_call_result").length, 0);

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
  assert.equal(env.posted.filter((m) => m.params && m.params.name === "get_call_result").length, 0);

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
  assert.equal(
    doc.querySelector("[data-duration-display]").textContent,
    "0:42",
    "Dauer formatiert als m:ss (nicht mehr roher Sekundenwert)",
  );
  assert.equal(env.intervalFns.size, 0, "clearInterval erreicht - kein weiterer Poll (AC7)");
  assert.equal(env.timeoutFns.size, 0, "auch der 15s-Fallback-Timer wird gestoppt");
  assert.equal(doc.cancelButton().disabled, true, "Cancel deaktiviert bei Terminal-Status (AC5)");
  assert.equal(doc.cancelButton().style.display, "none", "Cancel zusaetzlich versteckt");
  assert.equal(doc.row("lines").style.display, "none", "Transkriptzeilen ausgeblendet nach Terminal");
  assert.equal(
    env.posted.filter((m) => m.params && m.params.name === "get_call_result").length,
    1,
    "get_call_result NUR im Terminal-Zweig (completed) versucht - genau EIN Versuch (tools/call)",
  );

  const transcriptReq = env.posted.find((m) => m.params && m.params.name === "get_call_result");
  env.emit({
    jsonrpc: "2.0",
    id: transcriptReq.id,
    result: { structuredContent: { call_id: "call_1", result_summary: "Termin gebucht.", objective_achieved: true } },
  });
  assert.equal(doc.slot("result_summary").textContent, "Termin gebucht.");
  assert.equal(doc.querySelector("[data-objective-display]").textContent, "Yes");
  assert.equal(doc.row("summary").style.display, "", "Ergebnis-Zeile sichtbar nach completed");

  env.emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: { structuredContent: { call_id: "call_1", status: "completed", duration_s: 43, last_transcript_lines: [], failure_reason: null } },
  });
  assert.equal(env.posted.filter((m) => m.params && m.params.name === "get_call_result").length, 1, "get_call_result bleibt einmalig");
});

test("T-W1-call-G3: Terminal-Notification (completed) VOR dem Handshake verliert get_call_result nicht dauerhaft - der Poll-Tick nach dem Handshake holt ihn nach", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);

  env.emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      structuredContent: { call_id: "call_1", status: "completed", duration_s: 42, last_transcript_lines: [], failure_reason: null },
    },
  });
  assert.equal(env.posted.length, 0, "get_call_result-Versuch scheitert am ready-Gate - noch kein Versand");

  env.uiReady();

  assert.equal(env.posted.length, 1, "erster Versand nach dem Handshake ist der Poll-Tick, nicht der nachgeholte Transcript-Fetch");
  assert.equal(env.posted[0].params.name, "get_call_status");

  env.emit({
    jsonrpc: "2.0",
    id: env.posted[0].id,
    result: { structuredContent: { call_id: "call_1", status: "completed", duration_s: 42, last_transcript_lines: [], failure_reason: null } },
  });

  const transcriptReqs = env.posted.filter((m) => m.params && m.params.name === "get_call_result");
  assert.equal(transcriptReqs.length, 1, "get_call_result wird nach dem Handshake nachgeholt");
});

test("T-W1-call-F1: das ausgelieferte Widget kennt nur noch tools/call - keine Schrotflinte", () => {
  const html = widgetHtml("call");
  assert.ok(!html.includes("ui/tool-call"), "erfundene Methode ui/tool-call restlos raus");
  assert.ok(!html.includes("window.openai"), "ChatGPT-Pfad window.openai restlos raus (auch i18n-Bootstrap)");
  assert.ok(!html.includes("callTool"), "kein openai.callTool-Rest");
  assert.ok(!html.includes("confirmedFormat"), "tote Format-Auswahl entfernt");
  assert.match(html, /"tools\/call"/, "der spec-konforme Sendeweg bleibt");
});

test("T-W1-call-F1-tick: ein Poll-Tick postet GENAU EINE Nachricht, Methode tools/call", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  doc.slot("call_id").textContent = "call_1";

  env.posted.length = 0;
  env.fireInterval();

  assert.equal(env.posted.length, 1, "genau ein Versuch pro Tick");
  assert.equal(env.posted[0].method, "tools/call");
  assert.equal(env.posted[0].params.name, "get_call_status");
  assert.deepEqual(crossRealmPlain(env.posted[0].params.arguments), { call_id: "call_1" });
});

test("T-W1-call-F2: kein tools/call vor dem Handshake - erst das ready-Signal startet das Polling", () => {
  const doc = makeFakeDocument();
  doc.slot("call_id").textContent = "call_1";
  const env = runOwnScript(doc);

  assert.equal(env.posted.length, 0, "kein tools/call vor dem Handshake");
  assert.equal(env.intervalFns.size, 0, "kein Polling-Timer vor dem Handshake");

  env.uiReady();

  assert.equal(env.posted.length, 1, "sofort ein tools/call nach dem Handshake");
  assert.equal(env.posted[0].method, "tools/call");
  assert.equal(env.intervalFns.size, 1, "Poll-Timer laeuft ab dem Handshake");
});

test("T-W1-call-F2-late-safe: Flag schon gesetzt, bevor das Inline-Skript laeuft -> Sofortstart", () => {
  const doc = makeFakeDocument();
  doc.slot("call_id").textContent = "call_1";
  const env = runOwnScript(doc, { readyBeforeScript: true });

  assert.equal(env.posted.length, 1, "sofortiger tools/call-Versuch (Remount-/Reihenfolge-Fall)");
  assert.equal(env.posted[0].method, "tools/call");
  assert.equal(env.intervalFns.size, 1, "Poll-Timer laeuft sofort");
});

test("T-W1-call-F2-contract: Flag-/Event-Name in call.html == UI_READY_FLAG/UI_READY_EVENT aus widget-bind.js", () => {
  const html = widgetHtml("call");
  assert.ok(html.includes(JSON.stringify(UI_READY_FLAG)), "call.html kennt den Flag-Namen woertlich");
  assert.ok(BIND_SCRIPT.includes(JSON.stringify(UI_READY_FLAG)), "BIND_SCRIPT kennt den Flag-Namen woertlich");
  assert.ok(html.includes(JSON.stringify(UI_READY_EVENT)), "call.html kennt den Event-Namen woertlich");
  assert.ok(BIND_SCRIPT.includes(JSON.stringify(UI_READY_EVENT)), "BIND_SCRIPT kennt den Event-Namen woertlich");
});

test("T-W1-call-F3: 3 aufeinanderfolgende JSON-RPC-Fehler stoppen das Polling; ein Erfolg setzt zurueck; Karte behaelt letzten Stand", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  env.uiReady();
  doc.slot("call_id").textContent = "call_1";
  doc.slot("status").textContent = "in_progress";

  function respondWithError() {
    const req = env.posted[env.posted.length - 1];
    env.emit({ jsonrpc: "2.0", id: req.id, error: { code: -32000, message: "denied" } });
  }
  function respondWithSuccess() {
    const req = env.posted[env.posted.length - 1];
    env.emit({
      jsonrpc: "2.0",
      id: req.id,
      result: { structuredContent: { call_id: "call_1", status: "in_progress", duration_s: 1, last_transcript_lines: [], failure_reason: null } },
    });
  }

  env.fireInterval();
  respondWithError();
  env.fireInterval();
  respondWithError();
  assert.equal(env.intervalFns.size, 1, "2 Fehler in Folge - Polling laeuft weiter");

  env.fireInterval();
  respondWithSuccess();

  env.fireInterval();
  respondWithError();
  env.fireInterval();
  respondWithError();
  assert.equal(env.intervalFns.size, 1, "nach dem Erfolg wieder bei 2 Fehlern - Polling laeuft noch");

  env.fireInterval();
  respondWithError();
  assert.equal(env.intervalFns.size, 0, "3 aufeinanderfolgende Fehler - Polling gestoppt");
  assert.equal(doc.slot("status").textContent, "in_progress", "kein Blanking, letzter Stand bleibt sichtbar");
});

test("T-W1-call-AC7d: Fallback nach 15s ohne jede Antwort - clearInterval, initialer Zustand bleibt (keine sichtbare Diagnose mehr)", () => {
  const doc = makeFakeDocument();
  doc.slot("status").textContent = "dialing";
  const env = runOwnScript(doc);
  env.uiReady();
  doc.slot("call_id").textContent = "call_1";

  env.fireTimeout();

  assert.equal(env.intervalFns.size, 0, "Polling gestoppt");
  assert.equal(doc.slot("status").textContent, "dialing", "initialer Status bleibt sichtbar (nie leer)");
});

test("T-W1-call-AC7e: failed-Status zeigt lokalisierten failure_reason, holt KEIN get_call_result", () => {
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
        failure_reason: "no-answer",
      },
    },
  });

  assert.equal(doc.querySelector("[data-failure-display]").textContent, "No answer");
  assert.equal(doc.row("failure").style.display, "", "Grund-Zeile sichtbar bei failed");
  assert.equal(doc.row("summary").style.display, "none", "Ergebnis-Zeile bleibt versteckt bei failed");
  assert.equal(env.posted.filter((m) => m.params && m.params.name === "get_call_result").length, 0);
  assert.equal(doc.cancelButton().disabled, true);

  const doc2 = makeFakeDocument();
  const env2 = runOwnScript(doc2);
  doc2.slot("call_id").textContent = "call_2";
  env2.emit({ jsonrpc: "2.0", method: "ui/notifications/tool-result",
    params: { structuredContent: { call_id: "call_2", status: "failed", duration_s: 1, last_transcript_lines: [], failure_reason: "failed:487" } } });
  assert.equal(doc2.querySelector("[data-failure-display]").textContent, "Failed");
  env2.emit({ jsonrpc: "2.0", method: "ui/notifications/tool-result",
    params: { structuredContent: { call_id: "call_2", status: "failed", duration_s: 1, last_transcript_lines: [], failure_reason: "sonderfall-token" } } });
  assert.equal(doc2.querySelector("[data-failure-display]").textContent, "Failed");
});

test("T-W1-call-AC7f: die drei OUTBOUND-E2-Basis-Token (not-placed/unreachable/result-unknown) zeigen ein Label, keinen rohen Token", () => {
  const cases = [
    { failure_reason: "not-placed:start-403", expected: "Not placed" },
    { failure_reason: "unreachable:invite-404", expected: "Unreachable" },
    { failure_reason: "result-unknown:poll-timeout", expected: "Result unknown" },
  ];
  for (const { failure_reason, expected } of cases) {
    const doc = makeFakeDocument();
    const env = runOwnScript(doc);
    doc.slot("call_id").textContent = "call_x";
    env.emit({
      jsonrpc: "2.0",
      method: "ui/notifications/tool-result",
      params: {
        structuredContent: {
          call_id: "call_x",
          status: "failed",
          duration_s: 1,
          last_transcript_lines: [],
          failure_reason,
        },
      },
    });
    assert.equal(
      doc.querySelector("[data-failure-display]").textContent,
      expected,
      `"${failure_reason}" muss als "${expected}" erscheinen, nicht roh`,
    );
  }
});

test("T-W1-call-AC-cancel: Cancel-Klick ruft cancel_call ueber tools/call, no-op ohne gebundene call_id UND vor dem Handshake", () => {
  const docNoCallId = makeFakeDocument();
  const envNoCallId = runOwnScript(docNoCallId);
  envNoCallId.uiReady();
  docNoCallId.cancelButton().click();
  assert.equal(envNoCallId.posted.length, 0, "kein Aufruf ohne call_id (fail-safe)");

  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  doc.slot("call_id").textContent = "call_1";
  doc.cancelButton().click();
  assert.equal(env.posted.length, 0, "kein Aufruf vor dem Handshake - das ready-Gate traegt auch den Cancel-Pfad (F2)");

  env.uiReady();
  doc.cancelButton().click();

  assert.equal(doc.cancelButton().disabled, true, "Button deaktiviert sich optimistisch");
  const cancelReqs = env.posted.filter((m) => m.params && m.params.name === "cancel_call");
  assert.equal(cancelReqs.length, 1, "genau EIN Versuch (tools/call)");
  assert.deepEqual(crossRealmPlain(cancelReqs[0].params.arguments), { call_id: "call_1" });
});

test("T-W1-call-G2: Cancel-Klick vor dem Handshake deaktiviert den Button NICHT optisch - kein vorgetaeuschter Abbruch ohne tatsaechlichen Versand", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  doc.slot("call_id").textContent = "call_1";

  doc.cancelButton().click();

  assert.equal(env.posted.length, 0, "kein cancel_call vor dem Handshake");
  assert.equal(doc.cancelButton().disabled, false, "Button bleibt aktiv - sendToolCall() lief ins Leere, keine optische Luege ueber einen nie gesendeten Abbruch");
  assert.notEqual(doc.cancelButton().style.display, "none", "Button bleibt sichtbar");

  env.uiReady();
  doc.cancelButton().click();

  assert.equal(doc.cancelButton().disabled, true, "Button deaktiviert sich erst nach bestaetigtem Versand");
  const cancelReqs = env.posted.filter((m) => m.params && m.params.name === "cancel_call");
  assert.equal(cancelReqs.length, 1, "genau EIN tatsaechlicher Versand");
});

test("T-W1-call-AC-wing-static: alle 6 Wing-Keyframes + reduced-motion + dunkle idle-Auspraegung + byte-identisches WING_PNG (H3)", () => {
  const html = widgetHtml("call");
  const keyframes = [
    "hermesWingDrift", "hermesWingBob", "hermesWingConnect",
    "hermesWingFlap", "hermesWingSuccess", "hermesWingError",
  ];
  for (const name of keyframes) {
    assert.match(html, new RegExp("@keyframes\\s+" + name + "\\s*\\{"), `Keyframe ${name} vorhanden`);
  }
  assert.match(html, /prefers-reduced-motion/, "reduced-motion-Regel vorhanden");
  assert.match(html, /class="wing wing--dark wing--idle"[^>]*data-wing/, "Wing-Wrapper startet dunkel+idle, ueber data-wing markiert");
  assert.match(html, /\.wing--dark\{background:none\}/, "dunkle Auspraegung: navy Rundmarke neutralisiert (0dca7ce-Regression sonst)");
  assert.match(html, /data-ring[^-]/, "Status-Ring-Hook vorhanden");
  assert.ok(html.includes(WING_PNG), "WING_PNG byte-identisch aus wing-image.js eingebettet");
});

test("T-W1-call-AC-wing: Statuswechsel spiegelt sich als CSS-Klassenwechsel (Fallback) UND als Engine-setStatus-Aufruf (Canvas-Pfad, H3)", () => {
  const statusToWingClass = [
    ["dialing", "wing wing--dark wing--connecting"],
    ["in_progress", "wing wing--dark wing--working"],
    ["completed", "wing wing--dark wing--success"],
    ["failed", "wing wing--dark wing--error"],
    ["cancelled", "wing wing--dark wing--error"],
  ];

  const docA = makeFakeDocument();
  const envA = runOwnScript(docA);
  docA.slot("call_id").textContent = "call_1";
  for (const [status, expectedClass] of statusToWingClass) {
    envA.emit({ jsonrpc: "2.0", method: "ui/notifications/tool-result",
      params: { structuredContent: { call_id: "call_1", status, duration_s: 1, last_transcript_lines: [], failure_reason: null } } });
    assert.equal(docA.wing().className, expectedClass, `Fallback-Pfad: ${status} -> ${expectedClass}`);
  }
  assert.notEqual(docA.wing().style.display, "none", "ohne Engine bleibt die CSS-WingMark sichtbar");

  const docB = makeFakeDocument();
  const setStatusCalls = [];
  const fakeHandle = { setStatus: (s) => setStatusCalls.push(s) };
  const fakeMountCalls = [];
  const envB = runOwnScript(docB, {
    hermesWingCanvas: { mount: (host, opts) => (fakeMountCalls.push({ host, opts }), fakeHandle) },
  });
  docB.slot("call_id").textContent = "call_1";

  assert.equal(fakeMountCalls.length, 1, "Engine wird beim Init genau einmal montiert");
  assert.equal(fakeMountCalls[0].opts.size, 112, "Mount-Groesse = 112px-Fluegel-Held");
  assert.equal(docB.wing().style.display, "none", "CSS-Wing wird nach erfolgreichem Mount versteckt");

  for (const [status, expectedClass] of statusToWingClass) {
    envB.emit({ jsonrpc: "2.0", method: "ui/notifications/tool-result",
      params: { structuredContent: { call_id: "call_1", status, duration_s: 1, last_transcript_lines: [], failure_reason: null } } });
    assert.equal(docB.wing().className, expectedClass, `CSS-Klassenwechsel bleibt aktiv (Fallback-Kompatibilitaet): ${status}`);
  }
  assert.deepEqual(setStatusCalls, ["connecting", "working", "success", "error", "error"],
    "Engine-Pfad: setStatus() erhaelt dieselbe WingMark-Zuordnung wie der CSS-Klassenwechsel (cancelled->error)");
});

test("T-W1-call-AC-wing-mount-throws: HermesWingCanvas.mount() wirft -> engineHandle bleibt null, CSS-Fallback-Wing bleibt sichtbar (Fail-Safe, Absolute Regel 3)", () => {
  const doc = makeFakeDocument();
  const fakeMountCalls = [];
  const env = runOwnScript(doc, {
    hermesWingCanvas: {
      mount: (host, opts) => {
        fakeMountCalls.push({ host, opts });
        throw new Error("mount kaputt");
      },
    },
  });
  doc.slot("call_id").textContent = "call_1";

  assert.equal(fakeMountCalls.length, 1, "Mount wurde versucht");
  assert.notEqual(doc.wing().style.display, "none",
    "CSS-WingMark bleibt sichtbar nach fehlgeschlagenem Mount - kein leeres Loch statt Marke");

  assert.doesNotThrow(() => {
    env.emit({ jsonrpc: "2.0", method: "ui/notifications/tool-result",
      params: { structuredContent: { call_id: "call_1", status: "in_progress", duration_s: 1, last_transcript_lines: [], failure_reason: null } } });
  }, "kein Crash beim Statuswechsel - engineHandle blieb null statt eines kaputten Handles");
  assert.equal(doc.wing().className, "wing wing--dark wing--working", "CSS-Klassenwechsel funktioniert weiterhin");
  assert.notEqual(doc.wing().style.display, "none", "CSS-WingMark bleibt auch nach Statuswechsel sichtbar");
});

test("T-W1-call-AC-wing-mount-missing-dom: fehlender Host- oder Wing-Img-Selektor -> frueher Return, kein mount-Aufruf, CSS-Fallback-Wing bleibt sichtbar", () => {
  const fakeMountCallsHost = [];
  const docNoHost = withMissingSelector(makeFakeDocument(), "[data-wing-canvas]");
  runOwnScript(docNoHost, {
    hermesWingCanvas: { mount: (host, opts) => (fakeMountCallsHost.push({ host, opts }), { setStatus: () => {} }) },
  });
  assert.equal(fakeMountCallsHost.length, 0, "kein mount-Aufruf ohne Host-Element ([data-wing-canvas] fehlt)");
  assert.notEqual(docNoHost.wing().style.display, "none", "CSS-WingMark bleibt sichtbar ohne Host-Element");

  const fakeMountCallsImg = [];
  const docNoImg = withMissingSelector(makeFakeDocument(), "[data-wing] img");
  runOwnScript(docNoImg, {
    hermesWingCanvas: { mount: (host, opts) => (fakeMountCallsImg.push({ host, opts }), { setStatus: () => {} }) },
  });
  assert.equal(fakeMountCallsImg.length, 0, "kein mount-Aufruf ohne wingImg-Element ([data-wing] img fehlt)");
  assert.notEqual(docNoImg.wing().style.display, "none", "CSS-WingMark bleibt sichtbar ohne wingImg-Element");
});

test("T-W1-call-AC-wing-mount-src: mount() erhaelt die src des ausgelieferten [data-wing] img-Elements (Verdrahtungs-Beweis, nicht nur Groesse)", () => {
  const doc = makeFakeDocument();
  const fakeMountCalls = [];
  const fakeHandle = { setStatus: () => {} };
  runOwnScript(doc, {
    hermesWingCanvas: { mount: (host, opts) => (fakeMountCalls.push({ host, opts }), fakeHandle) },
  });
  const wingImg = doc.querySelector("[data-wing] img");

  assert.equal(fakeMountCalls.length, 1, "Engine wird beim Init genau einmal montiert");
  assert.equal(fakeMountCalls[0].opts.size, 112, "Mount-Groesse = 112px-Fluegel-Held");
  assert.equal(fakeMountCalls[0].opts.src, wingImg.src, "mount() erhaelt src des tatsaechlichen [data-wing] img-Elements");
});

test("T-W1-call-AC-status-pill: Status-Pill-Labels ueber alle 5 Status (EN-Keys; Uebersetzung via HermesI18n, s. mcp-ui-widget-i18n)", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  doc.slot("call_id").textContent = "call_1";

  const statusToLabel = [
    ["dialing", "Connecting"],
    ["in_progress", "Live"],
    ["completed", "Completed"],
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
  ];
  for (const [status, expectedLabel] of statusToLabel) {
    env.emit({ jsonrpc: "2.0", method: "ui/notifications/tool-result",
      params: { structuredContent: { call_id: "call_1", status, duration_s: 1, last_transcript_lines: [], failure_reason: null } } });
    assert.equal(doc.querySelector("[data-status-label]").textContent, expectedLabel, `Status ${status} -> ${expectedLabel}`);
  }
});

test("T-W1-call-AC-status-pill-locale: tool-result mit hermes/locale=de uebersetzt Status-Pill + HUD-Phase live (T2-02/S5)", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc, { withI18n: true });
  doc.slot("call_id").textContent = "call_1";

  env.emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: {
      _meta: { [WIDGET_LOCALE_META_KEY]: "de" },
      structuredContent: { call_id: "call_1", status: "in_progress", duration_s: 1, last_transcript_lines: [], failure_reason: null },
    },
  });

  assert.equal(doc.querySelector("[data-status-label]").textContent, "Live", "DE: Live (im Woerterbuch identisch zu EN)");
  assert.equal(doc.querySelector("[data-hud-phase]").textContent, "Im Gespräch", "DE: HUD-Phase uebersetzt");

  const docEn = makeFakeDocument();
  const envEn = runOwnScript(docEn, { withI18n: true });
  docEn.slot("call_id").textContent = "call_1";
  envEn.emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: { structuredContent: { call_id: "call_1", status: "in_progress", duration_s: 1, last_transcript_lines: [], failure_reason: null } },
  });
  assert.equal(docEn.querySelector("[data-hud-phase]").textContent, "In call", "ohne _meta bleibt es bei EN");
});

test("T-W1-call-AC-hud-ring: Status -> HUD-Phasentext (STATUS_VIEW.hudPhase) + Status -> Ring-Erscheinung (STATUS_VIEW.ringPreset: Klasse+dasharray) ueber alle 5 Status", () => {
  const doc = makeFakeDocument();
  const env = runOwnScript(doc);
  doc.slot("call_id").textContent = "call_1";

  const RING_RADIUS_PX = 74;
  const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS_PX;
  const RING_ARC_DIALING_PX = 110;
  const RING_ARC_IN_PROGRESS_PX = 270;
  const RING_ARC_INTERRUPTED_DASH_PX = 37;
  const RING_ARC_INTERRUPTED_GAP_PX = 23;

  const statusToExpectation = [
    ["dialing", "Placing call", "ring ring--spin ring--accent",
      `${RING_ARC_DIALING_PX} ${RING_CIRCUMFERENCE - RING_ARC_DIALING_PX}`],
    ["in_progress", "In call", "ring ring--spin ring--accent-strong",
      `${RING_ARC_IN_PROGRESS_PX} ${RING_CIRCUMFERENCE - RING_ARC_IN_PROGRESS_PX}`],
    ["completed", "Call ended", "ring ring--accent-solid", `${RING_CIRCUMFERENCE} 0`],
    ["failed", "Call ended", "ring ring--muted", `${RING_ARC_INTERRUPTED_DASH_PX} ${RING_ARC_INTERRUPTED_GAP_PX}`],
    ["cancelled", "Call ended", "ring ring--muted", `${RING_ARC_INTERRUPTED_DASH_PX} ${RING_ARC_INTERRUPTED_GAP_PX}`],
  ];

  for (const [status, expectedPhase, expectedRingClass, expectedDash] of statusToExpectation) {
    env.emit({ jsonrpc: "2.0", method: "ui/notifications/tool-result",
      params: { structuredContent: { call_id: "call_1", status, duration_s: 1, last_transcript_lines: [], failure_reason: null } } });
    assert.equal(doc.hudPhase().textContent, expectedPhase, `HUD-Phase bei ${status}`);
    assert.equal(doc.ring().className, expectedRingClass, `Ring-Klasse bei ${status}`);
    assert.equal(doc.ringArc().strokeDasharray, expectedDash, `Ring-dasharray bei ${status}`);
  }
});

test("T-W1-call-AC-hud-ring-sync: JS-Konstanten (WING_CANVAS_SIZE_PX, RING_RADIUS_PX) decken sich mit CSS/SVG (kein stiller Drift zwischen den Sprachschichten)", () => {
  const html = widgetHtml("call");

  const cssWingSize = Number((html.match(/--wing-size:(\d+)px/) || [])[1]);
  const jsWingSize = Number((html.match(/WING_CANVAS_SIZE_PX\s*=\s*(\d+)/) || [])[1]);
  assert.ok(cssWingSize > 0 && jsWingSize > 0, "beide Werte im ausgelieferten HTML gefunden");
  assert.equal(jsWingSize, cssWingSize, "Canvas-Mount-Groesse (JS WING_CANVAS_SIZE_PX) = --wing-size (CSS)");

  const svgRadii = [...html.matchAll(/<circle[^>]*\br="(\d+)"/g)].map((m) => Number(m[1]));
  const jsRingRadius = Number((html.match(/RING_RADIUS_PX\s*=\s*(\d+)/) || [])[1]);
  assert.equal(svgRadii.length, 2, "beide SVG-Kreise (Track+Arc) gefunden");
  assert.ok(svgRadii.every((r) => r === jsRingRadius), "SVG r-Attribut (beide Kreise) = RING_RADIUS_PX (JS)");
});

test("T-W1-call-AC-size: ausgeliefertes call.html bleibt unter dem 260KB-Budget", () => {
  assert.ok(Buffer.byteLength(widgetHtml("call"), "utf8") < 260 * 1024, "call.html unter 260KB (Olympus-HUD + Wing-Engine)");
});
