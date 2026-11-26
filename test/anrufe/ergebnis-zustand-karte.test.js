import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { ausgelieferteWidgets, skriptbloecke } from "../gemeinsam/ausgelieferte-widgets.js";

const KARTE = (await ausgelieferteWidgets()).call;
const SKRIPTE = skriptbloecke(KARTE);
const WOERTERBUCH_SKRIPT = SKRIPTE.find((code) => code.includes("HermesI18n = {"));
const KARTEN_SKRIPT = SKRIPTE.find((code) => code.includes("function init()"));
const WOERTERBUCH = JSON.parse(WOERTERBUCH_SKRIPT.match(/var WIDGET_DICT = (.*);\n/)[1]);
const PLATZHALTER = "(Noch keine Zusammenfassung verfuegbar - ggf. 5 Sekunden warten und erneut aufrufen.)";
const ZEILE = '[data-row="state"]';
const WERT = "[data-state-display]";

const TEXTE = {
  bestaetigt: {
    en: "Done, confirmed by the other side",
    de: "Erledigt, von der Gegenseite bestätigt",
    fr: "Effectué, confirmé par votre interlocuteur",
  },
  offen: {
    en: "Unconfirmed: nothing was confirmed",
    de: "Unbestätigt: Nichts wurde bestätigt",
    fr: "Non confirmé : rien n'a été confirmé",
  },
  nichtErledigt: { en: "Not done", de: "Nicht erledigt", fr: "Non effectué" },
  menue: {
    en: "Not done: only an automated menu was reached",
    de: "Nicht erledigt: nur eine Menü-Ansage erreicht",
    fr: "Non effectué : seul un menu vocal a été atteint",
  },
  mailbox: {
    en: "Not done: only a voicemail box was reached",
    de: "Nicht erledigt: nur eine Mailbox erreicht",
    fr: "Non effectué : seule une messagerie vocale a été atteinte",
  },
  niemand: {
    en: "Not done: nobody answered",
    de: "Nicht erledigt: niemand hat abgenommen",
    fr: "Non effectué : personne n'a répondu",
  },
  abgelehnt: {
    en: "Not done: the other side declined",
    de: "Nicht erledigt: die Gegenseite hat abgelehnt",
    fr: "Non effectué : votre interlocuteur a refusé",
  },
};

const FAELLE = {
  bestaetigt: { zustand: "done_confirmed", grund: null, text: TEXTE.bestaetigt },
  offen: { zustand: "unconfirmed", grund: null, text: TEXTE.offen },
  menue: { zustand: "not_done", grund: "menu-only", text: TEXTE.menue },
  mailbox: { zustand: "not_done", grund: "mailbox", text: TEXTE.mailbox },
  niemand: { zustand: "not_done", grund: "no-answer", text: TEXTE.niemand },
  abgelehnt: { zustand: "not_done", grund: "declined", text: TEXTE.abgelehnt },
  fremderGrund: { zustand: "not_done", grund: "neu", text: TEXTE.nichtErledigt },
  fehlschlagOhneAnnahme: { anruf: "failed", zustand: "not_done", grund: "no-answer", text: TEXTE.nichtErledigt },
  fehlschlagImMenue: { anruf: "failed", zustand: "not_done", grund: "menu-only", text: TEXTE.menue },
};

class Knoten {
  attribute = new Map();
  textContent = "";
  className = "";
  style = {};
  setAttribute(name, wert) {
    this.attribute.set(name, String(wert));
  }
  getAttribute(name) {
    return this.attribute.get(name) ?? null;
  }
  removeAttribute(name) {
    this.attribute.delete(name);
  }
  appendChild() {}
  removeChild() {}
  addEventListener() {}
}

