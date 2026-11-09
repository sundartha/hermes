import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { messeAnruffolge } from "./widget-anruffolge-messen.mjs";

const SKIP = findChrome() ? false : "kein Chromium gefunden (CHROME_BIN setzen)";
const chrome = findChrome();
const NATUERLICH = 20;
const MIT_PROBE = 4;
const GLEICHZEITIG = 4;
const TEMPO_KURZ = 0.1;
const LAST_JE_KERN = 2;
const GRENZE_MS = 900000;
const MINDESTENS = 20;
const HOECHSTENS = 49;
const PROBE = { vor: 50, im: 20, nach: 30 };

function belaste() {
  const schleifen = Array.from({ length: cpus().length * LAST_JE_KERN }, () => spawn(process.execPath, ["-e", "for(;;);"], { stdio: "ignore" }));
  return () => schleifen.forEach((kind) => kind.kill("SIGKILL"));
}

async function messeUnterLast(call, anzahl, probeLayouts) {
  const entlaste = belaste();
  try {
    const laeufe = [];
    for (let rest = anzahl; rest > 0; rest -= GLEICHZEITIG) {
      const gruppe = Array.from({ length: Math.min(GLEICHZEITIG, rest) }, () => messeAnruffolge(chrome, call, { szenario: "voll_de", tempo: TEMPO_KURZ, probeLayouts }));
      laeufe.push(...(await Promise.all(gruppe)));
    }
    return laeufe;
  } finally {
    entlaste();
  }
}

test("Chrome-Metriken des Gesprächsfensters bleiben in 20 von 20 Läufen unter CPU-Last positiv", { skip: SKIP, timeout: GRENZE_MS }, async () => {
  const { call } = await ausgelieferteWidgets();
  const laeufe = await messeUnterLast(call, NATUERLICH, null);
  assert.equal(laeufe.length, NATUERLICH);
  const leer = laeufe.filter((lauf) => !(lauf.chrome.LayoutCount === 1 && lauf.chrome.TaskDuration > 0)).map((lauf) => JSON.stringify(lauf.chrome));
  assert.deepEqual(leer, [], "Chrome-Metriken leer");
});

test("Das Gesprächsfenster zählt unter CPU-Last in jedem Lauf genau die Layouts zwischen Abheben und Gesprächsende", { skip: SKIP, timeout: GRENZE_MS }, async () => {
  const { call } = await ausgelieferteWidgets();
  const laeufe = await messeUnterLast(call, MIT_PROBE, PROBE);
  assert.equal(laeufe.length, MIT_PROBE);
  const daneben = laeufe.filter((lauf) => !(lauf.chrome.LayoutCount >= MINDESTENS && lauf.chrome.LayoutCount <= HOECHSTENS)).map((lauf) => JSON.stringify(lauf.chrome));
  assert.deepEqual(daneben, [], "Layouts im Fenster außerhalb von 20 bis 49");
});
