import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { messeWidget } from "./widget-ladezeit-messen.mjs";

const WIDGETS = ["call", "my-number", "calls", "agent-status"];
const WING_URI_LENGTH_MAX = 20000;
const SKIP = findChrome() ? false : "kein Chromium gefunden (CHROME_BIN setzen)";
const chrome = findChrome();
const OPTIONS = { skip: SKIP, timeout: 300000 };
const LAEUFE = 3;
const MESSWERTE = ["erste_zeichnung_ms", "fluegel_sichtbar_ms", "status_nach_push_ms", "bytes_roh", "bytes_gzip"];

function median(zahlen) {
  return [...zahlen].sort((a, b) => a - b)[Math.floor(zahlen.length / 2)];
}

async function medianErsteZeichnung(widget, gedrosselt) {
  const zeiten = [];
  for (let lauf = 0; lauf < LAEUFE; lauf += 1) {
    zeiten.push((await messeWidget(chrome, widget, { gedrosselt })).erste_zeichnung_ms);
  }
  return median(zeiten);
}

function assertMessung(messung, id) {
  for (const key of MESSWERTE) {
    assert.ok(Number.isFinite(messung[key]) && messung[key] > 0, `${id} ${messung.gedrosselt ? "gedrosselt" : "frei"}: ${key} fehlt`);
  }
  assert.ok(messung.bytes_gzip < messung.bytes_roh, `${id}: gzip nicht kleiner als roh`);
}

test("Ladezeitmessung liefert für jedes ausgelieferte Widget ungedrosselt und gedrosselt alle Zahlen", OPTIONS, async () => {
  const widgets = await ausgelieferteWidgets();
  assert.deepEqual(Object.keys(widgets).sort(), [...WIDGETS].sort());
  for (const id of WIDGETS) {
    const frei = await messeWidget(chrome, widgets[id], { gedrosselt: false });
    const gedrosselt = await messeWidget(chrome, widgets[id], { gedrosselt: true });
    assertMessung(frei, id);
    assertMessung(gedrosselt, id);
    const freiMedian = await medianErsteZeichnung(widgets[id], false);
    const gedrosseltMedian = await medianErsteZeichnung(widgets[id], true);
    assert.ok(gedrosseltMedian > freiMedian, `${id}: Drosselung ändert die erste Zeichnung nicht (Median ${gedrosseltMedian} gegen ${freiMedian})`);
  }
});

test("Ladezeitmessung nennt den Flügel als ein einziges Bild des ausgelieferten Widgets", OPTIONS, async () => {
  const widgets = await ausgelieferteWidgets();
  for (const id of WIDGETS) {
    const { bilder } = await messeWidget(chrome, widgets[id], { gedrosselt: false });
    assert.equal(bilder.anzahl, 1, `${id}: Anzahl Bilder`);
    assert.deepEqual(bilder.formate, ["png"]);
    assert.equal(bilder.groessen_uri.length, 1, `${id}: Anzahl Bildgrößen`);
    assert.ok(bilder.groessen_uri[0] > 0 && bilder.groessen_uri[0] <= WING_URI_LENGTH_MAX, `${id}: Flügel ${bilder.groessen_uri[0]} B`);
  }
});
