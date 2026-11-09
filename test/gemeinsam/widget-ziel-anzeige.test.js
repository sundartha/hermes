import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const METHOD_TOOL_RESULT = "ui/notifications/tool-result";
const LOCALE_META = "hermes/locale";
const WIDGETS = await ausgelieferteWidgets();
const CALL_HTML = WIDGETS.call;
const SKRIPT_I18N = skriptbloecke(CALL_HTML).find((code) => code.includes("HermesI18n = {"));
const SKRIPT_CALL = skriptbloecke(CALL_HTML).find((code) => code.includes("function init()"));

const WORTE = {
  en: { erreicht: "Goal reached", verfehlt: "Goal not reached", offen: "Result being evaluated", beschriftung: "Goal" },
  de: { erreicht: "Ziel erreicht", verfehlt: "Ziel nicht erreicht", offen: "Wird ausgewertet", beschriftung: "Ziel" },
  fr: { erreicht: "Objectif atteint", verfehlt: "Objectif non atteint", offen: "Évaluation en cours", beschriftung: "Objectif" },
};
const WIDGET_DICT = JSON.parse(SKRIPT_I18N.match(/var WIDGET_DICT = (.*);\n/)[1]);
const VERBOTEN = ["Objective met", "Yes", "No", "Ja", "Nein", "Oui", "Non"];

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

function widgetImBrowser(sprache) {
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
    querySelectorAll: () => [...elemente.values()].filter((el) => el.getAttribute("data-i18n") !== null),
    createElement: element,
    addEventListener() {},
  };
  sandbox.addEventListener = (art, hoerer1) => {
    if (art === "message") hoerer.push(hoerer1);
  };
  sandbox.CustomEvent = function CustomEvent(art) {
    this.type = art;
  };
  sandbox.dispatchEvent = () => {};
  vm.createContext(sandbox);
  vm.runInContext(SKRIPT_I18N, sandbox);
  vm.runInContext(SKRIPT_CALL, sandbox);
  hole('[data-mcp="call_id"]').textContent = "call_1";
  const sende = (params) => hoerer.forEach((h) => h({ data: { method: METHOD_TOOL_RESULT, params } }));
  sende({ _meta: { [LOCALE_META]: sprache, "hermes/content_locale": sprache }, structuredContent: { call_id: "call_1", status: "completed", duration_s: 5, last_transcript_lines: [], failure_reason: null } });
  return {
    ergebnis: (daten) => sende({ structuredContent: { call_id: "call_1", outcome: null, next_step: null, ...daten } }),
    zeile: () => hole('[data-row="objective"]').style.display,
    wert: () => hole("[data-objective-display]").textContent,
  };
}

const ZUSTAENDE = [
  { name: "erreicht", daten: { result_summary: "Termin gebucht.", objective_achieved: true }, wert: "erreicht", sichtbar: true },
  { name: "verfehlt", daten: { result_summary: "Niemand ging ran.", objective_achieved: false }, wert: "verfehlt", sichtbar: true },
  { name: "unklar ohne Text", daten: { result_summary: "", objective_achieved: "unclear" }, wert: "offen", sichtbar: true },
  { name: "Feld fehlt, Text null", daten: { result_summary: null }, wert: "offen", sichtbar: true },
  { name: "unklar mit Text", daten: { result_summary: "Es gab ein Gespraech.", objective_achieved: "unclear" }, sichtbar: false },
  { name: "fremder Wert", daten: { result_summary: "Es gab ein Gespraech.", objective_achieved: "vielleicht" }, sichtbar: false },
];

for (const sprache of Object.keys(WORTE)) {
  for (const zustand of ZUSTAENDE) {
    test(`Ziel-Anzeige ${sprache}: ${zustand.name}`, () => {
      const widget = widgetImBrowser(sprache);
      widget.ergebnis(zustand.daten);
      assert.equal(widget.zeile() === "none", !zustand.sichtbar);
      if (zustand.sichtbar) assert.equal(widget.wert(), WORTE[sprache][zustand.wert]);
      else assert.ok(!Object.values(WORTE[sprache]).includes(widget.wert()));
    });
  }
  test(`Ziel-Anzeige ${sprache}: Beschriftung der Zeile`, () => {
    if (sprache !== "en") assert.equal(WIDGET_DICT[sprache].Goal, WORTE[sprache].beschriftung);
    assert.ok(CALL_HTML.includes('data-i18n="Goal"'));
  });
}

test("Ziel-Anzeige: kein Objective met und kein Ja/Nein im ausgelieferten Widget", () => {
  for (const [id, html] of Object.entries(WIDGETS)) {
    for (const wort of VERBOTEN) {
      assert.ok(!new RegExp(`(["'>])${wort}(["'<])`).test(html), `${id} enthaelt "${wort}"`);
    }
    assert.ok(!html.includes("Objective met"), id);
  }
});
