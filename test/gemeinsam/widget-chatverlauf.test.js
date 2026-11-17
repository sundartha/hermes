import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const METHOD_TOOL_RESULT = "ui/notifications/tool-result";
const WIDGETS = await ausgelieferteWidgets();
const SKRIPT_I18N = skriptbloecke(WIDGETS.call).find((code) => code.includes("HermesI18n = {"));
const SKRIPT_CALL = skriptbloecke(WIDGETS.call).find((code) => code.includes("function init()"));
const CSS = [...WIDGETS.call.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((treffer) => treffer[1]).join("\n");
const BEREICH = /<div class="chatblock"[^>]*data-row="chat"[^>]*>[\s\S]*?<div class="fuss">/;

function element() {
  const attrs = {};
  const kinder = [];
  return {
    textContent: "",
    className: "",
    style: {},
    kinder,
    get firstChild() {
      return kinder[0] ?? null;
    },
    getAttribute: (name) => attrs[name] ?? null,
    setAttribute: (name, wert) => {
      attrs[name] = String(wert);
    },
    removeAttribute: (name) => {
      delete attrs[name];
    },
    appendChild: (kind) => kinder.push(kind),
    removeChild: (kind) => kinder.splice(kinder.indexOf(kind), 1),
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
  let takt = null;
  const fristen = [];
  const sandbox = {
    __hermesUiReady: true,
    parent: { postMessage: (nachricht) => gesendet.push(nachricht) },
    setInterval: (fn) => {
      takt = fn;
      return 1;
    },
    clearInterval() {},
    setTimeout: (fn) => {
      fristen.push(fn);
      return 1;
    },
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
  const abruf = (name) => gesendet.filter((n) => n.params?.name === name).at(-1);
  const chat = hole("[data-chat]");
  return {
    frageStatus: () => takt(),
    naechsterAbruf: () => fristen.at(-1)(),
    beantworte: (name, antwort) => sende({ id: abruf(name).id, result: antwort }),
    blasen: () => chat.kinder.map((blase) => ({ klasse: blase.className, wer: blase.kinder[0].textContent, text: blase.kinder[1].textContent })),
    sichtbar: () => hole('[data-row="chat"]').style.display === "",
    liveZeileSichtbar: () => hole('[data-row="lines"]').style.display !== "none",
    wirkt: hole,
  };
}

const ERGEBNIS = { call_id: "call_1", outcome: null, next_step: null, result_summary: "Termin gebucht.", objective_achieved: true };
const PLATZHALTER = "(No summary available yet - wait about 5 seconds and call again if needed.)";
const DREI = [
  { role: "agent", text: "Guten Tag, hier ist Hermes." },
  { role: "counterparty", text: "Ja, bitte?" },
  { role: "agent", text: "Ich moechte einen Termin." },
];
const antwort = (transcript) => ({ structuredContent: ERGEBNIS, content: [], _meta: { transcript } });

for (const status of ["completed", "failed"]) {
  test(`Chatverlauf ${status}: drei Turns erscheinen als Blasen, Hermes und Gegenueber nach Klasse getrennt`, () => {
    const widget = widgetImBrowser("de", status);
    widget.beantworte("get_call_result", antwort(DREI));
    assert.equal(widget.sichtbar(), true);
    assert.deepEqual(widget.blasen(), [
      { klasse: "bubble agent", wer: "Hermes", text: "Guten Tag, hier ist Hermes." },
      { klasse: "bubble counterparty", wer: "Gegenüber", text: "Ja, bitte?" },
      { klasse: "bubble agent", wer: "Hermes", text: "Ich moechte einen Termin." },
    ]);
    assert.equal(widget.liveZeileSichtbar(), false);
  });
}

test("Chatverlauf: der Block ist im Markup zunaechst verborgen", () => {
  assert.match(WIDGETS.call, /<div class="chatblock" data-row="chat" style="display:none">/);
});

test("Chatverlauf: die Beschriftung des Gegenuebers folgt der Sprache der Karte", () => {
  const beschriftung = (sprache) => {
    const widget = widgetImBrowser(sprache, "completed");
    widget.beantworte("get_call_result", antwort([{ role: "counterparty", text: "x" }]));
    return widget.blasen()[0].wer;
  };
  assert.equal(beschriftung("en"), "Other party");
  assert.equal(beschriftung("fr"), "Interlocuteur");
});

test("Chatverlauf: Text bleibt Text, Markup wird nicht ausgefuehrt", () => {
  const widget = widgetImBrowser("de", "completed");
  const heikel = "<img src=x onerror=alert(1)> & <b>fett</b>";
  widget.beantworte("get_call_result", antwort([{ role: "counterparty", text: heikel }]));
  assert.equal(widget.blasen()[0].text, heikel);
  assert.equal(/innerHTML|insertAdjacentHTML|document\.write/.test(SKRIPT_CALL), false);
});

test("Chatverlauf: ohne Transkript, mit leerer Liste oder mit lauter ungueltigen Eintraegen bleibt der Block verborgen", () => {
  const ungueltig = [null, "text", 5, { role: "system", text: "x" }, { role: "agent" }, { role: "agent", text: 7 }, { role: "toString", text: "x" }, { role: "agent", text: "   " }];
  for (const transcript of [undefined, [], "kein Array", ungueltig]) {
    const widget = widgetImBrowser("de", "completed");
    widget.beantworte("get_call_result", antwort(transcript));
    assert.equal(widget.sichtbar(), false);
    assert.deepEqual(widget.blasen(), []);
  }
});

test("Chatverlauf: ungueltige Eintraege fallen weg, gueltige bleiben in Reihenfolge", () => {
  const widget = widgetImBrowser("de", "completed");
  widget.beantworte("get_call_result", antwort([{ role: "agent", text: "eins" }, { role: "x", text: "weg" }, { role: "counterparty", text: "zwei" }]));
  assert.deepEqual(widget.blasen().map((blase) => blase.text), ["eins", "zwei"]);
});

test("Chatverlauf: eine neue Antwort ersetzt die alten Blasen", () => {
  const widget = widgetImBrowser("de", "completed");
  const unfertig = { ...ERGEBNIS, result_summary: PLATZHALTER, objective_achieved: "unclear" };
  widget.beantworte("get_call_result", { structuredContent: unfertig, content: [], _meta: { transcript: DREI } });
  assert.equal(widget.blasen().length, 3);
  widget.naechsterAbruf();
  widget.beantworte("get_call_result", { structuredContent: unfertig, content: [], _meta: { transcript: [{ role: "agent", text: "neu" }] } });
  assert.deepEqual(widget.blasen().map((blase) => blase.text), ["neu"]);
  widget.naechsterAbruf();
  widget.beantworte("get_call_result", antwort([]));
  assert.equal(widget.sichtbar(), false);
  assert.deepEqual(widget.blasen(), []);
});

test("Chatverlauf: nur die Antwort auf get_call_result fuellt ihn, nie die auf get_call_status oder structuredContent", () => {
  const widget = widgetImBrowser("de", "completed");
  widget.frageStatus();
  widget.beantworte("get_call_status", { structuredContent: { call_id: "call_1", status: "completed", duration_s: 5 }, content: [], _meta: { transcript: DREI } });
  assert.equal(widget.sichtbar(), false);
  widget.beantworte("get_call_result", { structuredContent: { ...ERGEBNIS, transcript: DREI }, content: [] });
  assert.equal(widget.sichtbar(), false);
});

function regel(selektor) {
  const treffer = CSS.split("\n").map((zeile) => zeile.trim()).filter((zeile) => zeile.startsWith(selektor + "{"));
  assert.equal(treffer.length, 1, "Regel " + selektor);
  const innen = treffer[0].slice(selektor.length + 1, treffer[0].indexOf("}"));
  return Object.fromEntries(innen.split(";").filter(Boolean).map((eintrag) => [eintrag.slice(0, eintrag.indexOf(":")).trim(), eintrag.slice(eintrag.indexOf(":") + 1).trim()]));
}

test("Chatverlauf: feste Hoehe, internes Scrollen, Blasen brechen um und schrumpfen nicht", () => {
  const chat = regel(".chat");
  assert.equal(chat.height, "240px");
  assert.equal(chat["overflow-y"], "auto");
  assert.equal(chat["min-width"], "0");
  assert.equal(chat["flex-shrink"], "0");
  const blase = regel(".bubble");
  assert.equal(blase["overflow-wrap"], "anywhere");
  assert.equal(blase["min-width"], "0");
  assert.equal(blase["flex-shrink"], "0");
  assert.equal(blase["max-width"], "82%");
});

test("Chatverlauf: Hermes steht links, das Gegenueber rechts, beide aus den Farben des Entwurfs", () => {
  assert.equal(regel(".bubble.agent")["align-self"], "flex-start");
  assert.equal(regel(".bubble.counterparty")["align-self"], "flex-end");
  for (const selektor of [".bubble.agent", ".bubble.counterparty"]) {
    const werte = Object.values(regel(selektor)).join(" ");
    assert.equal(/#[0-9a-f]{3,8}\b|rgba?\(/i.test(werte), false, selektor + " nutzt nur Variablen");
  }
});

test("Chatverlauf: der Block liegt im scrollenden Inhaltsbereich, ueber dem Abbrechen-Fuss", () => {
  const innen = WIDGETS.call.indexOf('<div class="inhalt">');
  const block = WIDGETS.call.indexOf('class="chatblock"');
  assert.ok(block > innen);
  assert.ok(BEREICH.test(WIDGETS.call));
  assert.ok(WIDGETS.call.indexOf('data-row="chat"') < WIDGETS.call.indexOf('<div class="fuss">'));
});

test("Chatverlauf: Ueberschrift und Beschriftung stehen in jeder Sprache des Woerterbuchs", () => {
  const woerterbuch = JSON.parse(SKRIPT_I18N.match(/var WIDGET_DICT = (.*);\n/)[1]);
  assert.equal(woerterbuch.de.Conversation, "Gespräch");
  assert.equal(woerterbuch.de["Other party"], "Gegenüber");
  assert.equal(woerterbuch.fr.Conversation, "Conversation");
  assert.equal(woerterbuch.fr["Other party"], "Interlocuteur");
  assert.match(WIDGETS.call, /<div class="chat-titel" data-i18n="Conversation">Conversation<\/div>/);
});