function oeffneKarte(sprache, anruf) {
  const knoten = new Map();
  const hole = (wahl) => knoten.get(wahl) ?? knoten.set(wahl, new Knoten()).get(wahl);
  const empfaenger = [];
  const nichts = () => 1;
  const fenster = { __hermesUiReady: true, parent: { postMessage: nichts } };
  Object.assign(fenster, { window: fenster, setInterval: nichts, setTimeout: nichts, clearInterval: nichts, clearTimeout: nichts });
  fenster.addEventListener = (art, fn) => art === "message" && empfaenger.push(fn);
  fenster.dispatchEvent = nichts;
  fenster.CustomEvent = class {};
  fenster.document = {
    documentElement: { lang: "" },
    readyState: "complete",
    body: new Knoten(),
    querySelector: hole,
    querySelectorAll: () => [...knoten.values()].filter((el) => el.getAttribute("data-i18n") !== null),
    createElement: () => new Knoten(),
    addEventListener: nichts,
  };
  vm.createContext(fenster);
  vm.runInContext(WOERTERBUCH_SKRIPT, fenster);
  vm.runInContext(KARTEN_SKRIPT, fenster);
  const schiebe = (structuredContent) => {
    const params = { structuredContent: { call_id: "c1", ...structuredContent }, _meta: { "hermes/locale": sprache, "hermes/content_locale": sprache } };
    empfaenger.forEach((fn) => fn({ data: { method: "ui/notifications/tool-result", params } }));
  };
  schiebe({ status: anruf, duration_s: 5, last_transcript_lines: [], failure_reason: null });
  return {
    ergebnis: (daten) => schiebe({ result_summary: "Kurz.", objective_achieved: true, next_step: null, ...daten }),
    sichtbar: () => hole(ZEILE).style.display,
    text: () => hole(WERT).textContent,
    merkmal: () => hole(WERT).getAttribute("data-state"),
  };
}

for (const sprache of ["en", "de", "fr"]) {
  for (const [name, fall] of Object.entries(FAELLE)) {
    test(`Anrufkarte 4059 ${sprache}: ${name} zeigt Zustand und Grund`, () => {
      const karte = oeffneKarte(sprache, fall.anruf ?? "completed");
      karte.ergebnis({ result_state: fall.zustand, result_reason: fall.grund });
      assert.equal(karte.sichtbar(), "");
      assert.equal(karte.text(), fall.text[sprache]);
      assert.equal(karte.merkmal(), fall.zustand);
    });
  }
}

test("Anrufkarte 4059: waehrend die Auswertung aussteht, steht dort nicht unbestaetigt", () => {
  const karte = oeffneKarte("de", "completed");
  karte.ergebnis({ result_summary: "Kurz.", result_state: "done_confirmed", result_reason: null });
  karte.ergebnis({ result_summary: PLATZHALTER, objective_achieved: "unclear", result_state: "unconfirmed", result_reason: null });
  assert.equal(karte.sichtbar(), "none");
});

test("Anrufkarte 4059: ein feststehendes nicht erledigt erscheint auch vor der Auswertung", () => {
  const karte = oeffneKarte("de", "completed");
  karte.ergebnis({ result_summary: PLATZHALTER, objective_achieved: "unclear", result_state: "not_done", result_reason: "menu-only" });
  assert.equal(karte.sichtbar(), "");
  assert.equal(karte.text(), TEXTE.menue.de);
});

test("Anrufkarte 4059: ein unbekannter Zustand bleibt verborgen", () => {
  const karte = oeffneKarte("de", "completed");
  karte.ergebnis({ result_state: "neu", result_reason: null });
  assert.equal(karte.sichtbar(), "none");
  assert.equal(karte.merkmal(), null);
});

test("Anrufkarte 4059: eine Antwort ohne Zustand laesst den gezeigten Zustand stehen", () => {
  const karte = oeffneKarte("de", "completed");
  karte.ergebnis({ result_state: "done_confirmed", result_reason: null });
  karte.ergebnis({});
  assert.equal(karte.sichtbar(), "");
  assert.equal(karte.text(), TEXTE.bestaetigt.de);
});

const regel = (zustand) => new RegExp(`\\.zustand\\[data-state="${zustand}"\\]\\{([^}]*)\\}`).exec(KARTE)?.[1];

test("Anrufkarte 4059: die Zeile beginnt verborgen, ist beschriftet und unbestaetigt sieht anders aus als bestaetigt", () => {
  assert.match(
    KARTE,
    /data-row="state" style="display:none">\s*<span data-i18n="Status">Status<\/span><span class="zustand" data-state-display><\/span>/,
  );
  assert.deepEqual([WOERTERBUCH.de.Status, WOERTERBUCH.fr.Status], ["Status", "Statut"]);
  assert.match(regel("done_confirmed") ?? "", /background:var\(--fg\);color:var\(--bg\)/);
  assert.match(regel("unconfirmed") ?? "", /border-style:dashed/);
  assert.doesNotMatch(regel("unconfirmed") ?? "", /background/);
});
