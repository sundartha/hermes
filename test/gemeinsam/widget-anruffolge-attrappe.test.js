import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { SZENARIEN, spieleAnruffolge, sprachHinweis, statusZu } from "./widget-anruffolge-attrappe.mjs";

const SKIP = findChrome() ? false : "kein Chromium gefunden (CHROME_BIN setzen)";
const chrome = findChrome();
const OPTIONS = { skip: SKIP, timeout: 120000 };
const TEMPO_KURZ = 0.05;
const TEMPO_MITTE = 0.1;
const STAPEL = 4;
const REPLY_DELAY_MS = 60;
const FRIST_TOLERANZ_MS = 5;

function status(name, simS, uhr = "weiter") {
  const { status: s, duration_s: d, failure_reason: f } = statusZu(SZENARIEN[name], simS * 1000, uhr);
  return [s, d, f];
}

test("Server-Uhr der Attrappe zählt ganze Sekunden seit Anrufstart und stoppt beim Ende", () => {
  assert.deepEqual(status("voll_de", 0), ["dialing", 0, null]);
  assert.deepEqual(status("voll_de", 5.4), ["dialing", 5, null]);
  assert.deepEqual(status("voll_de", 6), ["in_progress", 6, null]);
  assert.deepEqual(status("voll_de", 60.4), ["in_progress", 60, null]);
  assert.deepEqual(status("voll_de", 126), ["completed", 126, null]);
  assert.deepEqual(status("voll_de", 500), ["completed", 126, null]);
  assert.deepEqual(status("fehler_de", 3), ["dialing", 3, null]);
  assert.deepEqual(status("fehler_de", 40), ["failed", 6, "no_answer"]);
});

test("Server-Uhr der Attrappe zählt mit der Option erst ab dem Abheben", () => {
  assert.deepEqual(status("voll_de", 5, "von-null"), ["dialing", 0, null]);
  assert.deepEqual(status("voll_de", 6, "von-null"), ["in_progress", 0, null]);
  assert.deepEqual(status("voll_de", 66, "von-null"), ["in_progress", 60, null]);
  assert.deepEqual(status("voll_de", 500, "von-null"), ["completed", 120, null]);
  assert.deepEqual(status("fehler_de", 40, "von-null"), ["failed", 0, "no_answer"]);
});

test("Szenarien nennen Sprache, Breite und Rückfallsprache der Karte", () => {
  const tabelle = Object.entries(SZENARIEN).map(([name, s]) => [name, s.locale, s.inhaltssprache, s.erwartet, s.breite]);
  assert.deepEqual(tabelle, [
    ["voll_de", "de", "de", "de", 420],
    ["nicht_erreicht_en", "en", "en", "en", 420],
    ["unklar_fr", "fr", "fr", "fr", 420],
    ["fehler_de", "de", "de", "de", 420],
    ["lang_de_320", "de", "de", "de", 320],
    ["lang_fr_420", "fr", "fr", "fr", 420],
    ["ohne_woerterbuch_es", "es", "es", "en", 420],
    ["mismatch_de_en", "de", "en", "en", 420],
  ]);
  assert.match(sprachHinweis(SZENARIEN.ohne_woerterbuch_es).hinweis, /es ohne Wörterbuch.*auf en zurück/);
  assert.match(sprachHinweis(SZENARIEN.mismatch_de_en).hinweis, /en passt nicht zur Locale de.*auf en zurück/);
  assert.match(sprachHinweis(SZENARIEN.voll_de).hinweis, /^Karte in de$/);
});

function vonHost(lauf) {
  return lauf.protokoll.filter((eintrag) => eintrag.von === "host");
}

function vonKarte(lauf) {
  return lauf.protokoll.filter((eintrag) => eintrag.von === "karte");
}

function assertProtokoll(lauf, name) {
  const host = vonHost(lauf);
  const karte = vonKarte(lauf);
  assert.equal(karte[0].methode, "ui/initialize", `${name}: erste Nachricht der Karte`);
  const pushes = host.filter((eintrag) => eintrag.methode === "ui/notifications/tool-result");
  assert.equal(pushes.length, 1, `${name}: genau ein tool-result vom Host`);
  assert.deepEqual(pushes[0].inhalt, { status: "dialing", duration_s: 0 }, `${name}: erster Push`);
  assert.deepEqual(pushes[0].meta, { "hermes/content_locale": SZENARIEN[name].inhaltssprache }, `${name}: Inhaltssprache im ersten Push`);
  const push = host.indexOf(pushes[0]);
  assert.equal(host[push - 1].methode, "ui/notifications/host-context-changed", `${name}: Locale vor dem Push`);
  const reihenfolge = lauf.protokoll.map((eintrag) => `${eintrag.von}:${eintrag.methode}`);
  assert.ok(reihenfolge.indexOf("karte:ui/notifications/initialized") < reihenfolge.indexOf("host:ui/notifications/host-context-changed"), `${name}: Locale erst nach initialized`);
  assert.deepEqual(host.filter((eintrag) => eintrag.methode.startsWith("ui/")).map((eintrag) => eintrag.methode), ["ui/notifications/host-context-changed", "ui/notifications/tool-result"], `${name}: kein weiterer Push`);
}

