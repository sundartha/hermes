import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { widgetPins } from "../../src/ui/registry.js";
import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const ANRUF = (await ausgelieferteWidgets()).call;
const WIDGET_DICT = JSON.parse(skriptbloecke(ANRUF).find((code) => code.includes("HermesI18n = {")).match(/var WIDGET_DICT = (.*);\n/)[1]);
const NEUE_VERSION = 38;
const ERGEBNIS = "ui/notifications/tool-result";

const UEBERSCHRIFT = {
  dialing: ["Hermes is calling.", ""],
  in_progress: ["Hermes is on the call.", ""],
  completed: ["The call is done.", ""],
  failed: ["Nobody picked up.", ""],
  cancelled: ["The call was", "cancelled."],
};
const DE = {
  "Hermes is calling.": "Hermes ruft an.",
  "Hermes is on the call.": "Hermes spricht gerade.",
  "The call is done.": "Der Anruf ist erledigt.",
  "Nobody picked up.": "Niemand hat abgenommen.",
  "The call was": "Du hast den Anruf",
  "cancelled.": "abgebrochen.",
};
const FR = {
  "Hermes is calling.": "Hermes appelle.",
  "Hermes is on the call.": "Hermes est en ligne.",
  "The call is done.": "L'appel est terminé.",
  "Nobody picked up.": "Personne n'a répondu.",
  "The call was": "L'appel a été",
  "cancelled.": "annulé.",
};

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

test("widget-anruf K4: jeder der fünf Status hat seine eigene Überschrift, nur der Abbruch trägt ein hervorgehobenes Wort", () => {
  const s = karte();
  for (const [status, [satz, betont]] of Object.entries(UEBERSCHRIFT)) {
    s.schicke({ status });
    assert.equal(s.hole("[data-hud-phase]").text, satz, status);
    assert.equal(s.hole("[data-hud-em]").text, betont, status);
    assert.equal(s.hole("[data-hud-phase]").attribute["data-i18n"], satz, status);
  }
  assert.equal(s.hole("[data-hud-em]").attribute["data-i18n"], "cancelled.");
  s.schicke({ status: "in_progress" });
  assert.equal(s.hole("[data-hud-em]").attribute["data-i18n"], undefined);
});

test("widget-anruf K4: vor dem ersten Ereignis steht im Markup die Wähl-Überschrift mit leerem Hervorhebungsplatz", () => {
  assert.match(ANRUF, /<h1 class="rise"><span data-hud-phase data-i18n="Hermes is calling\.">Hermes is calling\.<\/span> <em data-hud-em><\/em><\/h1>/);
  assert.match(ANRUF, /\.w h1 em:empty\{display:none\}/);
});

test("widget-anruf K4: die neuen Überschriften stehen in allen drei Sprachen im Wörterbuch", () => {
  for (const [englisch, deutsch] of Object.entries(DE)) {
    assert.equal(WIDGET_DICT.de[englisch], deutsch, englisch);
    assert.equal(WIDGET_DICT.fr[englisch], FR[englisch], englisch);
  }
});

test("widget-anruf K4: Zeilen je Zustand, bei Fehlschlag und Abbruch der Grund, nach Abbruch ohne Grundwort steht Abgebrochen", () => {
  const s = karte();
  s.schicke({ status: "in_progress" });
  assert.deepEqual(["lines", "failure", "outcome", "summary", "objective"].map((z) => s.zeile(z)), ["sichtbar", "versteckt", "versteckt", "versteckt", "versteckt"]);
  s.schicke({ status: "failed", failure_reason: "no-answer" });
  assert.deepEqual(["lines", "failure"].map((z) => s.zeile(z)), ["versteckt", "sichtbar"]);
  assert.equal(s.hole("[data-failure-display]").text, "No answer");
  s.schicke({ status: "cancelled", failure_reason: null });
  assert.equal(s.zeile("failure"), "sichtbar");
  assert.equal(s.hole("[data-failure-display]").text, "Cancelled");
  assert.equal(s.hole("[data-failure-display]").attribute["data-i18n"], "Cancelled");
  s.schicke({ status: "cancelled", failure_reason: "canceled" });
  assert.equal(s.hole("[data-failure-display]").text, "Cancelled");
});

test("widget-anruf K4: bei Fehlschlag wird das Ergebnis geholt und zeigt nur Nächster Schritt, bei Erfolg Fazit und Nächster Schritt", () => {
  const s = karte();
  s.schicke({ status: "failed", failure_reason: "no-answer" });
  assert.deepEqual(s.gesendet.map((p) => p.name), ["get_call_result"]);
  s.schicke({ result_summary: "Nobody answered.", objective_achieved: false, outcome: "Not reached", next_step: "Try again later." });
  assert.equal(s.zeile("next_step"), "sichtbar");
  assert.equal(s.zeile("outcome"), "versteckt");
  assert.equal(s.hole('[data-mcp="next_step"]').text, "Try again later.");
  const t = karte();
  t.schicke({ status: "completed" });
  t.schicke({ result_summary: "Booked.", objective_achieved: true, outcome: "Booked", next_step: "Add it to the calendar." });
  assert.equal(t.zeile("outcome"), "sichtbar");
  assert.equal(t.zeile("next_step"), "sichtbar");
  const u = karte();
  u.schicke({ status: "cancelled" });
  assert.deepEqual(u.gesendet.map((p) => p.name), []);
});

test("widget-anruf K8: call hat Version 38, die alten Pins bleiben", () => {
  const pins = widgetPins();
  assert.equal(Object.keys(pins.call).length, NEUE_VERSION);
  assert.match(pins.call[NEUE_VERSION], /^[0-9a-f]{64}$/);
  assert.equal(pins.call["35"].length, 64);
});
