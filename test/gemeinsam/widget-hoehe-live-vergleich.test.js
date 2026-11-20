import assert from "node:assert/strict";
import { test } from "node:test";

import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";

const chrome = findChrome();
const OPTIONS = { skip: chrome ? false : "kein Chromium gefunden (CHROME_BIN setzen)", timeout: 300000 };
const KARTE_MAX_PX = 760;
const KURZE_ZEILEN = 2;
const LANGE_ZEILEN = 60;
const SATZ = "Bitte die unterschriebene Vollmacht zusammen mit dem Nachweis der Bankverbindung und der letzten drei Abrechnungen bis Freitag einreichen. ";

const livezeilen = (anzahl) => Array.from({ length: anzahl }, (_, i) => `${i % 2 ? "Gegenüber" : "Agent"}: ${SATZ}`);

test("Anrufkarte mit zwei Live-Zeilen ist kürzer als mit sechzig, die mit sechzig erreicht höchstens die Obergrenze", OPTIONS, async () => {
  const { messeKarteLive } = await import("./widget-hoehe-messen.mjs");
  const { call } = await ausgelieferteWidgets();
  const kurz = await messeKarteLive(chrome, call, livezeilen(KURZE_ZEILEN));
  const lang = await messeKarteLive(chrome, call, livezeilen(LANGE_ZEILEN));
  assert.equal(kurz.zeilen, KURZE_ZEILEN);
  assert.equal(lang.zeilen, LANGE_ZEILEN);
  assert.ok(kurz.karte_px < KARTE_MAX_PX, `kurz ${kurz.karte_px} px`);
  assert.ok(kurz.karte_px < lang.karte_px, `kurz ${kurz.karte_px} px, lang ${lang.karte_px} px`);
  assert.ok(lang.karte_px <= KARTE_MAX_PX, `lang ${lang.karte_px} px`);
});
