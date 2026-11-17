import assert from "node:assert/strict";
import { test } from "node:test";

import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";

const KARTE = (await ausgelieferteWidgets()).call;
const STILBLOECKE = [...KARTE.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)];
const CSS = STILBLOECKE.map((treffer) => treffer[1]).join("\n");

function paar(eintrag) {
  const trenner = eintrag.indexOf(":");
  return [eintrag.slice(0, trenner).trim(), eintrag.slice(trenner + 1).trim()];
}

function regelWerte(selektor) {
  const treffer = [...CSS.matchAll(new RegExp("(?:^|\\n)\\s*" + selektor.replace(/\./g, "\\.") + "\\{([^}]*)\\}", "g"))];
  assert.notEqual(treffer.length, 0, "Regel " + selektor + " fehlt");
  const eintraege = treffer.flatMap((m) => m[1].split(";").filter(Boolean));
  return Object.fromEntries(eintraege.map(paar));
}

function innerhalbInhalt() {
  const auf = KARTE.indexOf('<div class="inhalt"');
  assert.notEqual(auf, -1, "Inhaltsbereich fehlt");
  const zu = KARTE.indexOf('<div class="fuss">');
  assert.ok(zu > auf, "Fuss steht hinter dem Inhaltsbereich");
  return KARTE.slice(auf, zu);
}

test("widget-anrufkarte-hoehe: die Karte hat eine feste Obergrenze über der Mindesthöhe", () => {
  const karte = regelWerte(".w");
  assert.equal(karte["min-height"], "492px");
  assert.equal(karte["max-height"], "640px");
});

test("widget-anrufkarte-hoehe: der Inhaltsbereich schrumpft und scrollt intern", () => {
  const inhalt = regelWerte(".inhalt");
  assert.equal(inhalt["flex"], "1 1 auto");
  assert.equal(inhalt["min-height"], "0");
  assert.equal(inhalt["overflow-y"], "auto");
});

test("widget-anrufkarte-hoehe: das Blatt darf unter die Inhaltshöhe schrumpfen", () => {
  assert.equal(regelWerte(".w .sheet")["min-height"], "0");
});

test("widget-anrufkarte-hoehe: Live-Zeilen, Ergebnis, nächster Schritt und Grund liegen im scrollenden Bereich, der Abbrechen-Knopf nicht", () => {
  const bereich = innerhalbInhalt();
  for (const zeile of ["lines", "failure", "objective", "outcome", "summary", "next_step"]) {
    assert.ok(bereich.includes('data-row="' + zeile + '"'), zeile + " liegt im Inhaltsbereich");
  }
  assert.ok(!bereich.includes("data-cancel"), "Abbrechen scrollt nicht weg");
  assert.ok(KARTE.indexOf("data-cancel") > KARTE.indexOf('<div class="fuss">'));
});
