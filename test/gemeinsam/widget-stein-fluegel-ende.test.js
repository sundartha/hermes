import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const WIDGETS = await ausgelieferteWidgets();
const CALL_HTML = WIDGETS.call;
const SKRIPT_I18N = skriptbloecke(CALL_HTML).find((code) => code.includes("HermesI18n = {"));
const SKRIPT_CALL = skriptbloecke(CALL_HTML).find((code) => code.includes("function init()"));

function element() {
  const attrs = {};
  return {
    textContent: "",
    className: "",
    style: {},
    children: [],
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute: (name, wert) => {
      attrs[name] = String(wert);
    },
    removeAttribute: (name) => {
      delete attrs[name];
    },
    appendChild() {},
    removeChild() {},
    addEventListener() {},
  };
}

function widgetImEndZustand() {
  const elemente = new Map();
  const hole = (selektor) => {
    if (!elemente.has(selektor)) elemente.set(selektor, element());
    return elemente.get(selektor);
  };
  const hoerer = [];
  const sandbox = { __hermesUiReady: true, parent: { postMessage() {} }, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {} };
  sandbox.window = sandbox;
  sandbox.document = {
    documentElement: { lang: "" },
    readyState: "complete",
    body: element(),
    querySelector: hole,
    querySelectorAll: () => [],
    createElement: element,
    addEventListener() {},
  };
  sandbox.addEventListener = (art, h) => {
    if (art === "message") hoerer.push(h);
  };
  sandbox.CustomEvent = function CustomEvent(art) {
    this.type = art;
  };
  sandbox.dispatchEvent = () => {};
  vm.createContext(sandbox);
  vm.runInContext(SKRIPT_I18N, sandbox);
  vm.runInContext(SKRIPT_CALL, sandbox);
  hole('[data-mcp="call_id"]').textContent = "call_1";
  const sende = (structuredContent) => hoerer.forEach((h) => h({ data: { method: "ui/notifications/tool-result", params: { structuredContent } } }));
  sende({ call_id: "call_1", status: "completed", duration_s: 5, last_transcript_lines: [], failure_reason: null });
  sende({ call_id: "call_1", outcome: "Termin gebucht", result_summary: "Termin gebucht. Der Friseur erwartet Sie am Montag um 10 Uhr.", next_step: "Termin im Kalender eintragen", objective_achieved: true });
  return { zeile: (name) => hole(`[data-row="${name}"]`).style.display, wert: (name) => hole(`[data-mcp="${name}"]`).textContent };
}

test("Anrufkarte Ende-Zustand: Zeilen Ziel und Fazit gibt es nicht mehr", () => {
  assert.ok(!CALL_HTML.includes('data-row="objective"'));
  assert.ok(!CALL_HTML.includes('data-row="outcome"'));
  assert.ok(!CALL_HTML.includes("data-objective-display"));
});

test("Anrufkarte Ende-Zustand: Ergebnis zeigt den vollen Text, Naechster Schritt bleibt", () => {
  const widget = widgetImEndZustand();
  assert.equal(widget.zeile("summary"), "");
  assert.equal(widget.wert("result_summary"), "Termin gebucht. Der Friseur erwartet Sie am Montag um 10 Uhr.");
  assert.equal(widget.zeile("next_step"), "");
  assert.equal(widget.wert("next_step"), "Termin im Kalender eintragen");
});