function assertAntworten(lauf, name) {
  const anfragen = vonKarte(lauf).filter((eintrag) => eintrag.methode === "tools/call");
  assert.ok(anfragen.length >= 1, `${name}: keine Statusabfrage`);
  for (const anfrage of anfragen) {
    assert.ok(["get_call_status", "get_call_result"].includes(anfrage.werkzeug), `${name}: ${anfrage.werkzeug}`);
    const antwort = vonHost(lauf).find((eintrag) => eintrag.methode === "antwort" && eintrag.id === anfrage.id);
    assert.ok(antwort.t_ms - anfrage.t_ms >= REPLY_DELAY_MS - FRIST_TOLERANZ_MS, `${name}: Antwort ohne Verzögerung`);
  }
  const dauern = lauf.protokoll.filter((eintrag) => eintrag.inhalt && eintrag.inhalt.duration_s !== null).map((eintrag) => eintrag.inhalt.duration_s);
  assert.ok(dauern.every(Number.isInteger), `${name}: duration_s nicht ganzzahlig`);
  return anfragen.map((anfrage) => anfrage.werkzeug);
}

function assertKarte(lauf, name) {
  const szenario = SZENARIEN[name];
  assert.equal(lauf.karte.lang, szenario.erwartet, `${name}: Sprache der Karte`);
  assert.equal(lauf.sprache.gemessen, szenario.erwartet);
  assert.equal(lauf.karte.status, szenario.ergebnis.status, `${name}: Status`);
  const gescheitert = szenario.ergebnis.status === "failed";
  assert.equal(lauf.karte.dauer, gescheitert ? "0:06" : "2:06", `${name}: Dauer`);
  assert.equal(lauf.karte.ergebnis, gescheitert ? "—" : szenario.ergebnis.result_summary, `${name}: Ergebnistext`);
  assert.equal(lauf.karte.ziel === "—", gescheitert || name === "unklar_fr", `${name}: Ziel`);
  assert.equal(lauf.karte.grund === "—", !gescheitert, `${name}: Grund`);
}

async function spieleStapel(html, namen) {
  const laeufe = await Promise.all(namen.map((name) => spieleAnruffolge(chrome, html, { szenario: name, tempo: TEMPO_KURZ })));
  return namen.map((name, index) => [name, laeufe[index]]);
}

test("Attrappe spielt jedes Szenario mit dem Protokoll des Hosts gegen das ausgelieferte call-Widget", OPTIONS, async () => {
  const { call } = await ausgelieferteWidgets();
  const namen = Object.keys(SZENARIEN);
  const ergebnisse = [...(await spieleStapel(call, namen.slice(0, STAPEL))), ...(await spieleStapel(call, namen.slice(STAPEL)))];
  for (const [name, lauf] of ergebnisse) {
    assertProtokoll(lauf, name);
    const werkzeuge = assertAntworten(lauf, name);
    const gescheitert = SZENARIEN[name].ergebnis.status === "failed";
    assert.equal(werkzeuge.includes("get_call_result"), !gescheitert, `${name}: get_call_result`);
    assertKarte(lauf, name);
  }
});

test("Attrappe ändert die Dauer-Folge, wenn die Server-Uhr erst ab dem Abheben zählt", OPTIONS, async () => {
  const { call } = await ausgelieferteWidgets();
  const [weiter, neu] = await Promise.all(["weiter", "von-null"].map((uhr) => spieleAnruffolge(chrome, call, { szenario: "voll_de", tempo: TEMPO_MITTE, uhrNachAbgehoben: uhr })));
  const lauf = (antwort) => vonHost(antwort).filter((eintrag) => eintrag.methode === "antwort" && eintrag.inhalt);
  const letzte = (antwort) => lauf(antwort).slice(-3).filter((eintrag) => eintrag.inhalt.status !== "dialing");
  const [[mitteWeiterEintrag, endeWeiterEintrag], [mitteNeuEintrag, endeNeuEintrag]] = [letzte(weiter), letzte(neu)];
  const [mitteWeiter, endeWeiter, mitteNeu, endeNeu] = [mitteWeiterEintrag, endeWeiterEintrag, mitteNeuEintrag, endeNeuEintrag].map((eintrag) => eintrag.inhalt);
  assert.equal(mitteWeiter.status, "in_progress");
  assert.equal(endeWeiter.duration_s, 126);
  assert.equal(endeNeu.duration_s, 120);
  const versatz = mitteWeiter.duration_s - mitteNeu.duration_s;
  const abtastAbstandS = (mitteWeiterEintrag.t_ms - mitteNeuEintrag.t_ms) / TEMPO_MITTE / 1000;
  const abweichung = Math.abs(versatz - 6 - abtastAbstandS);
  assert.ok(abweichung <= 1, `Versatz ${versatz} bei Abtastabstand ${abtastAbstandS}`);
  assert.equal(weiter.karte.dauer, "2:06");
  assert.equal(neu.karte.dauer, "2:00");
});
