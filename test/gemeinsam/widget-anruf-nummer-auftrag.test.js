import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const ANRUF = (await ausgelieferteWidgets()).call;
const WIDGET_DICT = JSON.parse(skriptbloecke(ANRUF).find((code) => code.includes("HermesI18n = {")).match(/var WIDGET_DICT = (.*);\n/)[1]);
const ERGEBNIS = "ui/notifications/tool-result";
const NUMMER = "+492115550142";
const ANZEIGE = "+492115550142";
const AUFTRAG = "Ich möchte einen Haarschnitt für Donnerstagvormittag buchen.";

function knoten() {
  return {
    className: "",
    style: {},
    attribute: {},
    text: "",
    get textContent() {
      return this.text;
    },
    set textContent(wert) {
      this.text = wert;
    },
    setAttribute(name, wert) {
      this.attribute[name] = wert;
    },
    removeAttribute(name) {
      delete this.attribute[name];
    },
    addEventListener() {},
  };
}

function karte() {
  const knoten_je_wahl = new Map();
  const hole = (sel) => {
    if (!knoten_je_wahl.has(sel)) knoten_je_wahl.set(sel, knoten());
    return knoten_je_wahl.get(sel);
  };
  hole(".w").className = "w";
  const hoerer = [];
  const gesendet = [];
  const fenster = {
    document: { querySelector: hole },
    addEventListener: (art, f) => hoerer.push({ art, f }),
    parent: { postMessage: (nachricht) => gesendet.push(nachricht.params) },
    __hermesUiReady: true,
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
  };
  fenster.window = fenster;
  vm.runInContext(skriptbloecke(ANRUF).filter((s) => s.includes("TOOL_GET_STATUS")).at(-1), vm.createContext(fenster));
  const schicke = (inhalt) => hoerer.filter((h) => h.art === "message").forEach((h) => h.f({ data: { method: ERGEBNIS, params: { structuredContent: { call_id: "c1", ...inhalt } } } }));
  const zeile = (name) => (hole(`[data-row="${name}"]`).style.display === "" ? "sichtbar" : "versteckt");
  return { hole, schicke, zeile, gesendet };
}

test("widget-anruf-nummer-auftrag K2: im Zustand Wählt zeigt die Karte die Zeile Auftrag mit dem Satz und die Nummer im Fuß", () => {
  const s = karte();
  assert.equal(s.zeile("assignment"), "versteckt");
  s.schicke({ status: "dialing", to: NUMMER, objective: AUFTRAG });
  assert.equal(s.zeile("assignment"), "sichtbar");
  assert.equal(s.hole("[data-assignment-display]").text, AUFTRAG);
  assert.equal(s.hole("[data-number-display]").text, ANZEIGE);
  assert.equal(s.hole("[data-cancel]").style.display, "");
});

test("widget-anruf-nummer-auftrag K2: die Antwort von place_call mit result_summary null füllt Auftrag und Nummer ebenfalls", () => {
  const s = karte();
  s.schicke({ status: "dialing", result_summary: null, to: NUMMER, objective: AUFTRAG });
  assert.equal(s.zeile("assignment"), "sichtbar");
  assert.equal(s.hole("[data-assignment-display]").text, AUFTRAG);
  assert.equal(s.hole("[data-number-display]").text, ANZEIGE);
});

test("widget-anruf-nummer-auftrag K2: im Endzustand bleibt die Nummer im Fuß, der Abbrechen-Knopf ist weg", () => {
  const s = karte();
  s.schicke({ status: "dialing", to: NUMMER, objective: AUFTRAG });
  s.schicke({ status: "completed", to: NUMMER, objective: AUFTRAG });
  assert.equal(s.hole("[data-number-display]").text, ANZEIGE);
  assert.equal(s.hole("[data-cancel]").style.display, "none");
});

test("widget-anruf-nummer-auftrag K2: ohne Feld keine Zeile und kein Platzhalter", () => {
  const s = karte();
  s.schicke({ status: "dialing", to: null, objective: null });
  assert.equal(s.zeile("assignment"), "versteckt");
  assert.equal(s.hole("[data-number-display]").text, "");
  s.schicke({ status: "in_progress", to: "", objective: "   " });
  assert.equal(s.zeile("assignment"), "versteckt");
  assert.equal(s.hole("[data-number-display]").text, "");
  assert.equal(s.hole("[data-assignment-display]").text, "");
});

test("widget-anruf-nummer-auftrag K2: die Zeile heißt Auftrag und die Nummer steht links vom Abbrechen-Knopf im Fuß", () => {
  assert.match(ANRUF, /data-row="assignment"[^>]*>\s*<span data-i18n="Assignment">Assignment<\/span><span data-assignment-display><\/span>/);
  assert.match(ANRUF, /<div class="fuss">\s*<span data-number-display><\/span>\s*<button[^>]*data-cancel/);
  assert.equal(WIDGET_DICT.de.Assignment, "Auftrag");
  assert.equal(WIDGET_DICT.fr.Assignment, "Mission");
});

test("widget-anruf-nummer-auftrag K2: die Nummer wird nur bei +49 mit Vorwahl und Rest von mindestens vier Ziffern gruppiert", () => {
  const faelle = [
    ["+492115550142", "+492115550142"],
    ["+4921155", "+4921155"],
    ["+492115555", "+492115555"],
    ["+49211555", "+49211555"],
    ["+14155550142", "+14155550142"],
    ["x+492115550142", "x+492115550142"],
    ["+492115550142x", "+492115550142x"],
    ["+49 211 5550142", "+49 211 5550142"],
  ];
  for (const [eingabe, erwartet] of faelle) {
    const s = karte();
    s.schicke({ status: "dialing", to: eingabe });
    assert.equal(s.hole("[data-number-display]").text, erwartet, eingabe);
  }
});
