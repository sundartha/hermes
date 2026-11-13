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
const WORT_ZEICHEN = 40;
const WORT = {
  de: "Haftpflichtversicherungsvertragsänderung",
  fr: "Désinstitutionnalisationsadministratives",
  en: "Antidisestablishmentarianismsubcontracts",
};

const FUELLWORT = { de: "Termin", fr: "rendez", en: "booked" };

function langerText(sprache, zeichen) {
  const wort = `${FUELLWORT[sprache]} `;
  return `${WORT[sprache]} ${wort.repeat(Math.ceil(zeichen / wort.length))}`.slice(0, zeichen);
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
    const wert = el.querySelector(".row-v, [data-mcp], [data-objective-display]");
    const beschriftung = el.querySelector(".row-k") || el.firstElementChild;
    zeilen[key] = { sichtbar: sichtbar(el), zeile: kasten(el), wert: wert ? kasten(wert) : null, beschriftung: beschriftung ? kasten(beschriftung) : null, abgeschnitten: wert ? wert.scrollWidth > wert.clientWidth : false };
  }
  const dauerEl = doc.querySelector("[data-duration-display]");
  const dauerZeile = dauerEl.closest(".row, .pill");
  const dauerBeschriftung = dauerZeile.querySelector(".row-k");
  const dauerStil = doc.defaultView.getComputedStyle(dauerZeile);
  const dauer = { wert: kasten(dauerEl), zeile: kasten(dauerZeile), beschriftung: dauerBeschriftung ? kasten(dauerBeschriftung) : null, abstand: parseFloat(dauerStil.columnGap), innen: parseFloat(dauerStil.paddingRight), abgeschnitten: dauerEl.scrollWidth > dauerEl.clientWidth };
  const texte = {};
  for (const el of doc.querySelectorAll("[data-mcp]")) texte[el.getAttribute("data-mcp")] = el.textContent;
  return JSON.stringify({ dauer, texte, karte: kasten(doc.querySelector(".w") || doc.querySelector(".card")), seitenbreite: doc.documentElement.scrollWidth, rahmenbreite: document.getElementById("f").getBoundingClientRect().width, zeilen });
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
  const { dauer, karte } = messung;
  if (dauer.wert.rechts > karte.rechts + RAND_TOLERANZ) befunde.push(`${wo}: Dauer ragt rechts über die Karte`);
  if (dauer.abgeschnitten) befunde.push(`${wo}: Dauer ist abgeschnitten`);
  return befunde;
}

function dauerBefunde(messung, wo) {
  const { wert, zeile, beschriftung, abstand, innen } = messung.dauer;
  const befunde = [];
  if (!beschriftung) {
    if (wert.links < zeile.links - RAND_TOLERANZ || wert.rechts > zeile.rechts + RAND_TOLERANZ) befunde.push(`${wo}: Dauer liegt nicht in der Pille`);
    return befunde;
  }
  if (wert.links < beschriftung.rechts + abstand - RAND_TOLERANZ) befunde.push(`${wo}: Dauer steht nicht rechts neben der Beschriftung`);
  if (Math.abs(wert.rechts - (zeile.rechts - innen)) > RAND_TOLERANZ) befunde.push(`${wo}: Dauer nicht bündig an der rechten Innenkante`);
  if (!(wert.oben < beschriftung.unten && wert.unten > beschriftung.oben)) befunde.push(`${wo}: Dauer steht nicht in der Zeile der Beschriftung`);
  return befunde;
}

function wortBefunde(messung, sprache, wo) {
  const { texte } = messung;
  const wort = WORT[sprache];
  return ["result_summary", "outcome", "next_step"]
    .filter((schluessel) => !texte[schluessel].includes(wort))
    .map((schluessel) => `${wo}: ${schluessel} enthält das lange Wort nicht vollständig`);
}

function lageBefunde(messung, wo) {
  const befunde = [];
  for (const key of LANGE_ZEILEN) {
    const { wert, beschriftung } = messung.zeilen[key];
    if (wert.links < beschriftung.rechts - RAND_TOLERANZ) befunde.push(`${wo}: ${key} steht nicht neben der Beschriftung`);
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
      befunde.push(...randBefunde(messung, wo), ...lageBefunde(messung, wo), ...dauerBefunde(messung, wo), ...wortBefunde(messung, sprache, wo));
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

test("Die Wörter für den Umbruchtest haben je Sprache genau 40 Zeichen", () => {
  for (const sprache of SPRACHEN) assert.equal([...WORT[sprache]].length, WORT_ZEICHEN, sprache);
});
