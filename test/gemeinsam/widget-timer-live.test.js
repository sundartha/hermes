import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const FRAME_MS = 16;
const SERVER_START_MS = Date.parse("2026-11-08T10:00:00.000Z");
const ANSWERED_AT = "2026-11-08T10:00:00.000Z";
const CALL_ID = "anruf-timer-1";
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
    setInterval: (fn) => { sandbox.pollTick = fn; return 1; },
    clearInterval() {},
  };
  const listeners = {};
  const frames = [];
  let perfMs = 5000;
  let hostMs = 0;
  const posted = [];
  class HostDate extends Date { static now() { return hostMs; } }
  sandbox.Date = HostDate;
  sandbox.window = sandbox;
  sandbox.parent = { postMessage: (message) => posted.push(message) };
  sandbox.performance = { now: () => perfMs };
  sandbox.requestAnimationFrame = (fn) => { frames.push(fn); return frames.length; };
  sandbox.cancelAnimationFrame = () => { frames.length = 0; };
  sandbox.addEventListener = (type, fn) => { (listeners[type] ??= []).push(fn); };
  sandbox.dispatchEvent = (event) => { for (const fn of listeners[event.type] ?? []) fn(event); };
  vm.createContext(sandbox);
  vm.runInContext(WIDGET_SKRIPT, sandbox);
  const emit = (data) => { for (const fn of listeners.message ?? []) fn({ data }); };
  const display = () => elements.get("[data-duration-display]")?.textContent;
  const serverNow = () => SERVER_START_MS + perfMs - 5000;
  const advance = (ms, onFrame) => {
    for (let spent = 0; spent < ms; spent += FRAME_MS) {
      perfMs += FRAME_MS;
      const due = frames.splice(0);
      for (const fn of due) fn(perfMs);
      onFrame?.();
    }
  };
  const push = (felder) => emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: { structuredContent: { call_id: CALL_ID, status: "in_progress", ...felder } },
  });
  const poll = (reply, { delayMs = 0, serverOffsetMs = 0, onFrame } = {}) => {
    const before = posted.length;
    sandbox.pollTick();
    const request = posted[before];
    const stampedAt = serverNow() + delayMs / 2 + serverOffsetMs;
    advance(delayMs, onFrame);
    emit({
      jsonrpc: "2.0",
      id: request.id,
      result: { structuredContent: { call_id: CALL_ID, status: "in_progress", server_time: new Date(stampedAt).toISOString(), ...reply } },
    });
  };
  const ready = () => { sandbox.__hermesUiReady = true; sandbox.dispatchEvent(new sandbox.CustomEvent("hermes:ui-ready")); };
  return { advance, display, poll, push, ready, setHostMs: (ms) => { hostMs = ms; }, sandbox, posted };
}

function seconds(text) {
  const [minutes, rest] = text.split(":").map(Number);
  return minutes * 60 + rest;
}

function startedWidget() {
  const widget = buildWidget();
  widget.push({ status: "dialing", duration_s: 0 });
  widget.ready();
  return widget;
}

function watch(widget, ms) {
  const seen = [];
  widget.advance(ms, () => { seen.push(seconds(widget.display())); });
  return seen;
}

function assertSteadyClimb(seen, maxStep) {
  for (let i = 1; i < seen.length; i += 1) {
    const step = seen[i] - seen[i - 1];
    assert.ok(step >= 0, `Anzeige springt rueckwaerts bei Bild ${i}: ${seen[i - 1]} nach ${seen[i]}`);
    assert.ok(step <= maxStep, `Anzeige springt zu weit bei Bild ${i}: ${seen[i - 1]} nach ${seen[i]}`);
  }
}

test("Timer live: Anzeige zaehlt zwischen den Polls jede Sekunde einzeln hoch", () => {
  const widget = startedWidget();
  widget.poll({ answered_at: ANSWERED_AT, duration_s: 3 }, { serverOffsetMs: 3000 });
  assert.equal(widget.display(), "0:03");
  const seen = watch(widget, 5200);
  assertSteadyClimb(seen, 1);
  assert.equal(widget.display(), "0:08");
  assert.deepEqual([...new Set(seen)], [3, 4, 5, 6, 7, 8]);
});

