import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const ANRUF = (await ausgelieferteWidgets()).call;
const WIDGET_DICT = JSON.parse(skriptbloecke(ANRUF).find((code) => code.includes("HermesI18n = {")).match(/var WIDGET_DICT = (.*);\n/)[1]);
const ERGEBNIS = "ui/notifications/tool-result";

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

function karte(sprache) {
  const knoten_je_wahl = new Map();
  const hole = (sel) => {
    if (!knoten_je_wahl.has(sel)) knoten_je_wahl.set(sel, knoten());
    return knoten_je_wahl.get(sel);
  };
  hole(".w").className = "w";
  const hoerer = [];
  const woerter = WIDGET_DICT[sprache];
  const fenster = {
    document: { querySelector: hole },
    HermesI18n: { t: (schluessel) => woerter[schluessel] ?? schluessel, observe() {} },
    addEventListener: (art, f) => hoerer.push({ art, f }),
    parent: { postMessage() {} },
    __hermesUiReady: true,
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
  };
  fenster.window = fenster;
  vm.runInContext(skriptbloecke(ANRUF).filter((s) => s.includes("TOOL_GET_STATUS")).at(-1), vm.createContext(fenster));
  const schicke = (inhalt) => hoerer.filter((h) => h.art === "message").forEach((h) => h.f({ data: { method: ERGEBNIS, params: { structuredContent: { call_id: "c1", ...inhalt } } } }));
  const kopf = () => hole("[data-hud-phase]").text;
  return { schicke, kopf, hole };
}

test("widget-anruf-name-gegenstelle K3: mit Namen lautet der Kopf Hermes ruft Salon Mia an, am Ende Der Anruf bei Salon Mia ist erledigt", () => {
  const s = karte("de");
  s.schicke({ status: "dialing", recipient_name: "Salon Mia" });
  assert.equal(s.kopf(), "Hermes ruft Salon Mia an.");
  s.schicke({ status: "completed" });
  assert.equal(s.kopf(), "Der Anruf bei Salon Mia ist erledigt.");
});

test("widget-anruf-name-gegenstelle K3: ohne Namen bleibt der Kopf Hermes ruft an und Der Anruf ist erledigt", () => {
  const s = karte("de");
  s.schicke({ status: "dialing", recipient_name: null });
  assert.equal(s.kopf(), "Hermes ruft an.");
  assert.equal(s.hole("[data-hud-phase]").attribute["data-i18n"], "Hermes is calling.");
  s.schicke({ status: "completed" });
  assert.equal(s.kopf(), "Der Anruf ist erledigt.");
  const leer = karte("de");
  leer.schicke({ status: "dialing", recipient_name: "   " });
  assert.equal(leer.kopf(), "Hermes ruft an.");
});

test("widget-anruf-name-gegenstelle K3: der Name steht als Text und unverändert im Kopf", () => {
  const s = karte("de");
  s.schicke({ status: "dialing", recipient_name: "<b>Mia</b> $& $1" });
  assert.equal(s.kopf(), "Hermes ruft <b>Mia</b> $& $1 an.");
});

test("widget-anruf-name-gegenstelle K3: in den übrigen Zuständen und auf Französisch gilt der Name nur für Wählen und Ende", () => {
  const s = karte("fr");
  s.schicke({ status: "dialing", recipient_name: "Salon Mia" });
  assert.equal(s.kopf(), "Hermes appelle Salon Mia.");
  s.schicke({ status: "in_progress" });
  assert.equal(s.kopf(), WIDGET_DICT.fr["Hermes is on the call."]);
  s.schicke({ status: "completed" });
  assert.equal(s.kopf(), "L'appel à Salon Mia est terminé.");
  const nein = karte("de");
  nein.schicke({ status: "dialing", recipient_name: "Salon Mia" });
  nein.schicke({ status: "failed" });
  assert.equal(nein.kopf(), "Niemand hat abgenommen.");
  nein.schicke({ status: "cancelled" });
  assert.equal(nein.kopf(), "Du hast den Anruf");
});

test("widget-anruf-name-gegenstelle K3: kommt der Name erst nach dem Status, ändert sich der Kopf sofort, und der Name bleibt bei späteren Meldungen ohne Namen", () => {
  const s = karte("de");
  s.schicke({ status: "dialing" });
  assert.equal(s.kopf(), "Hermes ruft an.");
  s.schicke({ status: "dialing", recipient_name: " Salon Mia " });
  assert.equal(s.kopf(), "Hermes ruft Salon Mia an.");
  s.schicke({ status: "dialing", recipient_name: null });
  assert.equal(s.kopf(), "Hermes ruft Salon Mia an.");
});
