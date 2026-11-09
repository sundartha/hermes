import { test } from "node:test";
import assert from "node:assert/strict";
import { ausgelieferteWidgets } from "./ausgelieferte-widgets.js";
import { findChrome } from "./widget-im-rahmen.js";
import { CALL_ID, DONE_BINDING, bedieneAnruffolge } from "./widget-anruffolge-attrappe.mjs";
import { connect, launch } from "./widget-ladezeit-messen.mjs";

const SKIP = findChrome() ? false : "kein Chromium gefunden (CHROME_BIN setzen)";
const chrome = findChrome();
const OPTIONS = { skip: SKIP, timeout: 120000 };
const BREITEN = [280, 360, 598];
const SPRACHEN = ["de", "fr", "en"];
const TEMPO = 0.05;
const RAND_TOLERANZ = 0.5;
const SUMMARY_ZEICHEN = 600;
const SATZ_ZEICHEN = 200;
const WORT_OHNE_LEERZEICHEN = "Gesamtkostenabrechnungsvorschlagsbest";

const FUELLWORT = { de: "Termin", fr: "rendez", en: "booked" };

function langerText(sprache, zeichen) {
  const wort = `${FUELLWORT[sprache]} `;
  return `${wort.repeat(Math.ceil(zeichen / wort.length))}${WORT_OHNE_LEERZEICHEN}`.slice(0, zeichen);
}

function szenario(sprache, breite, ergebnis) {
  return {
    locale: sprache,
    inhaltssprache: sprache,
    erwartet: sprache,
    breite,
    waehlenS: 1,
    gespraechS: 1,
    zeilen: [],
    ergebnis: { status: "completed", failure_reason: null, objective_achieved: true, ...ergebnis },
  };
}

function langesErgebnis(sprache) {
  return {
    result_summary: langerText(sprache, SUMMARY_ZEICHEN),
    outcome: langerText(sprache, SATZ_ZEICHEN),
    next_step: langerText(sprache, SATZ_ZEICHEN),
  };
}

const MESSUNG = `(() => {
  const doc = document.getElementById("f").contentDocument;
  const kasten = (el) => { const r = el.getBoundingClientRect(); return { links: r.left, rechts: r.right, oben: r.top, unten: r.bottom }; };
  const sichtbar = (el) => el.style.display !== "none";
  const zeilen = {};
  for (const el of doc.querySelectorAll("[data-row]")) {
    const key = el.getAttribute("data-row");
    const wert = el.querySelector(".row-v, [data-mcp]");
    const beschriftung = el.querySelector(".row-k");
    zeilen[key] = { sichtbar: sichtbar(el), zeile: kasten(el), wert: wert ? kasten(wert) : null, beschriftung: beschriftung ? kasten(beschriftung) : null, abgeschnitten: wert ? wert.scrollWidth > wert.clientWidth : false };
  }
  return JSON.stringify({ karte: kasten(doc.querySelector(".card")), seitenbreite: doc.documentElement.scrollWidth, rahmenbreite: document.getElementById("f").getBoundingClientRect().width, zeilen });
})()`;

async function messeErgebnis(html, szenarioWahl) {
  const konfig = { szenario: szenarioWahl, tempo: TEMPO, uhrNachAbgehoben: "weiter", callId: CALL_ID };
  const server = bedieneAnruffolge(html, konfig);
  const port = await server.listening;
  const browser = launch(chrome);
  let client;
  try {
    client = connect(await browser.endpoint);
    await client.opened;
    const { send, nextBinding } = client;
    const { targetId } = await send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
    await send("Runtime.enable", {}, sessionId);
    await send("Runtime.addBinding", { name: DONE_BINDING }, sessionId);
    const done = nextBinding();
    await send("Page.navigate", { url: `http://127.0.0.1:${port}/` }, sessionId);
    await done;
    const { result } = await send("Runtime.evaluate", { expression: MESSUNG, returnByValue: true }, sessionId);
    return JSON.parse(result.value);
  } finally {
    await browser.stop(client && client.send);
    if (client) client.close();
    server.close();
  }
}

