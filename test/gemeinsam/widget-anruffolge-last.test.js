import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { messeAnruffolge } from "./widget-anruffolge-messen.mjs";

const SKIP = findChrome() ? false : "kein Chromium gefunden (CHROME_BIN setzen)";
const chrome = findChrome();
const WIEDERHOLUNGEN = 20;
const GLEICHZEITIG = 4;
const TEMPO_KURZ = 0.1;
const LAST_JE_KERN = 2;
const GRENZE_MS = 600000;

function belaste() {
  const schleifen = Array.from({ length: cpus().length * LAST_JE_KERN }, () => spawn(process.execPath, ["-e", "for(;;);"], { stdio: "ignore" }));
  return () => schleifen.forEach((kind) => kind.kill("SIGKILL"));
}

test("Chrome-Metriken des Gesprächsfensters bleiben in 20 von 20 Läufen unter CPU-Last positiv", { skip: SKIP, timeout: GRENZE_MS }, async () => {
  const { call } = await ausgelieferteWidgets();
  const entlaste = belaste();
  try {
    const laeufe = [];
    for (let rest = WIEDERHOLUNGEN; rest > 0; rest -= GLEICHZEITIG) {
      const gruppe = Array.from({ length: Math.min(GLEICHZEITIG, rest) }, () => messeAnruffolge(chrome, call, { szenario: "voll_de", tempo: TEMPO_KURZ }));
      laeufe.push(...(await Promise.all(gruppe)));
    }
    assert.equal(laeufe.length, WIEDERHOLUNGEN);
    const leer = laeufe.filter((lauf) => !(lauf.chrome.LayoutCount > 0 && lauf.chrome.TaskDuration > 0)).map((lauf) => JSON.stringify(lauf.chrome));
    assert.deepEqual(leer, [], "Chrome-Metriken leer");
  } finally {
    entlaste();
  }
});
