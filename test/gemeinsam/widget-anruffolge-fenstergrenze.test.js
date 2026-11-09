import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { messeAnruffolge } from "./widget-anruffolge-messen.mjs";
import { SZENARIEN } from "./widget-anruffolge-attrappe.mjs";

const SKIP = findChrome() ? false : "kein Chromium gefunden (CHROME_BIN setzen)";
const chrome = findChrome();
const OPTIONS = { skip: SKIP, timeout: 120000 };
const TEMPO_KURZ = 0.1;
const MS = 1000;
const LADE_EREIGNISSE = ["navigationStart", "ResourceSendRequest", "ResourceReceiveResponse", "ParseHTML", "CommitLoad"];
const LAYOUTS_VOR_ABHEBEN = 200;
const PROBE_VOR_ABHEBEN = { vor: LAYOUTS_VOR_ABHEBEN, im: 0, nach: 0 };

async function messeMitTrace(optionen) {
  const { call } = await ausgelieferteWidgets();
  const traceDatei = join(mkdtempSync(join(tmpdir(), "anruffolge-fenster-")), "trace.json.gz");
  const lauf = await messeAnruffolge(chrome, call, { tempo: TEMPO_KURZ, ...optionen, traceDatei });
  const ereignisse = JSON.parse(gunzipSync(readFileSync(traceDatei)).toString()).traceEvents;
  return { lauf, ereignisse };
}

test("Trace der Anruffolge enthält keine Ereignisse der Ladephase", OPTIONS, async () => {
  const { ereignisse } = await messeMitTrace({ szenario: "voll_de" });
  const lade = ereignisse.filter((ereignis) => LADE_EREIGNISSE.includes(ereignis.name));
  assert.deepEqual(lade.map((ereignis) => ereignis.name), []);
});

test("Trace der Anruffolge enthält Stilberechnungen im Gesprächsfenster", OPTIONS, async () => {
  const { ereignisse } = await messeMitTrace({ szenario: "voll_de" });
  assert.ok(ereignisse.filter((ereignis) => ereignis.name === "UpdateLayoutTree").length > 0);
});

test("Trace der Anruffolge enthält die Layouts vor dem Abheben nicht", OPTIONS, async () => {
  const { ereignisse } = await messeMitTrace({ szenario: "voll_de", probeLayouts: PROBE_VOR_ABHEBEN });
  const layouts = ereignisse.filter((ereignis) => ereignis.name === "Layout").length;
  assert.ok(layouts < LAYOUTS_VOR_ABHEBEN, `Layouts im Trace ${layouts}`);
});

test("Gesprächsfenster der Anruffolge beginnt nach dem Abheben auf der Sim-Uhr", OPTIONS, async () => {
  const { lauf } = await messeMitTrace({ szenario: "voll_de" });
  const { waehlenS, gespraechS } = SZENARIEN.voll_de;
  const { von_sim_ms: von, bis_sim_ms: bis } = lauf.fenster_sim_ms;
  assert.ok(von >= waehlenS * MS, `von_sim_ms ${von}`);
  assert.ok(bis >= (waehlenS + gespraechS) * MS, `von_sim_ms ${von} bis_sim_ms ${bis}`);
});

test("Anruffolge ohne Abheben hat kein Fenster, keine Metriken und keinen Trace", OPTIONS, async () => {
  const { lauf, ereignisse } = await messeMitTrace({ szenario: "fehler_de" });
  assert.deepEqual(lauf.chrome, { LayoutCount: 0, RecalcStyleCount: 0, ScriptDuration: 0, TaskDuration: 0 });
  assert.deepEqual(ereignisse, []);
  assert.deepEqual(lauf.fenster_sim_ms, { von_sim_ms: null, bis_sim_ms: null });
});