const LANGE_ZEILEN = ["summary", "outcome", "next_step"];

function randBefunde(messung, wo) {
  const befunde = [];
  if (messung.seitenbreite > messung.rahmenbreite) befunde.push(`${wo}: Seite ${messung.seitenbreite} breiter als Rahmen ${messung.rahmenbreite}`);
  for (const [key, zeile] of Object.entries(messung.zeilen)) {
    if (!zeile.sichtbar || !zeile.wert) continue;
    if (zeile.wert.rechts > messung.karte.rechts + RAND_TOLERANZ) befunde.push(`${wo}: ${key} ragt rechts über die Karte`);
    if (zeile.abgeschnitten) befunde.push(`${wo}: ${key} ist abgeschnitten`);
  }
  return befunde;
}

function lageBefunde(messung, wo) {
  const befunde = [];
  for (const key of LANGE_ZEILEN) {
    const { wert, beschriftung } = messung.zeilen[key];
    if (wert.oben < beschriftung.unten - RAND_TOLERANZ) befunde.push(`${wo}: ${key} steht nicht unter der Beschriftung`);
    if (Math.abs(wert.links - beschriftung.links) > RAND_TOLERANZ) befunde.push(`${wo}: ${key} nicht linksbündig`);
  }
  const ziel = messung.zeilen.objective;
  if (ziel.wert.links < ziel.beschriftung.rechts) befunde.push(`${wo}: Ziel-Status steht nicht rechts neben der Beschriftung`);
  return befunde;
}

test("Lange Ergebnistexte bleiben in jeder Sprache und Breite im Rahmen, lange Werte stehen unter ihrer Beschriftung", OPTIONS, async () => {
  const { call } = await ausgelieferteWidgets();
  const befunde = [];
  for (const sprache of SPRACHEN) {
    for (const breite of BREITEN) {
      const messung = await messeErgebnis(call, szenario(sprache, breite, langesErgebnis(sprache)));
      const wo = `${sprache} ${breite}px`;
      befunde.push(...randBefunde(messung, wo), ...lageBefunde(messung, wo));
    }
  }
  assert.deepEqual(befunde, []);
});

test("Ergebnis des Anrufs steht über der Zusammenfassung", OPTIONS, async () => {
  const { call } = await ausgelieferteWidgets();
  for (const sprache of SPRACHEN) {
    const messung = await messeErgebnis(call, szenario(sprache, BREITEN[1], { result_summary: "Zusammenfassung", outcome: "Ergebnis" }));
    assert.ok(messung.zeilen.outcome.sichtbar, `${sprache}: Ergebnis sichtbar`);
    assert.ok(messung.zeilen.summary.sichtbar, `${sprache}: Zusammenfassung sichtbar`);
    const { outcome, summary } = messung.zeilen;
    assert.ok(outcome.zeile.oben < summary.zeile.oben, `${sprache}: Ergebnis zuerst`);
  }
});

test("Ist das Ergebnis gleich der Zusammenfassung, erscheint der Satz nur einmal", OPTIONS, async () => {
  const { call } = await ausgelieferteWidgets();
  const gleich = await messeErgebnis(call, szenario("de", BREITEN[1], { result_summary: "Termin am Donnerstag", outcome: " Termin am Donnerstag " }));
  assert.equal(gleich.zeilen.outcome.sichtbar, true);
  assert.equal(gleich.zeilen.summary.sichtbar, false);
  const verschieden = await messeErgebnis(call, szenario("de", BREITEN[1], { result_summary: "Termin am Donnerstag um 10 Uhr", outcome: "Termin am Donnerstag" }));
  assert.equal(verschieden.zeilen.summary.sichtbar, true);
});
