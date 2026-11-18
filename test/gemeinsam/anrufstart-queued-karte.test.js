import assert from "node:assert/strict";
import vm from "node:vm";
import { test } from "node:test";

import { widgetHtml, WIDGET_CALL } from "../../src/ui/widget-catalog.js";
import { BIND_SCRIPT, renderRows } from "../../src/ui/widget-bind.js";
import { I18N_SCRIPT, WIDGET_LOCALE_META_KEY } from "../../src/ui/widget-i18n.js";

const RING_DIALING = "ring ring--spin ring--accent";
const SELEKTOREN = [
  "[data-status-pill]",
  "[data-status-dot]",
  "[data-status-label]",
  "[data-hud-phase]",
  "[data-hud-em]",
  "[data-ring]",
  "[data-ring-arc]",
  "[data-wing]",
];

function element() {
  return {
    _text: "",
    className: "",
    children: [],
    style: {},
    attrs: {},
    get firstChild() {
      return this.children[0] ?? null;
    },
    get textContent() {
      return this._text;
    },
    set textContent(wert) {
      this._text = wert;
      this.children = [];
    },
    appendChild(kind) {
      this.children.push(kind);
      return kind;
    },
    removeChild() {},
    removeAttribute() {},
    setAttribute(name, wert) {
      this.attrs[name] = wert;
      if (name === "class") this.className = wert;
    },
    addEventListener() {},
  };
}

function dokument() {
  const nachSelektor = new Map(SELEKTOREN.map((selektor) => [selektor, element()]));
  return {
    nachSelektor,
    querySelector: (selektor) => nachSelektor.get(selektor) ?? null,
    querySelectorAll: () => [],
    documentElement: { lang: "" },
    createElement: element,
  };
}

function skriptKoerper(skript) {
  return skript.match(/<script>([\s\S]*)<\/script>/)[1];
}

const nachricht = (structuredContent, meta) => ({
  jsonrpc: "2.0",
  method: "ui/notifications/tool-result",
  params: { structuredContent, _meta: meta },
});

function starteKarte(doc) {
  const skripte = [...widgetHtml(WIDGET_CALL).replace(BIND_SCRIPT, "").matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const eigenes = skripte.pop()[1];
  const sandbox = { document: doc, parent: { postMessage() {} }, CustomEvent: function CustomEvent(typ) { this.type = typ; } };
  sandbox.window = sandbox;
  const lauscher = [];
  sandbox.addEventListener = (typ, handler) => typ === "message" && lauscher.push(handler);
  sandbox.dispatchEvent = () => {};
  sandbox.setInterval = () => 1;
  sandbox.clearInterval = () => {};
  sandbox.setTimeout = () => 1;
  sandbox.clearTimeout = () => {};
  vm.createContext(sandbox);
  vm.runInContext(skriptKoerper(I18N_SCRIPT), sandbox);
  vm.runInContext(eigenes, sandbox);
  return (structuredContent, meta) =>
    lauscher.forEach((handler) => handler({ data: nachricht(structuredContent, meta) }));
}

const ergebnis = (status) => ({ call_id: "call_q", status, duration_s: 0, last_transcript_lines: [], failure_reason: null });

test("queued: die Anrufkarte zeigt bei queued Beschriftung und HUD-Text, und der Ring dreht sich", () => {
  const doc = dokument();
  const sende = starteKarte(doc);
  sende(ergebnis("queued"));
  assert.equal(doc.nachSelektor.get("[data-status-label]").textContent, "Waiting for a line");
  assert.equal(doc.nachSelektor.get("[data-hud-phase]").textContent, "Hermes is waiting for a free line.");
  assert.equal(doc.nachSelektor.get("[data-ring]").className, RING_DIALING);
  assert.equal(doc.nachSelektor.get("[data-status-pill]").className, "pill pill--active");
  const punkt = doc.nachSelektor.get("[data-status-dot]");
  assert.equal(punkt.style.display, "");
});

test("queued: die Anrufkarte zeigt queued auf Deutsch uebersetzt", () => {
  const doc = dokument();
  const sende = starteKarte(doc);
  sende(ergebnis("queued"), { [WIDGET_LOCALE_META_KEY]: "de" });
  assert.equal(doc.nachSelektor.get("[data-status-label]").textContent, "Wartet auf eine Leitung");
  assert.equal(doc.nachSelektor.get("[data-hud-phase]").textContent, "Hermes wartet auf eine freie Leitung.");
});

test("queued: die Anrufliste beschriftet einen wartenden Anruf mit Waiting for a line", () => {
  const behaelter = { ...element(), getAttribute: () => "status" };
  const doc = { createElement: element, defaultView: null };
  renderRows(doc, behaelter, [{ status: "queued" }]);
  const [zeile] = behaelter.children;
  const [zelle] = zeile.children;
  assert.equal(zelle.textContent, "Waiting for a line");
  assert.equal(zelle.attrs["data-i18n"], "Waiting for a line");
});
