import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { bewerteChromeMetriken, bewerteTakt, messeAnruffolge, messeTimer, schneideFenster, wahreDauerS, zeigeSekunden } from "./widget-anruffolge-messen.mjs";
import { SZENARIEN } from "./widget-anruffolge-attrappe.mjs";

const SKIP = findChrome() ? false : "kein Chromium gefunden (CHROME_BIN setzen)";
const chrome = findChrome();
const OPTIONS = { skip: SKIP, timeout: 120000 };
const TEMPO_KURZ = 0.1;

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

test("Timer-Messung zählt auch das Einfrieren am Ende bis zur letzten Probe als Pause", () => {
  const eingefroren = [probe(0, 0), probe(1000, 1), probe(2000, 2), probe(102000, 2)];
  assert.equal(messeTimer(eingefroren).laengste_pause_ms, 100000);
  const stehend = [probe(0, 7), probe(5000, 7), probe(60000, 7)];
  assert.equal(messeTimer(stehend).laengste_pause_ms, 60000);
  assert.equal(messeTimer([probe(0, 7)]).laengste_pause_ms, 0);
});

test("nur Werte zwischen Abheben und Gesprächsende zählen zum Gesprächsfenster", () => {
  const roh = {
    fenster: { von: 100, bis: 200, von_sim_ms: 1000, bis_sim_ms: 2000 },
    rafs: [[50, 16], [120, 16], [150, 16], [199, 16], [230, 16], [110, 40]],
    zeichnungen: [90, 100, 150, 200, 210],
    proben: [{ sim_ms: 500, text: "0:00" }, { sim_ms: 1000, text: "0:01" }, { sim_ms: 2000, text: "0:02" }, { sim_ms: 2500, text: "0:02" }],
    langaufgaben: [[90, 80], [150, 60], [260, 70]],
  };
  const im = schneideFenster(roh);
  assert.deepEqual(im.rafs, [[120, 16], [150, 16], [199, 16]]);
  assert.deepEqual(im.zeichnungen, [100, 150, 200]);
  assert.deepEqual(im.proben.map((eintrag) => eintrag.sim_ms), [1000, 2000]);
  assert.deepEqual(im.langaufgaben, [[150, 60]]);
  const ungeoeffnet = { ...roh, fenster: { von: null, bis: null, von_sim_ms: null, bis_sim_ms: null } };
  assert.deepEqual(schneideFenster(ungeoeffnet), { rafs: [], zeichnungen: [], proben: [], langaufgaben: [] });
});

function zahl(wert, name) {
  assert.equal(typeof wert, "number", `${name} ist keine Zahl`);
  assert.ok(Number.isFinite(wert), `${name} ist nicht endlich`);
}

test("Messung der Anruffolge liefert Bildtakt, Flügel, Timer, Zeitliste, Chrome-Metriken und Trace", OPTIONS, async (kontext) => {
  const { call } = await ausgelieferteWidgets();
  const ordner = mkdtempSync(join(tmpdir(), "anruffolge-trace-"));
  const traceDatei = join(ordner, "trace.json.gz");
  const lauf = await messeAnruffolge(chrome, call, { szenario: "voll_de", tempo: TEMPO_KURZ, traceDatei });
  for (const [name, wert] of Object.entries({ n: lauf.bildtakt.n, fps: lauf.bildtakt.fps, median: lauf.bildtakt.median_ms, p95: lauf.bildtakt.p95_ms, max: lauf.bildtakt.max_ms, zeichnungen: lauf.fluegel.zeichnungen, fluegel_fps: lauf.fluegel.fps, lang: lauf.langaufgaben.summe_ms, shift: lauf.layout_shift, timer_n: lauf.timer.n, min: lauf.timer.abweichung_min_s, max_abw: lauf.timer.abweichung_max_s, mittel: lauf.timer.abweichung_mittel_s, pause: lauf.timer.laengste_pause_ms, layout: lauf.chrome.LayoutCount, style: lauf.chrome.RecalcStyleCount, script: lauf.chrome.ScriptDuration, task: lauf.chrome.TaskDuration })) zahl(wert, name);
  assert.ok(lauf.bildtakt.n > 0 && lauf.fluegel.zeichnungen > 0 && lauf.timer.n > 0, "Messfenster leer");
  const urteil = bewerteChromeMetriken(lauf.chrome, lauf.bildtakt);
  if (urteil.startsWith("Chrome liefert keine Metriken")) return kontext.skip(`${urteil}: ${JSON.stringify(lauf.chrome)}`);
  assert.equal(urteil, "ok", JSON.stringify(lauf.chrome));
  const spur = JSON.parse(gunzipSync(readFileSync(traceDatei)).toString());
  assert.ok(spur.traceEvents.length > 0, "Trace leer");
  assert.equal(lauf.fenster, "abgehoben bis Gesprächsende");
  assert.ok(lauf.fenster_sim_ms.von_sim_ms >= SZENARIEN.voll_de.waehlenS * 1000, "Fenster beginnt vor dem Abheben");
  assert.ok(lauf.fenster_sim_ms.bis_sim_ms > lauf.fenster_sim_ms.von_sim_ms, "Fenster leer");
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
