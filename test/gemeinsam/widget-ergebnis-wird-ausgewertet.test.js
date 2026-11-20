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

const PLATZHALTER = {
  de: "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)",
  en: "(No summary available yet - wait about 5 seconds and call again if needed.)",
  fr: "(Pas encore de résumé disponible - attendez environ 5 secondes et réessayez si besoin.)",
};
const HINWEIS = { de: "Wird ausgewertet", en: "Result being evaluated", fr: "Évaluation en cours" };

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
  const sandbox = {
    __hermesUiReady: true,
    parent: { postMessage: (nachricht) => gesendet.push(nachricht) },
    setInterval: () => 1,
    clearInterval() {},
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
  vm.runInContext(SKRIPT_CALL, sandbox);
  hole('[data-mcp="call_id"]').textContent = "call_1";
  const sende = (daten) => hoerer.forEach((h) => h({ data: daten }));
  sende({
    method: METHOD_TOOL_RESULT,
    params: {
      _meta: { "hermes/locale": sprache, "hermes/content_locale": sprache },
      structuredContent: { call_id: "call_1", status, duration_s: 5, last_transcript_lines: [], failure_reason: null },
    },
  });
  const abrufe = () => gesendet.filter((n) => n.params?.name === "get_call_result");
  const nachladeUhren = () => zeitgeber.filter((z) => z.ms === NACHLADE_ABSTAND_MS);
  return {
    abrufe,
    beantworte: (daten) => {
      const offen = abrufe().at(-1);
      sende({ id: offen.id, result: { structuredContent: { call_id: "call_1", outcome: null, next_step: null, ...daten } } });
    },
    schiebe: (daten) => sende({ method: METHOD_TOOL_RESULT, params: { structuredContent: { call_id: "call_1", ...daten } } }),
    laufeAb: () => nachladeUhren().at(-1).fn(),
    text: () => hole('[data-mcp="result_summary"]').textContent,
    anzeige: () => hole('[data-row="summary"]').style.display,
  };
}

const unklar = (sprache) => ({ result_summary: PLATZHALTER[sprache], objective_achieved: "unclear" });

for (const sprache of Object.keys(PLATZHALTER)) {
  test(`Wird ausgewertet ${sprache}: Hinweis statt Platzhalter, dann das echte Ergebnis ohne Hinweis`, () => {
    const widget = widgetImBrowser(sprache, "completed");
    widget.beantworte(unklar(sprache));
    assert.equal(widget.anzeige(), "");
    assert.equal(widget.text(), HINWEIS[sprache]);
    widget.laufeAb();
    widget.beantworte({ result_summary: "Termin gebucht.", objective_achieved: true });
    assert.equal(widget.anzeige(), "");
    assert.equal(widget.text(), "Termin gebucht.");
  });
}

test("Wird ausgewertet: nach fuenf Wiederholungen bleibt der Hinweis und es gibt keinen sechsten Abruf", () => {
  const widget = widgetImBrowser("de", "completed");
  widget.beantworte(unklar("de"));
  for (let i = 0; i < MAX_NACHLADEN; i += 1) {
    widget.laufeAb();
    widget.beantworte(unklar("de"));
  }
  assert.equal(widget.abrufe().length, 1 + MAX_NACHLADEN);
  assert.equal(widget.anzeige(), "");
  assert.equal(widget.text(), HINWEIS.de);
});

test("Wird ausgewertet: ohne abgeschlossenen Anruf bleibt die Ergebnis-Zeile verborgen", () => {
  const widget = widgetImBrowser("de", "in_progress");
  widget.schiebe(unklar("de"));
  assert.equal(widget.anzeige(), "none");
  assert.notEqual(widget.text(), PLATZHALTER.de);
});

test("Wird ausgewertet: eine Antwort ohne Ergebnistext laesst den gezeigten Text stehen", () => {
  const widget = widgetImBrowser("de", "completed");
  widget.beantworte({ result_summary: "Termin gebucht.", objective_achieved: true });
  widget.beantworte({ next_step: "Rueckruf morgen" });
  assert.equal(widget.text(), "Termin gebucht.");
});
