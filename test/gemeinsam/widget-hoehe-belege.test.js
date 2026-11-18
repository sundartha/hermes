import assert from "node:assert/strict";
import { test } from "node:test";

import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { SZENARIEN } from "./widget-anruffolge-attrappe.mjs";
import { findChrome } from "./widget-im-rahmen.js";

const chrome = findChrome();
const OPTIONS = { skip: chrome ? false : "kein Chromium gefunden (CHROME_BIN setzen)", timeout: 300000 };
const KARTE_MAX_PX = 760;
const LISTE_MAX_PX = 480;
const ANRUFE = 20;
const SCHRITTE_FUENF = 5;
const LANGE_ZEILEN = 60;
const KARTE_REGEL = /\.w\{min-height:492px;max-height:\d+px\}/;
const LISTE_REGEL = /max-height:480px;overflow-y:auto/;
const ZEILEN_KOPF = '<div class="zeile lines" data-row="lines"';
const SATZ = "Bitte die unterschriebene Vollmacht zusammen mit dem Nachweis der Bankverbindung und der letzten drei Abrechnungen bis Freitag einreichen. ";

const laden = () => import("./widget-hoehe-messen.mjs");

const ohneObergrenze = (html, regel, ersatz) => {
  assert.match(html, regel);
  return html.replace(regel, ersatz);
};

const mitSchritten = (html, anzahl) => {
  assert.ok(html.includes(ZEILEN_KOPF));
  const schritte = Array.from({ length: anzahl }, (_, i) => `<div class="zeile" data-schritt="${i}"><span>${SATZ.repeat(2)}</span></div>`).join("");
  return html.replace(ZEILEN_KOPF, () => schritte + ZEILEN_KOPF);
};

const mitSchrittText = (name, nextStep) => ({ ...SZENARIEN[name], ergebnis: { ...SZENARIEN[name].ergebnis, next_step: nextStep } });

const livezeilen = () => Array.from({ length: LANGE_ZEILEN }, (_, i) => `${i % 2 ? "Gegenüber" : "Agent"}: ${SATZ}`);

const anrufliste = () => Array.from({ length: ANRUFE }, (_, i) => ({
  direction: i % 2 ? "inbound" : "outbound",
  counterparty: `+49 30 5550${String(i).padStart(4, "0")}`,
  status: "completed",
  startedAt: `2026-11-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
  summary: `Anruf ${i + 1}: ${SATZ}`,
}));

test("Anrufkarte ohne Nächsten Schritt und mit einem bleibt unter der Obergrenze", OPTIONS, async () => {
  const { messeKarteEnde } = await laden();
  const { call } = await ausgelieferteWidgets();
  const keiner = await messeKarteEnde(chrome, call, mitSchrittText("voll_de", ""));
  const einer = await messeKarteEnde(chrome, call, "voll_de");
  assert.ok(keiner.karte_px >= 492 && keiner.karte_px <= einer.karte_px, `0 Schritte ${keiner.karte_px} px, 1 Schritt ${einer.karte_px} px`);
  assert.ok(einer.karte_px < KARTE_MAX_PX);
});

test("Anrufkarte mit fünf langen Nächsten Schritten wird genau so hoch wie die Obergrenze und scrollt intern", OPTIONS, async () => {
  const { messeKarteEnde } = await laden();
  const { call } = await ausgelieferteWidgets();
  const gemessen = await messeKarteEnde(chrome, mitSchritten(call, SCHRITTE_FUENF), "voll_de");
  assert.equal(gemessen.karte_px, KARTE_MAX_PX);
  assert.ok(gemessen.inhalt_scroll_px > gemessen.inhalt_sichtbar_px, `scrollt: ${gemessen.inhalt_scroll_px} > ${gemessen.inhalt_sichtbar_px}`);
});

test("Rotprobe: ohne Obergrenze wächst die Anrufkarte mit fünf langen Nächsten Schritten über 760 px", OPTIONS, async () => {
  const { messeKarteEnde } = await laden();
  const { call } = await ausgelieferteWidgets();
  const offen = ohneObergrenze(mitSchritten(call, SCHRITTE_FUENF), KARTE_REGEL, ".w{min-height:492px}");
  const gemessen = await messeKarteEnde(chrome, offen, "voll_de");
  assert.ok(gemessen.karte_px > KARTE_MAX_PX, `ohne Grenze ${gemessen.karte_px} px`);
});

test("Anrufkarte mit langem laufendem Transkript wird genau so hoch wie die Obergrenze und scrollt intern", OPTIONS, async () => {
  const { messeKarteLive } = await laden();
  const { call } = await ausgelieferteWidgets();
  const gemessen = await messeKarteLive(chrome, call, livezeilen());
  assert.equal(gemessen.zeilen, LANGE_ZEILEN);
  assert.equal(gemessen.karte_px, KARTE_MAX_PX);
  assert.ok(gemessen.inhalt_scroll_px > gemessen.inhalt_sichtbar_px);
});

test("Anrufkarte mit zwei Live-Zeilen bleibt kürzer als mit sechzig und beide überschreiten die Obergrenze nicht", OPTIONS, async () => {
  const { messeKarteLive } = await laden();
  const { call } = await ausgelieferteWidgets();
  const kurz = await messeKarteLive(chrome, call, livezeilen().slice(0, 2));
  assert.equal(kurz.zeilen, 2);
  assert.ok(kurz.karte_px < KARTE_MAX_PX);
});

test("Rotprobe: ohne Obergrenze wächst die Anrufkarte mit sechzig Live-Zeilen über 760 px", OPTIONS, async () => {
  const { messeKarteLive } = await laden();
  const { call } = await ausgelieferteWidgets();
  const offen = ohneObergrenze(call, KARTE_REGEL, ".w{min-height:492px}");
  const gemessen = await messeKarteLive(chrome, offen, livezeilen());
  assert.ok(gemessen.karte_px > KARTE_MAX_PX, `ohne Grenze ${gemessen.karte_px} px`);
});

test("Anrufliste mit 20 Anrufen wird genau so hoch wie die Obergrenze und scrollt intern", OPTIONS, async () => {
  const { messeListe } = await laden();
  const { calls } = await ausgelieferteWidgets();
  const gemessen = await messeListe(chrome, calls, anrufliste());
  assert.equal(gemessen.eintraege, ANRUFE);
  assert.equal(gemessen.liste_px, LISTE_MAX_PX);
  assert.equal(gemessen.overflow_y, "auto");
  assert.ok(gemessen.liste_scroll_px > LISTE_MAX_PX, `Inhalt ${gemessen.liste_scroll_px} px`);
});

test("Rotprobe: ohne Obergrenze wächst die Anrufliste mit 20 Anrufen über 480 px", OPTIONS, async () => {
  const { messeListe } = await laden();
  const { calls } = await ausgelieferteWidgets();
  const offen = ohneObergrenze(calls, LISTE_REGEL, "overflow-y:visible");
  const gemessen = await messeListe(chrome, offen, anrufliste());
  assert.ok(gemessen.liste_px > LISTE_MAX_PX, `ohne Grenze ${gemessen.liste_px} px`);
});
