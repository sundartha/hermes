import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const METHOD_TOOL_RESULT = "ui/notifications/tool-result";
const WIDGETS = await ausgelieferteWidgets();
const SKRIPT_I18N = skriptbloecke(WIDGETS.call).find((code) => code.includes("HermesI18n = {"));
const SKRIPT_CALL = skriptbloecke(WIDGETS.call).find((code) => code.includes("function init()"));
const NACHLADE_ABSTAND_MS = 3000;
const MAX_NACHLADEN = 5;
const FEHLER_GRENZE = 3;
const PLATZHALTER_DE = "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)";
const HINWEIS = {
  warten: { de: "Wird ausgewertet", en: "Result being evaluated", fr: "Évaluation en cours" },
  stehen: { de: "Nicht mehr aktualisiert", en: "No longer updating", fr: "Plus de mise à jour" },
};

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

function widgetImBrowser(sprache, status) {
  const elemente = new Map();
  const hole = (selektor) => {
    if (!elemente.has(selektor)) elemente.set(selektor, element());
    return elemente.get(selektor);
  };
  const hoerer = [];
  const gesendet = [];
  const zeitgeber = [];
  const intervalle = [];
  const gestoppt = [];
  const sandbox = {
    __hermesUiReady: true,
    parent: { postMessage: (nachricht) => gesendet.push(nachricht) },
    setInterval: (fn) => {
      intervalle.push(fn);
      return intervalle.length;
    },
    clearInterval: (kennung) => gestoppt.push(kennung),
    setTimeout: (fn, ms) => zeitgeber.push({ fn, ms }),
    clearTimeout() {},
  };
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
  sandbox.addEventListener = (art, h) => {
    if (art === "message") hoerer.push(h);
  };
  sandbox.CustomEvent = function CustomEvent(art) {
    this.type = art;
  };
  sandbox.dispatchEvent = () => {};
  vm.createContext(sandbox);
  vm.runInContext(SKRIPT_I18N, sandbox);
  hole('[data-mcp="call_id"]').textContent = "call_1";
  vm.runInContext(SKRIPT_CALL, sandbox);
  const sende = (daten) => hoerer.forEach((h) => h({ data: daten }));
  sende({
    method: METHOD_TOOL_RESULT,
    params: {
      _meta: { "hermes/locale": sprache, "hermes/content_locale": sprache },
      structuredContent: { call_id: "call_1", status, duration_s: 5, last_transcript_lines: [], failure_reason: null },
    },
  });
  const grundstand = gestoppt.length;
  const abrufe = (name) => gesendet.filter((n) => n.params?.name === name);
  const letzte = (name) => abrufe(name).at(-1);
  return {
    gestoppt: () => gestoppt.length > grundstand,
    abrufe,
    fehler: () => {
      intervalle.at(-1)();
      sende({ id: letzte("get_call_status").id, error: { code: -32000, message: "kaputt" } });
    },
    erfolg: () => {
      intervalle.at(-1)();
      const daten = { call_id: "call_1", status, duration_s: 6, last_transcript_lines: [], failure_reason: null };
      sende({ id: letzte("get_call_status").id, result: { structuredContent: daten } });
    },
    beantworte: (daten) => {
      sende({ id: letzte("get_call_result").id, result: { structuredContent: { call_id: "call_1", outcome: null, next_step: null, ...daten } } });
    },
    schiebe: (daten) => sende({ method: METHOD_TOOL_RESULT, params: { structuredContent: { call_id: "call_1", ...daten } } }),
    laufeAb: () => zeitgeber.filter((z) => z.ms === NACHLADE_ABSTAND_MS).at(-1).fn(),
    uhren: () => zeitgeber.filter((z) => z.ms === NACHLADE_ABSTAND_MS).length,
    text: () => hole('[data-mcp="result_summary"]').textContent,
    anzeige: () => hole('[data-row="summary"]').style.display,
  };
}

test("Nachladen: weniger als drei Fehlerantworten in Folge, dann Erfolg - Polling laeuft, Zaehler beginnt bei 0", () => {
  const widget = widgetImBrowser("de", "in_progress");
  for (let i = 0; i < FEHLER_GRENZE - 1; i += 1) widget.fehler();
  widget.erfolg();
  for (let i = 0; i < FEHLER_GRENZE - 1; i += 1) widget.fehler();
  assert.equal(widget.gestoppt(), false);
  assert.notEqual(widget.text(), HINWEIS.stehen.de);
});

for (const sprache of Object.keys(HINWEIS.stehen)) {
  test(`Nachladen ${sprache}: drei Fehlerantworten in Folge stoppen das Polling und die Karte zeigt es`, () => {
    const widget = widgetImBrowser(sprache, "in_progress");
    for (let i = 0; i < FEHLER_GRENZE - 1; i += 1) widget.fehler();
    assert.equal(widget.gestoppt(), false);
    widget.fehler();
    assert.equal(widget.gestoppt(), true);
    assert.equal(widget.anzeige(), "");
    assert.equal(widget.text(), HINWEIS.stehen[sprache]);
  });
}

test("Nachladen: ein abgeschlossener Anruf mit echtem Ergebnis behaelt es auch nach drei Fehlerantworten", () => {
  const widget = widgetImBrowser("de", "completed");
  widget.beantworte({ result_summary: "Termin gebucht.", objective_achieved: true });
  for (let i = 0; i < FEHLER_GRENZE; i += 1) widget.fehler();
  assert.equal(widget.text(), "Termin gebucht.");
});

test("Platzhalter: unclear mit Text aus der Platzhalterliste wird nachgeladen", () => {
  const widget = widgetImBrowser("de", "completed");
  widget.beantworte({ result_summary: PLATZHALTER_DE, objective_achieved: "unclear" });
  assert.equal(widget.text(), HINWEIS.warten.de);
  assert.equal(widget.uhren(), 1);
});

for (const text of [null, "Zwischenstand: Rueckfrage laeuft"]) {
  test(`Platzhalter: unclear mit ${JSON.stringify(text)} ohne abgeschlossenen Anruf wird nachgeladen, bis zur Grenze`, () => {
    const widget = widgetImBrowser("de", "failed");
    widget.beantworte({ result_summary: text, objective_achieved: "unclear" });
    assert.equal(widget.text(), HINWEIS.warten.de);
    for (let i = 0; i < MAX_NACHLADEN + 2; i += 1) {
      if (widget.uhren() > i) widget.laufeAb();
      widget.beantworte({ result_summary: text, objective_achieved: "unclear" });
    }
    assert.equal(widget.uhren(), MAX_NACHLADEN);
    assert.equal(widget.text(), HINWEIS.warten.de);
  });
}

test("Platzhalter: bei abgeschlossenem Anruf ist unclear mit eigenem Text das endgueltige Ergebnis", () => {
  const widget = widgetImBrowser("de", "completed");
  widget.beantworte({ result_summary: "Die Gegenseite war unentschlossen.", objective_achieved: "unclear" });
  assert.equal(widget.text(), "Die Gegenseite war unentschlossen.");
  assert.equal(widget.uhren(), 0);
});
