import test from "node:test";
import assert from "node:assert/strict";
import { renderPlanChoice, dismissPlanChoice } from "../apps/web/src/lib/subscribe.js";

function fakeDoc() {
  return { createElement: () => ({ dataset: {}, append() {} }) };
}

function fakeEls() {
  const tiles = {
    children: [],
    replaceChildren(...nodes) {
      this.children = nodes;
    },
  };
  return {
    title: { textContent: "" },
    subtitle: { textContent: "" },
    tiles,
    skip: { hidden: false },
    restore: { hidden: false },
  };
}

test("dismissPlanChoice: skip verschwindet, restore erscheint - kein Zustand ohne Bedienelement", () => {
  const els = fakeEls();
  dismissPlanChoice(els);
  assert.equal(els.skip.hidden, true);
  assert.equal(els.restore.hidden, false);
});

test("renderPlanChoice: skip erscheint, restore verschwindet - die beiden schliessen einander aus", () => {
  const els = fakeEls();
  renderPlanChoice(fakeDoc(), els);
  assert.equal(els.skip.hidden, false);
  assert.equal(els.restore.hidden, true);
});

test("Zyklus render -> dismiss -> render stellt Titel/Untertitel und Kacheln wieder her", () => {
  const els = fakeEls();

  renderPlanChoice(fakeDoc(), els);
  const titleAfterRender = els.title.textContent;
  const subtitleAfterRender = els.subtitle.textContent;
  const tileCountAfterRender = els.tiles.children.length;
  assert.ok(tileCountAfterRender > 0, "Plan-Kacheln wurden gerendert");

  dismissPlanChoice(els);
  assert.notEqual(els.title.textContent, titleAfterRender, "Banner-Titel ersetzt den Auswahl-Titel");
  assert.equal(els.tiles.children.length, 0, "Kacheln geleert");
  assert.equal(els.skip.hidden, true);
  assert.equal(els.restore.hidden, false);

  renderPlanChoice(fakeDoc(), els);
  assert.equal(els.title.textContent, titleAfterRender, "Auswahl-Titel wiederhergestellt");
  assert.equal(els.subtitle.textContent, subtitleAfterRender, "Auswahl-Untertitel wiederhergestellt");
  assert.equal(els.tiles.children.length, tileCountAfterRender, "Kacheln wiederhergestellt");
  assert.equal(els.skip.hidden, false);
  assert.equal(els.restore.hidden, true);
});
