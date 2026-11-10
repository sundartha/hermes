import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";

const chrome = findChrome();
const OPTIONS = { skip: chrome ? false : "kein Chromium gefunden (CHROME_BIN setzen)", timeout: 170000 };
const TEMPO_KURZ = 0.05;
const WEBM_KOPF = "1a45dfa3";

const laden = () => import("./widget-anruffolge-video.mjs");

const starte = (args) => new Promise((resolve) => {
  execFile(process.execPath, ["test/gemeinsam/widget-anruffolge-video.mjs", ...args], (fehler, stdout, stderr) => resolve({ code: fehler ? fehler.code : 0, stdout, stderr }));
});

test("Zeitliste rechnet Sekunden seit Serverstart in Sekunden seit Videobeginn um", async () => {
  const { zeitliste, versatzS } = await laden();
  assert.equal(versatzS(1000, 1250), 0.25);
  assert.equal(versatzS(1000, 900), -0.1);
  const roh = [{ art: "status", wert: "dialing", t_ms: 100 }, { art: "dauer", wert: "1:02", t_ms: 3045.4 }];
  assert.deepEqual(zeitliste(roh, 0.25), [{ art: "status", wert: "dialing", t_s: -0.15 }, { art: "dauer", wert: "1:02", t_s: 2.795 }]);
  assert.deepEqual(zeitliste([], 1), []);
});

test("Video nennt Uhr außerhalb der Karte, Versatz und Zeitliste; fehlendes ffmpeg ist ein Hinweis, kein Abbruch", OPTIONS, async () => {
  const { nimmVideo } = await laden();
  const { call } = await ausgelieferteWidgets();
  const ordner = mkdtempSync(join(tmpdir(), "anruffolge-video-test-"));
  const ergebnis = await nimmVideo(chrome, call, { szenario: "voll_de", tempo: TEMPO_KURZ, ordner, ffmpeg: null });
  assert.equal(ergebnis.video, "nicht aufgenommen, ffmpeg fehlt");
  assert.equal(ergebnis.szenario, "voll_de");
  assert.deepEqual(ergebnis.viewport, { breite_px: 420, hoehe_px: 690, pixeldichte: 2 });
  assert.match(ergebnis.uhr.text, /^\d+\.\d s voll_de$/);
  assert.equal(ergebnis.uhr.ausserhalb_karte, true);
  assert.equal(typeof ergebnis.versatz_videobeginn_zu_serverstart_s, "number");
  assert.ok(ergebnis.bilder > 0);
  const arten = ergebnis.zeitliste.map((eintrag) => eintrag.art);
  for (const art of ["karte_erste_anzeige", "status", "dauer", "ergebnis_beginn"]) assert.ok(arten.includes(art), art);
  const stati = ergebnis.zeitliste.filter((eintrag) => eintrag.art === "status").map((eintrag) => eintrag.wert);
  assert.deepEqual(stati, ["dialing", "in_progress", "completed"]);
  const zeiten = ergebnis.zeitliste.map((eintrag) => eintrag.t_s);
  assert.deepEqual(zeiten, [...zeiten].sort((a, b) => a - b));
  const beginn = ergebnis.zeitliste.find((eintrag) => eintrag.art === "ergebnis_beginn");
  const abgeschlossen = ergebnis.zeitliste.find((eintrag) => eintrag.art === "status" && eintrag.wert === "completed");
  assert.ok(beginn.t_s >= abgeschlossen.t_s);
});

test("mit ffmpeg entsteht eine webm-Datei im Ordner", OPTIONS, async (t) => {
  const { nimmVideo, findeFfmpeg } = await laden();
  const ffmpeg = findeFfmpeg();
  if (!ffmpeg) return t.skip("ffmpeg fehlt");
  const { call } = await ausgelieferteWidgets();
  const ordner = mkdtempSync(join(tmpdir(), "anruffolge-video-test-"));
  const ergebnis = await nimmVideo(chrome, call, { szenario: "voll_de", tempo: TEMPO_KURZ, ordner, ffmpeg });
  assert.equal(ergebnis.video, join(ordner, "voll_de.webm"));
  assert.ok(existsSync(ergebnis.video));
  assert.equal(readFileSync(ergebnis.video).subarray(0, 4).toString("hex"), WEBM_KOPF);
});

test("--hilfe des Video-Aufrufs nennt Aufruf, Uhr, Versatz und das fehlende ffmpeg", async () => {
  const { code, stdout } = await starte(["--hilfe"]);
  assert.equal(code, 0);
  assert.match(stdout, /node test\/gemeinsam\/widget-anruffolge-video\.mjs PFAD/);
  assert.match(stdout, /Sekunden seit Serverstart mit Zehntelsekunden/);
  assert.match(stdout, /Versatz Videobeginn zu Serverstart/);
  assert.match(stdout, /video: nicht aufgenommen, ffmpeg fehlt/);
});
