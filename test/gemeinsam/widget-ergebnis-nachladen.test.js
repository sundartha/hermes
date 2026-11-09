import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";
import http from "node:http";
import { registerTools } from "../../src/mcp-tools.js";

const METHOD_TOOL_RESULT = "ui/notifications/tool-result";
const WIDGETS = await ausgelieferteWidgets();
const SKRIPT_I18N = skriptbloecke(WIDGETS.call).find((code) => code.includes("HermesI18n = {"));
const SKRIPT_CALL = skriptbloecke(WIDGETS.call).find((code) => code.includes("function init()"));
const NACHLADE_ABSTAND_MS = 3000;
const MAX_NACHLADEN = 5;

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
      structuredContent: { call_id: "call_1", status: "completed", duration_s: 5, last_transcript_lines: [], failure_reason: null },
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
    nachladeUhren,
    laufeAb: () => nachladeUhren().at(-1).fn(),
    ziel: () => ({ sichtbar: hole('[data-row="objective"]').style.display !== "none", text: hole("[data-objective-display]").textContent }),
    zusammenfassung: () => hole('[data-mcp="result_summary"]').textContent,
    zusammenfassungSichtbar: () => hole('[data-row="summary"]').style.display !== "none",
  };
}

async function platzhalterAusMcp(sprache) {
  const gateway = http.createServer((_anfrage, antwort) => {
    antwort.setHeader("content-type", "application/json");
    antwort.end(JSON.stringify({ status: "completed", summary: null, transcript: [] }));
  });
  await new Promise((fertig) => gateway.listen(0, "127.0.0.1", fertig));
  const vorher = process.env.GATEWAY_URL;
  process.env.GATEWAY_URL = `http://127.0.0.1:${gateway.address().port}`;
  try {
    const werkzeuge = new Map();
    registerTools(
      { tool() {}, registerResource() {}, registerTool: (name, _konfig, handler) => werkzeuge.set(name, handler) },
      { uiHost: { enabled: true }, language: sprache },
    );
    const ergebnis = await werkzeuge.get("get_call_result")({ call_id: "call_1" });
    assert.equal(ergebnis.structuredContent.objective_achieved, "unclear");
    return ergebnis.structuredContent.result_summary;
  } finally {
    if (vorher === undefined) delete process.env.GATEWAY_URL;
    else process.env.GATEWAY_URL = vorher;
    gateway.close();
  }
}

const SPRACHEN = ["de", "en", "fr"];
const PLATZHALTER = await Promise.all(SPRACHEN.map(async (sprache) => [sprache, await platzhalterAusMcp(sprache)]));
const PLATZHALTER_DE = PLATZHALTER[0][1];

for (const [sprache, platzhalter] of PLATZHALTER) {
  test(`Ergebnis nachladen ${sprache}: Platzhalter wird nie gezeigt, drittes Abrufergebnis erscheint`, () => {
    const widget = widgetImBrowser(sprache);
    assert.equal(widget.abrufe().length, 1);
    widget.beantworte({ result_summary: platzhalter, objective_achieved: "unclear" });
    assert.notEqual(widget.zusammenfassung(), platzhalter);
    assert.equal(widget.zusammenfassungSichtbar(), false);
    assert.equal(widget.nachladeUhren().length, 1);
    widget.laufeAb();
    assert.equal(widget.abrufe().length, 2);
    widget.beantworte({ result_summary: platzhalter, objective_achieved: "unclear" });
    widget.laufeAb();
    assert.equal(widget.abrufe().length, 3);
    widget.beantworte({ result_summary: "Termin gebucht.", objective_achieved: true });
    assert.equal(widget.zusammenfassung(), "Termin gebucht.");
    assert.equal(widget.zusammenfassungSichtbar(), true);
    assert.equal(widget.ziel().sichtbar, true);
    assert.equal(widget.nachladeUhren().length, 2);
  });
}

test("Ergebnis nachladen: nach fuenf Wiederholungen ohne Ergebnis kein sechster Abruf, Ziel-Zeile entfaellt", () => {
  const widget = widgetImBrowser("de");
  const platzhalter = PLATZHALTER_DE;
  widget.beantworte({ result_summary: platzhalter, objective_achieved: "unclear" });
  assert.equal(widget.ziel().sichtbar, true);
  for (let i = 0; i < MAX_NACHLADEN; i += 1) {
    widget.laufeAb();
    widget.beantworte({ result_summary: platzhalter, objective_achieved: "unclear" });
  }
  assert.equal(widget.abrufe().length, 1 + MAX_NACHLADEN);
  assert.equal(widget.nachladeUhren().length, MAX_NACHLADEN);
  assert.equal(widget.ziel().sichtbar, false);
  assert.notEqual(widget.zusammenfassung(), platzhalter);
});

test("Ergebnis nachladen: ohne Platzhalter bleibt es bei einem Abruf", () => {
  const widget = widgetImBrowser("en");
  widget.beantworte({ result_summary: "Es gab ein Gespraech.", objective_achieved: "unclear" });
  assert.equal(widget.nachladeUhren().length, 0);
  assert.equal(widget.abrufe().length, 1);
});

test("Platzhalterliste nur im Anruf-Widget, in der Reihenfolge de, en, fr", () => {
  const liste = `var AWAIT_SUMMARIES = ${JSON.stringify(PLATZHALTER.map(([, text]) => text))}`;
  assert.equal(WIDGETS.call.split(liste).length, 2);
  for (const html of Object.values(WIDGETS)) assert.equal(html.includes("__AWAIT_SUMMARIES__"), false);
  for (const id of ["agent-status", "my-number", "calls"]) assert.equal(WIDGETS[id].includes("AWAIT_SUMMARIES"), false);
});