test("Timer live: vor dem Abheben bleibt die Anzeige auf 0:00", () => {
  const widget = startedWidget();
  widget.poll({ answered_at: null, duration_s: 0 });
  widget.advance(5000);
  assert.equal(widget.display(), "0:00");
});

test("Timer live: Antwort 8 s verzoegert, Anzeige springt nie und liegt hoechstens 1 s daneben", () => {
  const widget = startedWidget();
  widget.poll({ answered_at: ANSWERED_AT, duration_s: 0 });
  const seen = [];
  const onSample = () => { seen.push(seconds(widget.display())); };
  widget.advance(2000, onSample);
  widget.poll({ answered_at: ANSWERED_AT, duration_s: 10 }, { delayMs: 8000, onFrame: onSample });
  onSample();
  widget.advance(3000, onSample);
  assertSteadyClimb(seen, 1);
  const truth = Math.floor((widget.sandbox.performance.now() - 5000) / 1000);
  assert.ok(Math.abs(seconds(widget.display()) - truth) <= 1, `${widget.display()} weicht von ${truth} ab`);
});

test("Timer live: Server 4 s voraus, Anzeige holt hoechstens 1 s je Sekunde auf und springt nie rueckwaerts", () => {
  const widget = startedWidget();
  widget.poll({ answered_at: ANSWERED_AT, duration_s: 0 });
  widget.advance(2000);
  widget.poll({ answered_at: ANSWERED_AT, duration_s: 6 }, { serverOffsetMs: 4000 });
  const seen = watch(widget, 6000);
  assertSteadyClimb(seen, 2);
  assert.ok(Math.max(...seen.map((v, i) => (i ? v - seen[i - 1] : 0))) === 2, "holt auf");
  assert.ok(Math.abs(seconds(widget.display()) - 12) <= 1, widget.display());
});

test("Timer live: Server 4 s zurueck, Anzeige haelt an statt rueckwaerts zu springen", () => {
  const widget = startedWidget();
  widget.poll({ answered_at: ANSWERED_AT, duration_s: 6 }, { serverOffsetMs: 6000 });
  widget.advance(1000);
  const before = seconds(widget.display());
  widget.poll({ answered_at: ANSWERED_AT, duration_s: 2 }, { serverOffsetMs: -4000 });
  const seen = watch(widget, 6000);
  assertSteadyClimb(seen, 1);
  assert.ok(seen[0] >= before);
  assert.ok(Math.abs(seconds(widget.display()) - 6) <= 1, widget.display());
  assert.ok(seen.slice(0, 120).every((v) => v === before), "haelt an, bis der Server aufgeholt hat");
});

test("Timer live: Sprung der Host-Uhr aendert die Anzeige nicht", () => {
  const widget = startedWidget();
  widget.poll({ answered_at: ANSWERED_AT, duration_s: 0 });
  widget.setHostMs(Date.parse("2020-01-01T00:00:00.000Z"));
  const seen = watch(widget, 3200);
  widget.setHostMs(Date.parse("2030-01-01T00:00:00.000Z"));
  seen.push(...watch(widget, 3000));
  assertSteadyClimb(seen, 1);
  assert.equal(widget.display(), "0:06");
});

test("Timer live: Endstatus friert die Anzeige beim Wert des Servers ein", () => {
  const widget = startedWidget();
  widget.poll({ answered_at: ANSWERED_AT, duration_s: 0 });
  widget.advance(3000);
  widget.poll({ status: "completed", answered_at: ANSWERED_AT, duration_s: 42 }, { serverOffsetMs: 42000 });
  assert.equal(widget.display(), "0:42");
  widget.advance(5000);
  assert.equal(widget.display(), "0:42");
});

test("Timer live: ungueltige Zeitstempel fallen auf die Dauer des Servers zurueck", () => {
  const widget = startedWidget();
  widget.poll({ answered_at: "kein-datum", server_time: "auch-nicht", duration_s: 7 });
  assert.equal(widget.display(), "0:07");
  widget.advance(3000);
  assert.equal(widget.display(), "0:07");
});
