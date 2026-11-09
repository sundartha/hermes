import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const UI_READY_EVENT = "hermes:ui-ready";
const UI_READY_FLAG = "__hermesUiReady";
const CALL_SKRIPT = skriptbloecke((await ausgelieferteWidgets()).call).find((block) =>
  block.includes("updateForStatus"),
);

function makeElement(onRingWrite) {
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
    setAttribute() { onRingWrite(); },
  };
}

function startCard() {
  let ringWrites = 0;
  const countRingWrite = () => { ringWrites += 1; };
  const elements = new Map();
  const doc = {
    querySelector(sel) {
      if (!elements.has(sel)) elements.set(sel, makeElement(sel.startsWith("[data-ring") ? countRingWrite : () => {}));
      return elements.get(sel);
    },
    querySelectorAll: () => [],
    documentElement: { lang: "" },
    createElement: () => makeElement(() => {}),
  };
  const setStatusCalls = [];
  const sandbox = { document: doc, parent: { postMessage() {} } };
  sandbox.window = sandbox;
  sandbox.HermesWingCanvas = { mount: () => ({ setStatus: (s) => setStatusCalls.push(s) }) };
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
  return { meldung, setStatusCalls, ringWrites: () => ringWrites, doc };
}

test("T-karte-status-gleich: wiederholte Antworten mit gleichem Status fassen Pille, Ring und Klassen nicht an", () => {
  const karte = startCard();
  karte.meldung("in_progress");
  const ringNachErster = karte.ringWrites();
  const wingNachErster = karte.doc.querySelector("[data-wing]").classWrites;
  karte.meldung("in_progress");
  karte.meldung("in_progress");

  assert.equal(karte.ringWrites(), ringNachErster);
  assert.equal(karte.doc.querySelector("[data-wing]").classWrites, wingNachErster);
  assert.ok(karte.setStatusCalls.every((s) => s === "working"));
  assert.equal(karte.doc.querySelector("[data-mcp=\"status\"]").textContent, "in_progress");
});

test("T-karte-status-wechsel: ein anderer Status erreicht Fluegel und Ring genau einmal", () => {
  const karte = startCard();
  karte.meldung("in_progress");
  const ringVorher = karte.ringWrites();
  karte.meldung("completed");
  karte.meldung("completed");

  assert.equal(karte.setStatusCalls.at(-1), "success");
  assert.ok(karte.ringWrites() > ringVorher);
});
