import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIND_SCRIPT,
  bind,
  applyField,
  renderLines,
  renderRows,
  rowFields,
  run,
  isObject,
} from "../src/ui/widget-bind.js";
import {
  widgetHtml,
  WIDGET_AGENT_STATUS,
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
  WIDGET_CALL,
} from "../src/ui/widget-catalog.js";

const WIDGET_IDS = [
  WIDGET_AGENT_STATUS,
  WIDGET_MY_NUMBER,
  WIDGET_CALLS,
  WIDGET_CALL,
];

function makeEl() {
  const el = {
    className: "",
    children: [],
    _text: "",
    _attrs: {},
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
    getAttribute(name) {
      return name in this._attrs ? this._attrs[name] : null;
    },
    setAttribute(name, value) {
      this._attrs[name] = value;
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

function makeDoc(slotKeys) {
  const slots = new Map();
  for (const key of slotKeys) slots.set(key, [makeEl()]);
  return {
    slots,
    querySelectorAll(selector) {
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

function makeRoot(doc) {
  let messageHandler = null;
  const root = {
    document: doc,
    parent: { postMessage: (msg) => root.posted.push(msg) },
    addEventListener: (type, h) => {
      if (type === "message") messageHandler = h;
    },
    posted: [],
    emit: (data) => messageHandler && messageHandler({ data }),
  };
  return root;
}

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

test("T-W1-AC6: MCP-Apps-Handshake - ui/initialize beim Laden, tool-result bindet structuredContent", () => {
  const doc = makeDoc(["status", "call_id"]);
  const root = makeRoot(doc);
  run(root);

  assert.equal(root.posted[0].method, "ui/initialize", "erste Nachricht = ui/initialize");
  assert.equal(root.posted[0].id, 1);
  assert.equal(root.posted[0].params.protocolVersion, "2026-01-26");
  assert.ok(
    root.posted[0].params.appInfo && typeof root.posted[0].params.appInfo.name === "string",
    "ui/initialize traegt appInfo {name,version} (Spec-Pflicht)",
  );
  assert.ok(!("clientInfo" in root.posted[0].params), "kein clientInfo (vom Host abgelehnt)");

  assert.ok(
    root.posted.some((m) => m.method === "ui/notifications/size-changed"),
    "Hoehe proaktiv gemeldet (vor jeder Host-Antwort)",
  );

  root.emit({ jsonrpc: "2.0", id: 1, result: { hostContext: {} } });
  assert.ok(root.posted.some((m) => m.method === "ui/notifications/initialized"), "initialized bestaetigt");
  assert.ok(root.posted.some((m) => m.method === "ui/notifications/size-changed"), "Hoehe gemeldet");

  root.emit({
    jsonrpc: "2.0",
    method: "ui/notifications/tool-result",
    params: { structuredContent: { status: "in_progress", call_id: "c1" } },
  });
  assert.equal(slot(doc, "status").textContent, "in_progress", "structuredContent gebunden");
  assert.equal(slot(doc, "call_id").textContent, "c1");

  assert.equal(isObject({}), true);
  assert.equal(isObject(null), false);
});

test("T-W1-AC7: run ist fail-safe ohne DOM/Host und ignoriert unbekannte Nachrichten", () => {
  assert.doesNotThrow(() => run({}), "kein document -> no-op");
  assert.doesNotThrow(() => run(null), "kein root -> no-op");

  const doc = makeDoc(["status"]);
  const root = makeRoot(doc);
  run(root);
  root.emit({ jsonrpc: "2.0", method: "ui/notifications/irgendwas", params: {} });
  assert.equal(slot(doc, "status").textContent, "", "unbekannte Methode -> Slot unberuehrt");
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
  const doc = makeDoc([]);
  doc.slots.set("status", [makeEl(), makeEl()]);
  applyField(doc, "status", "done");
  assert.deepEqual(doc.slots.get("status").map((e) => e.textContent), ["done", "done"]);

  const container = makeEl();
  renderLines(doc, container, ["a", "b", "c"]);
  assert.deepEqual(container.children.map((c) => c.textContent), ["a", "b", "c"]);
});

test("T-Wb-BIND1: rowFields parst data-mcp-row; fehlend/leer -> []", () => {
  const el = makeEl();
  el.setAttribute("data-mcp-row", "direction, counterparty ,status,");
  assert.deepEqual(rowFields(el), ["direction", "counterparty", "status"], "trim + leere uebersprungen");

  assert.deepEqual(rowFields(makeEl()), [], "kein Attribut -> []");
  const empty = makeEl();
  empty.setAttribute("data-mcp-row", "");
  assert.deepEqual(rowFields(empty), [], "leeres Attribut -> []");
  assert.deepEqual(rowFields({}), [], "kein getAttribute -> [] (defensiv)");
});

test("T-Wb-BIND2: renderRows - je Objekt eine Row mit Zellen je Feld; fehlend -> leere Zelle", () => {
  const doc = { createElement: () => makeEl() };
  const container = makeEl();
  const fields = ["counterparty", "status", "summary"];
  container.setAttribute("data-mcp-row", fields.join(","));
  renderRows(doc, container, [
    { counterparty: "+49170", status: "completed", summary: "Termin" },
    { counterparty: "+49160", status: "dialing" },
  ]);

  assert.equal(container.children.length, 2, "zwei Rows");
  assert.deepEqual(container.children.map((r) => r.className), ["row", "row"]);
  const [row0, row1] = container.children;
  assert.deepEqual(row0.children.map((c) => c.className), ["cell", "cell", "cell"]);
  assert.deepEqual(row0.children.map((c) => c.getAttribute("data-field")), fields, "data-field je Zelle");
  assert.deepEqual(row0.children.map((c) => c.textContent), ["+49170", "Completed", "Termin"]);
  assert.equal(row1.children[2].textContent, "", "fehlendes Feld -> leere Zelle");

  renderRows(doc, container, [{ counterparty: "+49150", status: "failed" }]);
  assert.equal(container.children.length, 1, "vorher geleert");
  const [verbleibend] = container.children;
  assert.deepEqual(verbleibend.children.map((c) => c.getAttribute("data-field")), fields, "Felder weiter aus data-mcp-row");
});

test("T-Wb-BIND3: renderRows XSS - Feldwert landet als textContent, nie als Markup", () => {
  const doc = { createElement: () => makeEl() };
  const container = makeEl();
  container.setAttribute("data-mcp-row", "summary");
  const payload = '<img src=x onerror=alert(1)>';
  renderRows(doc, container, [{ summary: payload }]);
  const cell = container.children[0].children[0];
  assert.equal(cell.textContent, payload, "roh als Text");
  assert.equal(cell.children.length, 0, "kein erzeugtes DOM-Kind (kein Markup-Parsing)");
});

test("T-Wb-BIND4: applyField-Dispatch - Objekt-Liste (data-mcp-row) -> Rows; Skalar-Array -> turns", () => {
  const rowDoc = makeDoc(["calls"]);
  slot(rowDoc, "calls").setAttribute("data-mcp-row", "counterparty,status");
  applyField(rowDoc, "calls", [{ counterparty: "+49170", status: "completed" }]);
  const container = slot(rowDoc, "calls");
  assert.equal(container.children.length, 1, "eine Row");
  const [zeile] = container.children;
  assert.equal(zeile.className, "row");
  assert.deepEqual(zeile.children.map((c) => c.textContent), ["+49170", "Completed"]);

  const lineDoc = makeDoc(["last_transcript_lines"]);
  applyField(lineDoc, "last_transcript_lines", ["Agent: hi", "Gegenseite: yo"]);
  const lines = slot(lineDoc, "last_transcript_lines");
  assert.deepEqual(lines.children.map((c) => c.className), ["turn", "turn"], "Skalar-Array bleibt turn-Zeilen");
});

test("T-Wb-BIND5: bind end-to-end - { calls: [...] } in den data-mcp=calls-Slot", () => {
  const doc = makeDoc(["calls"]);
  slot(doc, "calls").setAttribute("data-mcp-row", "direction,counterparty,status,startedAt,summary");
  bind(doc, {
    calls: [
      { id: "c1", direction: "outbound", counterparty: "+49170", status: "completed", startedAt: "Fr 11:59", summary: "ok" },
      { id: "c2", direction: "inbound", counterparty: "+49160", status: "dialing", startedAt: "Fr 12:10" },
    ],
  });
  const container = slot(doc, "calls");
  assert.equal(container.children.length, 2, "zwei Call-Rows");
  assert.deepEqual(container.children[0].children.map((c) => c.getAttribute("data-field")),
    ["direction", "counterparty", "status", "startedAt", "summary"]);
  assert.equal(container.children[1].children[4].textContent, "", "c2 ohne summary -> leere Zelle");
});

test("T-Wb-BIND6: BIND_SCRIPT projiziert Binding + Handshake (eine Quelle, kein innerHTML)", () => {
  assert.ok(BIND_SCRIPT.includes("function rowFields"), "rowFields projiziert");
  assert.ok(BIND_SCRIPT.includes("function renderRows"), "renderRows projiziert");
  assert.ok(BIND_SCRIPT.includes("ui/initialize"), "ui/initialize-Handshake projiziert");
  assert.ok(BIND_SCRIPT.includes("ui/notifications/size-changed"), "Hoehen-Reporting projiziert");
  assert.ok(BIND_SCRIPT.includes("run(window);"), "run(window) am Ende");
  assert.ok(!BIND_SCRIPT.includes("innerHTML"), "kein innerHTML (XSS-Gate, S1)");
});

const FELDER = "direction,counterparty,status";
const UEBERSETZT = { t: (schluessel) => `de:${schluessel}` };

function element(tag, mitSetAttribute = true) {
  const attrs = {};
  const el = {
    tag,
    className: "",
    children: [],
    _text: "",
    get firstChild() {
      return this.children[0] ?? null;
    },
    get textContent() {
      return this._text;
    },
    set textContent(value) {
      this._text = value;
      this.children = [];
    },
    attrs,
    getAttribute: (name) => attrs[name] ?? null,
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeChild(child) {
      this.children = this.children.filter((kind) => kind !== child);
      return child;
    },
  };
  if (mitSetAttribute) {
    el.setAttribute = (name, value) => {
      attrs[name] = value;
    };
  }
  return el;
}

function zeichne(eintraege, { i18n, mitDefaultView = true, mitSetAttribute = true } = {}) {
  const doc = { createElement: (tag) => element(tag, mitSetAttribute) };
  if (mitDefaultView) doc.defaultView = { HermesI18n: i18n };
  const container = element("div");
  container.attrs["data-mcp-row"] = FELDER;
  renderRows(doc, container, eintraege);
  return container.children;
}

const zellen = (zeilen) => zeilen.map((zeile) => zeile.children);
const texte = (zeilen) => zellen(zeilen).map((reihe) => reihe.map((zelle) => zelle.textContent));
const EINTRAG = { direction: "outbound", counterparty: "+4930", status: "completed" };

test("WSP-12 (Anrufzeile, Elemente) - jede Zeile ist ein div, jede Zelle ein span", () => {
  const zeilen = zeichne([EINTRAG, EINTRAG]);
  assert.deepEqual(zeilen.map((zeile) => zeile.tag), ["div", "div"]);
  assert.deepEqual(zellen(zeilen).flat().map((zelle) => zelle.tag), Array(6).fill("span"));
});

test("WSP-13 (Anrufzeile, Beschriftung) - ohne nutzbares Woerterbuch bleibt die englische Beschriftung stehen, mit ihm erscheint die uebersetzte", () => {
  const faelle = [
    { name: "kein HermesI18n", optionen: { i18n: undefined }, erwartet: ["Outbound", "+4930", "Completed"] },
    { name: "HermesI18n ohne t", optionen: { i18n: {} }, erwartet: ["Outbound", "+4930", "Completed"] },
    { name: "t ist keine Funktion", optionen: { i18n: { t: "Completed" } }, erwartet: ["Outbound", "+4930", "Completed"] },
    { name: "kein defaultView", optionen: { mitDefaultView: false }, erwartet: ["Outbound", "+4930", "Completed"] },
    { name: "uebersetzendes t", optionen: { i18n: UEBERSETZT }, erwartet: ["de:Outbound", "+4930", "de:Completed"] },
  ];
  for (const { name, optionen, erwartet } of faelle) {
    assert.deepEqual(texte(zeichne([EINTRAG], optionen))[0], erwartet, name);
  }
});

test("WSP-14 (Anrufzeile, Leerwert) - ein fehlender oder leerer Wert ergibt eine leere Zelle, auch bei Feldern mit Beschriftung", () => {
  const eintraege = [
    { direction: null, counterparty: null, status: null },
    { direction: undefined, counterparty: undefined, status: undefined },
    {},
  ];
  for (const reihe of texte(zeichne(eintraege, { i18n: UEBERSETZT }))) assert.deepEqual(reihe, ["", "", ""]);
  const [zeile] = zellen(zeichne([{ status: null }], { i18n: UEBERSETZT }));
  assert.deepEqual(zeile.map((zelle) => zelle.attrs["data-i18n"] ?? null), [null, null, null]);
});

test("WSP-15 (Anrufzeile, Markierung) - nur Zellen mit Beschriftung tragen data-i18n mit dem englischen Schluessel, Inhalte nie", () => {
  const eintraege = [EINTRAG, { direction: "inbound", counterparty: "+4931", status: "neuer_status" }, { direction: "weder", counterparty: "x", status: "failed" }];
  const markierungen = zellen(zeichne(eintraege, { i18n: UEBERSETZT })).map((reihe) => reihe.map((zelle) => zelle.attrs["data-i18n"] ?? null));
  assert.deepEqual(markierungen, [
    ["Outbound", null, "Completed"],
    ["Inbound", null, "Result unknown"],
    [null, null, "Failed"],
  ]);
  assert.deepEqual(texte(zeichne(eintraege, { i18n: UEBERSETZT })).map((reihe) => reihe[0]), ["de:Outbound", "de:Inbound", "weder"]);
});

test("WSP-16 (Anrufzeile, schlichtes Element) - Zellen ohne setAttribute werden trotzdem gefuellt und uebersetzt, nichts bricht", () => {
  const eintraege = [EINTRAG, { direction: "weder", counterparty: "x", status: "neuer_status" }, { status: null }];
  const reihen = texte(zeichne(eintraege, { i18n: UEBERSETZT, mitSetAttribute: false }));
  assert.deepEqual(reihen, [
    ["de:Outbound", "+4930", "de:Completed"],
    ["weder", "x", "de:Result unknown"],
    ["", "", ""],
  ]);
});
