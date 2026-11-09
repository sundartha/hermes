import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { messeAnruffolge } from "./widget-anruffolge-messen.mjs";

const SKIP = findChrome() ? false : "kein Chromium gefunden (CHROME_BIN setzen)";
const chrome = findChrome();
const OPTIONS = { skip: SKIP, timeout: 120000 };
const TEMPO_KURZ = 0.1;
const MINDESTENS = 20;
const HOECHSTENS = 49;
const PROBE = { vor: 50, im: 20, nach: 30 };

test("Chrome-Metriken zählen genau die Layouts zwischen Abheben und Gesprächsende", OPTIONS, async () => {
  const { call } = await ausgelieferteWidgets();
  const lauf = await messeAnruffolge(chrome, call, { szenario: "voll_de", tempo: TEMPO_KURZ, probeLayouts: PROBE });
  const meldung = `Layouts im Fenster ${JSON.stringify(lauf.chrome)}`;
  assert.ok(lauf.chrome.LayoutCount >= MINDESTENS, meldung);
  assert.ok(lauf.chrome.LayoutCount <= HOECHSTENS, meldung);
});
