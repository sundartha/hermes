import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { bewerteTakt, messeAnruffolge, messeTimer, wahreDauerS, zeigeSekunden } from "./widget-anruffolge-messen.mjs";
import { SZENARIEN } from "./widget-anruffolge-attrappe.mjs";

const SKIP = findChrome() ? false : "kein Chromium gefunden (CHROME_BIN setzen)";
const chrome = findChrome();
const OPTIONS = { skip: SKIP, timeout: 120000 };
const TEMPO_KURZ = 0.05;

test("Bildtakt nennt Anzahl, Bildrate, Median, p95, Maximum und Anteile über 20, 34 und 50 ms", () => {
  const abstaende = [16, 16, 16, 16, 16, 16, 16, 16, 40, 60];
  assert.deepEqual(bewerteTakt(abstaende), {
    n: 10,
    fps: 43.86,
    median_ms: 16,
    p95_ms: 60,
    max_ms: 60,
    ueber_20_ms: { anzahl: 2, anteil: 0.2 },
    ueber_34_ms: { anzahl: 2, anteil: 0.2 },
    ueber_50_ms: { anzahl: 1, anteil: 0.1 },
  });
  assert.deepEqual(bewerteTakt([]).ueber_50_ms, { anzahl: 0, anteil: 0 });
});

test("Timer-Anzeige wird als Minuten und Sekunden gelesen, alles andere zählt nicht", () => {
  assert.equal(zeigeSekunden("2:06"), 126);
  assert.equal(zeigeSekunden("0:00"), 0);
  assert.equal(zeigeSekunden("—"), null);
  assert.equal(zeigeSekunden(null), null);
});

test("wahre Dauer folgt der Server-Uhr samt Option und Ende des Gesprächs", () => {
  assert.equal(wahreDauerS(SZENARIEN.voll_de, 3500, "weiter"), 3.5);
  assert.equal(wahreDauerS(SZENARIEN.voll_de, 3500, "von-null"), 0);
  assert.equal(wahreDauerS(SZENARIEN.voll_de, 66000, "von-null"), 60);
  assert.equal(wahreDauerS(SZENARIEN.voll_de, 500000, "weiter"), 126);
});

function probe(simMs, anzeige) {
  return { sim_ms: simMs, wahr_s: simMs / 1000, anzeige_s: anzeige };
}

test("Timer-Messung nennt Abweichungen, Sprünge mit Zeitabstand und längste Pause", () => {
  const proben = [probe(0, 0), probe(500, 0), probe(1000, 1), probe(1500, 1), probe(2000, 2), probe(2500, 2), probe(3000, 2), probe(3500, 2), probe(4000, 5), probe(4500, 5)];
  assert.deepEqual(messeTimer(proben), {
    n: 10,
    abweichung_min_s: -1.5,
    abweichung_max_s: 1,
    abweichung_mittel_s: -0.25,
    spruenge: [{ bei_sim_ms: 4000, von_s: 2, nach_s: 5, abstand_ms: 2000 }],
    laengste_pause_ms: 2000,
  });
  assert.equal(messeTimer([probe(0, null), probe(100, null)]).abweichung_min_s, null);
  assert.deepEqual(messeTimer([probe(0, null), probe(100, null)]).spruenge, []);
});

function zahl(wert, name) {
  assert.equal(typeof wert, "number", `${name} ist keine Zahl`);
  assert.ok(Number.isFinite(wert), `${name} ist nicht endlich`);
}

test("Messung der Anruffolge liefert Bildtakt, Flügel, Timer, Zeitliste, Chrome-Metriken und Trace", OPTIONS, async () => {
  const { call } = await ausgelieferteWidgets();
  const lauf = await messeAnruffolge(chrome, call, { szenario: "voll_de", tempo: TEMPO_KURZ });
  for (const [name, wert] of Object.entries({ n: lauf.bildtakt.n, fps: lauf.bildtakt.fps, median: lauf.bildtakt.median_ms, p95: lauf.bildtakt.p95_ms, max: lauf.bildtakt.max_ms, zeichnungen: lauf.fluegel.zeichnungen, fluegel_fps: lauf.fluegel.fps, lang: lauf.langaufgaben.summe_ms, shift: lauf.layout_shift, timer_n: lauf.timer.n, min: lauf.timer.abweichung_min_s, max_abw: lauf.timer.abweichung_max_s, mittel: lauf.timer.abweichung_mittel_s, pause: lauf.timer.laengste_pause_ms, layout: lauf.chrome.LayoutCount, style: lauf.chrome.RecalcStyleCount, script: lauf.chrome.ScriptDuration, task: lauf.chrome.TaskDuration })) zahl(wert, name);
  assert.ok(lauf.bildtakt.n > 0 && lauf.fluegel.zeichnungen > 0 && lauf.timer.n > 0, "Messfenster leer");
  assert.ok(lauf.chrome.LayoutCount > 0 && lauf.chrome.TaskDuration > 0, "Chrome-Metriken leer");
  assert.ok(lauf.trace.bytes_gzip > 0, "Trace leer");
  assert.ok(lauf.timer.abweichung_min_s <= lauf.timer.abweichung_max_s, "Abweichungen widersprüchlich");
});

test("Zeitliste nennt erste Anzeige, Statuswechsel, Dauer-Änderungen und Beginn der Ergebnisanzeige in dieser Reihenfolge", OPTIONS, async () => {
  const { call } = await ausgelieferteWidgets();
  const { zeitliste } = await messeAnruffolge(chrome, call, { szenario: "voll_de", tempo: TEMPO_KURZ });
  const arten = zeitliste.map((eintrag) => eintrag.art);
  assert.ok(arten.includes("erste_anzeige"));
  assert.ok(arten.filter((art) => art === "status").length >= 3, "Statuswechsel fehlen");
  assert.ok(arten.filter((art) => art === "dauer").length >= 3, "Dauer-Änderungen fehlen");
  assert.equal(arten.filter((art) => art === "ergebnis_beginn").length, 1);
  assert.ok(arten.indexOf("erste_anzeige") < arten.indexOf("ergebnis_beginn"), "Ergebnis vor erster Anzeige");
  const zeiten = zeitliste.map((eintrag) => eintrag.ms);
  assert.deepEqual(zeiten, [...zeiten].sort((links, rechts) => links - rechts), "Zeitliste nicht aufsteigend");
  assert.ok(zeitliste.find((eintrag) => eintrag.art === "ergebnis_beginn").sim_ms >= SZENARIEN.voll_de.waehlenS * 1000);
});
