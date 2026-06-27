// W1: gemeinsames Client-Daten-Binding fuer alle Widgets. Prueft die pure Binding-
// Logik (widget-bind.js) ohne echtes DOM/Browser ueber ein lokales Fake-DOM, plus die
// strukturelle Invariante, dass ALLE Widget-HTML genau EINE Quelle des Binding-Scripts
// tragen (G5/S2). Kein Netz, kein Spawn, kein neuer Dependency.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIND_SCRIPT,
  bind,
  applyField,
  renderLines,
  readHostData,
  readMessageData,
  run,
  isObject,
} from "../src/ui/widget-bind.js";
import {
  widgetHtml,
  WIDGET_CALL_STATUS,
  WIDGET_CALL_RESULT,
  WIDGET_TRANSCRIPT,
  WIDGET_AGENT_STATUS,
} from "../src/ui/widget-catalog.js";

const WIDGET_IDS = [
  WIDGET_CALL_STATUS,
  WIDGET_CALL_RESULT,
  WIDGET_TRANSCRIPT,
  WIDGET_AGENT_STATUS,
];

// Minimal-Fake der DOM-Oberflaeche, die widget-bind.js nutzt: querySelectorAll,
// createElement, textContent (Setter leert Kinder wie echtes DOM), firstChild,
// appendChild/removeChild. Slots werden ueber data-mcp registriert.
function makeEl() {
  const el = {
    className: "",
    children: [],
    _text: "",
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
  };
  return el;
}

// doc mit fest registrierten Slots: key -> Liste von Elementen (data-mcp="key").
function makeDoc(slotKeys) {
  const slots = new Map();
  for (const key of slotKeys) slots.set(key, [makeEl()]);
  return {
    slots,
    querySelectorAll(selector) {
      // Selektor-Form: [data-mcp="<key>"]
      const m = selector.match(/^\[data-mcp="(.+)"\]$/);
      const key = m ? m[1] : null;
      return slots.has(key) ? slots.get(key) : [];
    },
    createElement() {
      return makeEl();
    },
  };
}

const slot = (doc, key) => doc.slots.get(key)[0];

test("T-W1-AC1: jede Widget-HTML traegt GENAU EINE Quelle des Binding-Scripts (G5/S2)", () => {
  for (const id of WIDGET_IDS) {
    const html = widgetHtml(id);
    assert.equal(
      html.split(BIND_SCRIPT).length,
      2,
      `${id}: BIND_SCRIPT genau einmal eingefuegt`,
    );
    assert.ok(html.lastIndexOf(BIND_SCRIPT) < html.lastIndexOf("</body>"), `${id}: vor </body>`);
  }
});

test("T-W1-AC2: BIND_SCRIPT erzeugt NIE innerHTML + kein href/<link>/@import (AC6-Invariante)", () => {
  assert.ok(!BIND_SCRIPT.includes("innerHTML"), "kein innerHTML im Script-Text (XSS-Gate, S1)");
  assert.ok(!BIND_SCRIPT.includes("@import"), "kein @import");
  assert.doesNotMatch(BIND_SCRIPT, /<link[\s>]/, "kein <link>-Element");
  assert.doesNotMatch(BIND_SCRIPT, /href\s*=/, "kein href-Linkback");
});

test("T-W1-AC3: host-gepushter String landet als textContent, nie als Markup (XSS)", () => {
  const doc = makeDoc(["result_summary"]);
  const payload = '<img src=x onerror=alert(1)>';
  bind(doc, { result_summary: payload });
  assert.equal(slot(doc, "result_summary").textContent, payload, "roh als Text, kein Markup");
  assert.equal(slot(doc, "result_summary").children.length, 0, "kein erzeugtes DOM-Kind");
});

test("T-W1-AC4: Array-Feld -> je Zeile ein <div class=turn>; erneutes Binden doppelt nicht", () => {
  const doc = makeDoc(["last_transcript_lines"]);
  const lines = ["Agent: hi", "Gegenseite: yo"];
  bind(doc, { last_transcript_lines: lines });
  const container = slot(doc, "last_transcript_lines");
  assert.equal(container.children.length, 2, "zwei Zeilen-Knoten");
  assert.deepEqual(container.children.map((c) => c.className), ["turn", "turn"]);
  assert.deepEqual(container.children.map((c) => c.textContent), lines);

  bind(doc, { last_transcript_lines: ["Agent: again"] });
  assert.equal(container.children.length, 1, "vorher geleert, kein Doppeln");
  assert.equal(container.children[0].textContent, "Agent: again");
});

