import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const CALL_ID = "anruf-takt-1";
const WIDGET_SKRIPT = skriptbloecke((await ausgelieferteWidgets()).call).find((block) => block.includes("POLL_INTERVAL_MS"));

function fakeElement() {
  return {
    textContent: "",
    className: "",
    children: [],
    style: {},
    get firstChild() { return this.children[0] ?? null; },
    appendChild(kind) { this.children.push(kind); return kind; },
    removeChild() {},
    setAttribute() {},
    addEventListener() {},
    animate() {},
    classList: { add() {}, remove() {}, toggle() {} },
  };
}

function buildWidget() {
  const elements = new Map();
  const aktiv = new Map();
  const gestartet = [];
  let laufnummer = 0;
  const sandbox = {
    document: {
      querySelector: (selector) => {
        if (!elements.has(selector)) elements.set(selector, fakeElement());
        return elements.get(selector);
      },
      querySelectorAll: () => [],
      createElement: fakeElement,
      documentElement: { lang: "" },
    },
    CustomEvent: function CustomEvent(type) { this.type = type; },
    setTimeout() { return 1; },
    clearTimeout() {},
    setInterval: (fn, ms) => {
      laufnummer += 1;
      aktiv.set(laufnummer, { fn, ms });
      gestartet.push(ms);
      return laufnummer;
    },
    clearInterval: (id) => { aktiv.delete(id); },
  };
  const listeners = {};
  const posted = [];
  sandbox.window = sandbox;
  sandbox.parent = { postMessage: (message) => posted.push(message) };
  sandbox.performance = { now: () => 5000 };
  sandbox.requestAnimationFrame = () => 1;
  sandbox.cancelAnimationFrame = () => {};
  sandbox.addEventListener = (type, fn) => { (listeners[type] ??= []).push(fn); };
  sandbox.dispatchEvent = (event) => { for (const fn of listeners[event.type] ?? []) fn(event); };
  vm.createContext(sandbox);
  vm.runInContext(WIDGET_SKRIPT, sandbox);
  const emit = (data) => { for (const fn of listeners.message ?? []) fn({ data }); };
  const push = (felder) => emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: { structuredContent: { call_id: CALL_ID, ...felder } },
  });
  const takt = () => [...aktiv.values()].map((eintrag) => eintrag.ms);
  const tick = () => [...aktiv.values()][0].fn();
  const letzteAnfrage = () => posted[posted.length - 1];
  const antworte = (anfrage, felder) => emit({
    jsonrpc: "2.0",
    id: anfrage.id,
    result: { structuredContent: { call_id: CALL_ID, ...felder } },
  });
  const fehler = (anfrage) => emit({ jsonrpc: "2.0", id: anfrage.id, error: { code: -32000, message: "denied" } });
  const ready = () => { sandbox.__hermesUiReady = true; sandbox.dispatchEvent(new sandbox.CustomEvent("hermes:ui-ready")); };
  const ergebnisAbrufe = () => posted.filter((m) => m.params?.name === "get_call_result").length;
  return { push, takt, tick, ready, gestartet, posted, letzteAnfrage, antworte, fehler, ergebnisAbrufe };
}

function startedWidget(status) {
  const widget = buildWidget();
  widget.push({ status });
  widget.ready();
  return widget;
}

test("Abfragetakt: bei Verbindung alle 3 s", () => {
  const widget = startedWidget("dialing");
  assert.deepEqual(widget.takt(), [3000]);
});

test("Abfragetakt: bei Live alle 5 s, der 3-s-Takt endet beim Wechsel", () => {
  const widget = startedWidget("dialing");
  widget.tick();
  widget.antworte(widget.letzteAnfrage(), { status: "in_progress" });
  assert.deepEqual(widget.takt(), [5000]);
});

test("Abfragetakt: gleicher Status startet den Takt nicht neu", () => {
  const widget = startedWidget("dialing");
  for (let i = 0; i < 3; i += 1) {
    widget.tick();
    widget.antworte(widget.letzteAnfrage(), { status: "dialing" });
  }
  assert.deepEqual(widget.gestartet, [3000]);
  widget.tick();
  widget.antworte(widget.letzteAnfrage(), { status: "in_progress" });
  widget.tick();
  widget.antworte(widget.letzteAnfrage(), { status: "in_progress" });
  assert.deepEqual(widget.gestartet, [3000, 5000]);
});

test("Abfragetakt: zurueck auf Verbindung ist wieder 3 s", () => {
  const widget = startedWidget("in_progress");
  assert.deepEqual(widget.takt(), [5000]);
  widget.tick();
  widget.antworte(widget.letzteAnfrage(), { status: "dialing" });
  assert.deepEqual(widget.takt(), [3000]);
});

test("Abfragetakt: nach dem Endstatus kein Takt mehr, das Ergebnis wird sofort einmal geholt", () => {
  const widget = startedWidget("in_progress");
  assert.equal(widget.ergebnisAbrufe(), 0);
  widget.tick();
  widget.antworte(widget.letzteAnfrage(), { status: "completed" });
  assert.deepEqual(widget.takt(), []);
  assert.equal(widget.ergebnisAbrufe(), 1);
  assert.equal(widget.letzteAnfrage().params.name, "get_call_result");
  assert.deepEqual({ ...widget.letzteAnfrage().params.arguments }, { call_id: CALL_ID });
});

test("Abfragetakt: Endstatus failed beendet den Takt", () => {
  const widget = startedWidget("dialing");
  widget.tick();
  widget.antworte(widget.letzteAnfrage(), { status: "failed" });
  assert.deepEqual(widget.takt(), []);
});

test("Abfragetakt: nach drei Fehlern in Folge wird nicht weitergefragt, auch nicht nach einem spaeten Statuswechsel", () => {
  const widget = startedWidget("dialing");
  for (let i = 0; i < 2; i += 1) {
    widget.tick();
    widget.fehler(widget.letzteAnfrage());
  }
  assert.deepEqual(widget.takt(), [3000]);
  widget.tick();
  widget.fehler(widget.letzteAnfrage());
  assert.deepEqual(widget.takt(), []);
  widget.push({ status: "in_progress" });
  assert.deepEqual(widget.takt(), []);
  assert.deepEqual(widget.gestartet, [3000]);
});

test("Abfragetakt: ein Erfolg setzt den Fehlerzaehler zurueck, der Takt bleibt", () => {
  const widget = startedWidget("in_progress");
  for (let i = 0; i < 2; i += 1) {
    widget.tick();
    widget.fehler(widget.letzteAnfrage());
  }
  widget.tick();
  widget.antworte(widget.letzteAnfrage(), { status: "in_progress" });
  for (let i = 0; i < 2; i += 1) {
    widget.tick();
    widget.fehler(widget.letzteAnfrage());
  }
  assert.deepEqual(widget.takt(), [5000]);
});
