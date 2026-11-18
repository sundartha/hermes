import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { ausgelieferteWidgets, skriptbloecke } from "./ausgelieferte-widgets.js";

const LISTE = (await ausgelieferteWidgets()).calls;
const WOERTERBUCH = JSON.parse(/var WIDGET_DICT = (\{.*\});\n/.exec(LISTE)[1]);
const ERGEBNIS = "ui/notifications/tool-result";

function knoten() {
  return {
    text: "",
    attribute: {},
    setAttribute(name, wert) {
      this.attribute[name] = wert;
    },
    get textContent() {
      return this.text;
    },
    set textContent(wert) {
      this.text = wert;
    },
  };
}

function ueberschrift(sprache, anzahl) {
  const [vor, zahl, nach] = [knoten(), knoten(), knoten()];
  const hoerer = [];
  const dokument = {
    documentElement: knoten(),
    querySelector: (sel) => ({ '[data-kopf="vor"]': vor, '[data-kopf="zahl"]': zahl, '[data-kopf="nach"]': nach })[sel] ?? null,
  };
  class MutationObserver {
    observe() {}
  }
  const fenster = {
    HermesI18n: { t: (key) => (sprache === "en" ? key : (WOERTERBUCH[sprache]?.[key] ?? key)) },
    addEventListener: (art, f) => hoerer.push({ art, f }),
  };
  const kontext = vm.createContext({ document: dokument, MutationObserver, window: fenster });
  for (const code of skriptbloecke(LISTE).filter((s) => s.includes("data-kopf"))) vm.runInContext(code, kontext);
  const calls = Array.from({ length: anzahl }, () => ({}));
  hoerer.find((h) => h.art === "message").f({ data: { method: ERGEBNIS, params: { structuredContent: { calls } } } });
  return [vor.text, zahl.text, nach.text].join(" ");
}

const DE = ["einen", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf"];
const FR = ["un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze"];

test("widget-anrufliste K4: de nennt die Anzahl von 1 bis 12 als Zahlwort, ab 13 die Ziffer", () => {
  DE.forEach((wort, i) => {
    const n = i + 1;
    assert.equal(ueberschrift("de", n), "Hermes hat zuletzt " + wort + (n === 1 ? " Anruf" : " Anrufe") + " geführt.");
  });
  assert.equal(ueberschrift("de", 13), "Hermes hat zuletzt 13 Anrufe geführt.");
  assert.equal(ueberschrift("de", 40), "Hermes hat zuletzt 40 Anrufe geführt.");
});

test("widget-anrufliste K4: fr nennt die Anzahl von 1 bis 12 als Zahlwort, ab 13 die Ziffer", () => {
  FR.forEach((wort, i) => {
    const n = i + 1;
    assert.equal(ueberschrift("fr", n), "Hermes a traité " + wort + (n === 1 ? " appel" : " appels") + " récemment.");
  });
  assert.equal(ueberschrift("fr", 13), "Hermes a traité 13 appels récemment.");
});

test("widget-anrufliste K4: andere Sprachen behalten die Ziffer", () => {
  assert.equal(ueberschrift("en", 3), "Hermes handled 3 calls recently.");
  assert.equal(ueberschrift("en", 1), "Hermes handled 1 call recently.");
  assert.equal(ueberschrift("es", 3), "Hermes handled 3 calls recently.");
});

test("widget-anrufliste K4: ohne Anrufe bleibt der Satz ohne Zahl", () => {
  assert.equal(ueberschrift("de", 0), "Hermes hat noch keine Anrufe geführt.");
});
