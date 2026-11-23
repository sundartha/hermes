import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const UI_READY_EVENT = "hermes:ui-ready";
const UI_READY_FLAG = "__hermesUiReady";
const CALL_SKRIPT = skriptbloecke((await ausgelieferteWidgets()).call).find((block) =>
  block.includes("updateForStatus"),
);

function makeElement() {
  return {
    _text: "",
    _className: "",
    classWrites: 0,
    get className() { return this._className; },
    set className(v) { this._className = v; this.classWrites += 1; },
    children: [],
    style: {},
    disabled: false,
    get firstChild() { return this.children[0] || null; },
    get textContent() { return this._text; },
    set textContent(v) { this._text = v; this.children = []; },
    appendChild(child) { this.children.push(child); return child; },
    removeChild(child) { this.children = this.children.filter((c) => c !== child); return child; },
    addEventListener() {},
    setAttribute() {},
  };
}

function startCard() {
  const elements = new Map();
  const doc = {
    querySelector(sel) {
      if (!elements.has(sel)) elements.set(sel, makeElement());
      return elements.get(sel);
    },
    querySelectorAll: () => [],
    documentElement: { lang: "" },
    createElement: () => makeElement(),
  };
  const sandbox = { document: doc, parent: { postMessage() {} } };
  sandbox.window = sandbox;
  sandbox.HermesWingCanvas = { mount: () => ({ setStatus() {} }) };
  const listeners = {};
  sandbox.addEventListener = (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); };
  sandbox.CustomEvent = function CustomEvent(type) { this.type = type; };
  sandbox.dispatchEvent = (event) => { for (const fn of listeners[event.type] || []) fn(event); };
  sandbox.setInterval = () => 1;
  sandbox.clearInterval = () => {};
  sandbox.setTimeout = () => 1;
  sandbox.clearTimeout = () => {};
  vm.createContext(sandbox);
  vm.runInContext(CALL_SKRIPT, sandbox);
  sandbox[UI_READY_FLAG] = true;
  sandbox.dispatchEvent(new sandbox.CustomEvent(UI_READY_EVENT));
  const meldung = (status) => {
    const nachricht = { jsonrpc: "2.0", method: "ui/notifications/tool-result",
      params: { structuredContent: { call_id: "c1", status, duration_s: 1, last_transcript_lines: [], failure_reason: null } } };
    for (const fn of listeners.message || []) fn({ data: nachricht });
  };
  return { meldung, pille: () => doc.querySelector("[data-status-pill]") };
}

test("T-karte-pille-gleich: wiederholter gleicher Status schreibt die Klasse der Pille nicht neu", () => {
  const karte = startCard();
  karte.meldung("in_progress");
  const nachErster = karte.pille().classWrites;
  karte.meldung("in_progress");
  karte.meldung("in_progress");

  assert.ok(nachErster > 0);
  assert.equal(karte.pille().classWrites, nachErster);
});

test("T-karte-pille-wechsel: ein anderer Status schreibt die Klasse der Pille", () => {
  const karte = startCard();
  karte.meldung("in_progress");
  const vorher = karte.pille().classWrites;
  karte.meldung("completed");

  assert.ok(karte.pille().classWrites > vorher);
});
