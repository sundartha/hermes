import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { mitAnruffolge } from "./widget-anruffolge-attrappe.mjs";

const WIDGET = (await ausgelieferteWidgets()).call;
const WIDGET_WOERTER = JSON.parse(skriptbloecke(WIDGET).find((code) => code.includes("HermesI18n = {")).match(/var WIDGET_DICT = (.*);\n/)[1]);
const ERGEBNIS = "ui/notifications/tool-result";
const ZEILE = '[data-row="next_steps"]';
const LISTE = "[data-next-steps]";
const FORMAT = { dateStyle: "medium", timeStyle: "short" };
const ARTEN = ["appointment", "callback", "task", "other"];
const BESCHRIFTUNG = {
  en: { titel: "Next steps", appointment: "Appointment", callback: "Callback", task: "Task", other: "Other" },
  de: { titel: "Nächste Schritte", appointment: "Termin", callback: "Rückruf", task: "Aufgabe", other: "Sonstiges" },
  fr: { titel: "Prochaines étapes", appointment: "Rendez-vous", callback: "Rappel", task: "Tâche", other: "Autre" },
};

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

function karte(sprache = "en") {
  const elemente = new Map();
  const hole = (sel) => {
    if (!elemente.has(sel)) elemente.set(sel, element());
    return elemente.get(sel);
  };
  const hoerer = [];
  const sandbox = {
    __hermesUiReady: true,
    parent: { postMessage() {} },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
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
  vm.runInContext(skriptbloecke(WIDGET).find((code) => code.includes("HermesI18n = {")), sandbox);
  vm.runInContext(skriptbloecke(WIDGET).find((code) => code.includes("function init()")), sandbox);
  hole('[data-mcp="call_id"]').textContent = "c1";
  const meta = { "hermes/locale": sprache, "hermes/content_locale": sprache };
  const schicke = (inhalt) => hoerer.forEach((h) => h({ data: { method: ERGEBNIS, params: { _meta: meta, structuredContent: { call_id: "c1", status: "completed", result_summary: "Termin gebucht.", ...inhalt } } } }));
  const sichtbar = () => hole(ZEILE).style.display === "";
  const zeilen = () =>
    hole(LISTE).kinder.map((zeile) => ({
      art: zeile.kinder[0].textContent,
      text: zeile.kinder[1].textContent,
      zeitpunkt: zeile.kinder[2]?.textContent ?? null,
      klasse: zeile.className,
    }));
  return { schicke, sichtbar, zeilen, hole };
}

test("widget-naechste-schritte K1: ein Termin zeigt den Abschnitt mit Art, Text und Zeitpunkt in der Kartensprache", () => {
  const s = karte("de");
  s.schicke({ next_steps: [{ type: "appointment", text: "Termin Donnerstag", at: "2026-11-20T14:00" }] });
  assert.equal(s.sichtbar(), true);
  assert.deepEqual(s.zeilen(), [{ art: "Termin", text: "Termin Donnerstag", zeitpunkt: new Date("2026-11-20T14:00").toLocaleString("de", FORMAT), klasse: "schritt" }]);
  assert.match(s.zeilen()[0].zeitpunkt, /20/);
  assert.match(s.zeilen()[0].zeitpunkt, /14/);
  const f = karte("fr");
  f.schicke({ next_steps: [{ type: "appointment", text: "x", at: "2026-11-20T14:00" }] });
  assert.equal(f.zeilen()[0].zeitpunkt, new Date("2026-11-20T14:00").toLocaleString("fr", FORMAT));
});

test("widget-naechste-schritte K1: ein Zeitpunkt nur mit Datum zeigt das lokale Datum ohne Uhrzeit", () => {
  const s = karte("de");
  s.schicke({ next_steps: [{ type: "task", text: "x", at: "2026-11-20" }] });
  assert.equal(s.zeilen()[0].zeitpunkt, new Date(2026, 10, 20).toLocaleDateString("de", { dateStyle: "medium" }));
});

test("widget-naechste-schritte K1: ein Zeitpunkt, der kein Datum ist, erscheint wörtlich", () => {
  const s = karte("en");
  s.schicke({ next_steps: [{ type: "task", text: "x", at: "bald" }] });
  assert.equal(s.zeilen()[0].zeitpunkt, "bald");
});

test("widget-naechste-schritte K2: fünf Einträge erscheinen alle, ohne Zeitpunkt gibt es keine dritte Zelle und keinen Strich", () => {
  const s = karte("en");
  const schritte = [...ARTEN, "unbekannt"].map((type, i) => ({ type, text: `Schritt ${i}`, at: i === 1 ? null : "2026-11-20T14:00" }));
  s.schicke({ next_steps: schritte });
  const zeilen = s.zeilen();
  assert.deepEqual(zeilen.map((z) => z.art), ["Appointment", "Callback", "Task", "Other", "Other"]);
  assert.deepEqual(zeilen.map((z) => z.text), schritte.map((x) => x.text));
  assert.equal(zeilen[1].zeitpunkt, null);
  const ohneZeit = s.hole(LISTE).kinder[1];
  assert.equal(ohneZeit.kinder.length, 2);
  assert.notEqual(zeilen[0].zeitpunkt, null);
  assert.ok(zeilen.every((z) => z.zeitpunkt !== "—"));
});

for (const leer of [{ next_steps: [] }, {}, { next_steps: "kein Array" }, { next_steps: null }]) {
  test(`widget-naechste-schritte K3: ${JSON.stringify(leer)} lässt den Abschnitt weg`, () => {
    const s = karte("en");
    s.schicke(leer);
    assert.equal(s.hole(ZEILE).style.display, "none");
    assert.equal(s.zeilen().length, 0);
  });
}

test("widget-naechste-schritte K3: Einträge blenden den Abschnitt ein, eine leere Liste danach wieder aus und leert ihn", () => {
  const s = karte("en");
  s.schicke({ next_steps: [] });
  assert.equal(s.sichtbar(), false);
  s.schicke({ next_steps: [{ type: "task", text: "A", at: null }] });
  assert.equal(s.sichtbar(), true);
  s.schicke({ next_steps: [{ type: "task", text: "B", at: null }, { type: "task", text: "C", at: null }] });
  assert.deepEqual(s.zeilen().map((z) => z.text), ["B", "C"]);
  s.schicke({ next_steps: [] });
  assert.equal(s.hole(ZEILE).style.display, "none");
  assert.equal(s.zeilen().length, 0);
});

test("widget-naechste-schritte K3: Einträge ohne lesbaren Text zählen nicht", () => {
  const s = karte("en");
  s.schicke({ next_steps: [null, { type: "task" }, { type: "task", text: "  ", at: null }, "x", { type: "task", text: "Echt", at: null }] });
  assert.deepEqual(s.zeilen().map((z) => z.text), ["Echt"]);
  s.schicke({ next_steps: [null, { type: "task", text: "" }] });
  assert.equal(s.hole(ZEILE).style.display, "none");
});

test("widget-naechste-schritte K4: Text und Zeitpunkt stehen als Text, nie als HTML", () => {
  const s = karte("en");
  s.schicke({ next_steps: [{ type: "other", text: "<b>x</b>", at: "<i>y</i>" }] });
  assert.deepEqual([s.zeilen()[0].text, s.zeilen()[0].zeitpunkt], ["<b>x</b>", "<i>y</i>"]);
  assert.equal(typeof s.hole(LISTE).innerHTML, "undefined");
});

test("widget-naechste-schritte K5: Titel und die vier Arten stehen in en, de und fr", () => {
  for (const [sprache, woerter] of Object.entries(BESCHRIFTUNG)) {
    const s = karte(sprache);
    s.schicke({ next_steps: ARTEN.map((type) => ({ type, text: "t", at: null })) });
    assert.deepEqual(s.zeilen().map((z) => z.art), ARTEN.map((a) => woerter[a]), sprache);
    if (sprache !== "en") assert.equal(WIDGET_WOERTER[sprache]["Next steps"], woerter.titel);
  }
  assert.match(WIDGET, /<div class="chat-titel" data-i18n="Next steps">Next steps<\/div>/);
});

test("widget-naechste-schritte: der Abschnitt ist im Markup zunächst verborgen und bricht lange Texte um", () => {
  assert.match(WIDGET, /<div class="chatblock" data-row="next_steps" style="display:none">/);
  assert.match(WIDGET, /\.schritt\{[^}]*overflow-wrap:anywhere/);
  assert.match(WIDGET, /\.schritt\{[^}]*min-width:0/);
});

const chrome = findChrome();
const OPTIONS = { skip: chrome ? false : "kein Chromium gefunden (CHROME_BIN setzen)", timeout: 180000 };
const LANGES_WORT = "Haftpflichtversicherungsvertragsänderungsbestätigung";

function mitSchritten(schritte) {
  const einspeisung = `<script>window.addEventListener("message",function(e){var m=e.data;if(m&&m.result&&m.result.structuredContent&&"result_summary" in m.result.structuredContent){m.result.structuredContent.next_steps=${JSON.stringify(schritte)}}})</script>`;
  return WIDGET.replace("<head>", () => "<head>" + einspeisung);
}

const MESSUNG = `(() => {
  const doc = document.getElementById("f").contentDocument;
  const kasten = (el) => { const r = el.getBoundingClientRect(); return { links: r.left, rechts: r.right }; };
  const abschnitt = doc.querySelector('[data-row="next_steps"]');
  const zeilen = [...doc.querySelector("[data-next-steps]").children].map((z) => ({ kasten: kasten(z), abgeschnitten: z.scrollWidth > z.clientWidth, text: z.textContent }));
  return JSON.stringify({ sichtbar: abschnitt.style.display !== "none", abschnitt: kasten(abschnitt), zeilen, karte: doc.querySelector(".w").getBoundingClientRect().height, seitenbreite: doc.documentElement.scrollWidth, rahmenbreite: document.getElementById("f").getBoundingClientRect().width });
})()`;

test("widget-naechste-schritte K6: längste Texte bei 420 px brechen um, nichts ragt heraus, die Kartenhöhe bleibt unter 760 px", OPTIONS, async () => {
  const schritte = ARTEN.map((type) => ({ type, text: `${LANGES_WORT} ${LANGES_WORT.repeat(4)}`, at: "2026-11-20T14:00" }));
  const lies = async (_meldung, { send, sessionId }) => {
    const { result } = await send("Runtime.evaluate", { expression: MESSUNG, returnByValue: true }, sessionId);
    return JSON.parse(result.value);
  };
  const szenario = { locale: "de", inhaltssprache: "de", erwartet: "de", breite: 420, waehlenS: 1, gespraechS: 1, zeilen: [], ergebnis: { status: "completed", failure_reason: null, objective_achieved: true, result_summary: "Termin gebucht." } };
  const m = await mitAnruffolge(chrome, mitSchritten(schritte), { szenario, tempo: 0.05, lies });
  assert.equal(m.sichtbar, true);
  assert.equal(m.zeilen.length, 4);
  assert.ok(m.seitenbreite <= m.rahmenbreite);
  assert.ok(m.karte <= 760);
  for (const zeile of m.zeilen) {
    assert.ok(zeile.kasten.rechts <= m.abschnitt.rechts + 0.5);
    assert.equal(zeile.abgeschnitten, false);
    assert.ok(zeile.text.includes(LANGES_WORT));
  }
});
