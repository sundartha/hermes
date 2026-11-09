import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { messeAnruffolge } from "./widget-anruffolge-messen.mjs";

const SKIP = findChrome() ? false : "kein Chromium gefunden (CHROME_BIN setzen)";
const chrome = findChrome();
const TEMPO_KURZ = 0.1;
const LADE_EREIGNISSE = ["navigationStart", "ResourceSendRequest", "ResourceReceiveResponse", "ParseHTML", "CommitLoad"];
const TOLERANZ_STILBERECHNUNGEN = 2;

test("Chrome-Metriken und Trace der Anruffolge beginnen erst beim Abheben, nicht mit dem Laden der Seite", { skip: SKIP, timeout: 120000 }, async () => {
  const { call } = await ausgelieferteWidgets();
  const traceDatei = join(mkdtempSync(join(tmpdir(), "anruffolge-fenster-")), "trace.json.gz");
  const lauf = await messeAnruffolge(chrome, call, { szenario: "voll_de", tempo: TEMPO_KURZ, traceDatei });
  const ereignisse = JSON.parse(gunzipSync(readFileSync(traceDatei)).toString()).traceEvents;
  const ladeEreignisse = ereignisse.filter((ereignis) => LADE_EREIGNISSE.includes(ereignis.name));
  assert.deepEqual(ladeEreignisse.map((ereignis) => ereignis.name), [], "Trace enthält Ereignisse der Ladephase");
  const stilImTrace = ereignisse.filter((ereignis) => ereignis.name === "UpdateLayoutTree").length;
  assert.ok(stilImTrace > 0, "Trace ohne Stilberechnungen im Gesprächsfenster");
  const abstand = Math.abs(lauf.chrome.RecalcStyleCount - stilImTrace);
  assert.ok(abstand <= TOLERANZ_STILBERECHNUNGEN, `Metrik-Differenz (${lauf.chrome.RecalcStyleCount}) enthält mehr als das Gesprächsfenster (Trace: ${stilImTrace})`);
});