test("T-W1-AC5: unbekannte Schluessel + null/undefined-Werte aendern keinen Slot", () => {
  const doc = makeDoc(["status"]);
  assert.doesNotThrow(() => bind(doc, { unknown_key: "x", status: null, missing: undefined }));
  assert.equal(slot(doc, "status").textContent, "", "null-Wert uebersprungen -> Slot unberuehrt");
});

test("T-W1-AC6: Feature-Detection liest beide Bruecken + message-Event, sonst null", () => {
  assert.deepEqual(readHostData({ openai: { toolOutput: { status: "x" } } }), { status: "x" });
  assert.deepEqual(readHostData({ mcpToolOutput: { call_id: "c" } }), { call_id: "c" });
  assert.equal(readHostData({}), null, "keine Bruecke -> null");
  assert.equal(readHostData(null), null, "kein root -> null");

  assert.deepEqual(readMessageData({ data: { toolOutput: { a: 1 } } }), { a: 1 });
  assert.deepEqual(readMessageData({ data: { structuredContent: { b: 2 } } }), { b: 2 });
  assert.equal(readMessageData({ data: { junk: true } }), null, "kein bekannter Key -> null");
  assert.equal(readMessageData({}), null, "kein data -> null");

  assert.equal(isObject({}), true);
  assert.equal(isObject(null), false);
  assert.equal(isObject("x"), false);
});

test("T-W1-AC7: run ist fail-safe ohne DOM/Bruecke und bindet bei vorhandener Bruecke", () => {
  assert.doesNotThrow(() => run({}), "kein document -> no-op");
  assert.doesNotThrow(() => run(null), "kein root -> no-op");

  const doc = makeDoc(["status"]);
  assert.doesNotThrow(() => run({ document: doc }), "ohne Bruecke -> no-op");
  assert.equal(slot(doc, "status").textContent, "", "ohne Bruecke kein Slot veraendert");

  run({ document: doc, openai: { toolOutput: { status: "in_progress" } } });
  assert.equal(slot(doc, "status").textContent, "in_progress", "synchrone Bruecke gebunden");
});

test("T-W1-AC8: ein Binding deckt alle Slot-Namen beider Whitelists ab (Kontrakt)", () => {
  const statusDoc = makeDoc(["status", "duration_s", "last_transcript_lines", "call_id"]);
  bind(statusDoc, {
    call_id: "call_1",
    status: "in_progress",
    duration_s: 42,
    last_transcript_lines: ["Agent: hallo"],
  });
  assert.equal(slot(statusDoc, "status").textContent, "in_progress");
  assert.equal(slot(statusDoc, "duration_s").textContent, "42", "Zahl als String");
  assert.equal(slot(statusDoc, "call_id").textContent, "call_1");
  assert.equal(slot(statusDoc, "last_transcript_lines").children.length, 1);

  const transcriptDoc = makeDoc(["objective_achieved", "result_summary", "call_id"]);
  bind(transcriptDoc, {
    call_id: "call_2",
    result_summary: "Termin gebucht.",
    objective_achieved: true,
  });
  assert.equal(slot(transcriptDoc, "objective_achieved").textContent, "true", "boolean als String");
  assert.equal(slot(transcriptDoc, "result_summary").textContent, "Termin gebucht.");
  assert.equal(slot(transcriptDoc, "call_id").textContent, "call_2");
});

test("T-W1-AC9: applyField/renderLines direkt - mehrere Slots gleichen Schluessels", () => {
  // Zwei Slots desselben Schluessels (kommt im DOM vor) -> beide gefuellt.
  const doc = makeDoc([]);
  doc.slots.set("status", [makeEl(), makeEl()]);
  applyField(doc, "status", "done");
  assert.deepEqual(doc.slots.get("status").map((e) => e.textContent), ["done", "done"]);

  const container = makeEl();
  renderLines(doc, container, ["a", "b", "c"]);
  assert.deepEqual(container.children.map((c) => c.textContent), ["a", "b", "c"]);
});
