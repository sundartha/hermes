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
const LANGER_GRUND = `no-answer:${"Haftpflichtversicherungsvertragsänderung".repeat(8)}`;

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

const MESSUNG = `(() => {
  const doc = document.getElementById("f").contentDocument;
  const kasten = (el) => { const r = el.getBoundingClientRect(); return { links: r.left, rechts: r.right, oben: r.top, unten: r.bottom }; };
  const zeilen = {};
  for (const el of doc.querySelectorAll("[data-row]")) {
    const wert = el.querySelector(".row-v, [data-mcp], [data-failure-display]");
    const beschriftung = el.querySelector(".row-k") || el.firstElementChild;
    zeilen[el.getAttribute("data-row")] = { sichtbar: el.style.display !== "none", wert: wert ? kasten(wert) : null, beschriftung: beschriftung ? kasten(beschriftung) : null, abgeschnitten: wert ? wert.scrollWidth > wert.clientWidth : false };
  }
  const texte = {};
  for (const el of doc.querySelectorAll("[data-mcp]")) texte[el.getAttribute("data-mcp")] = el.textContent;
  return JSON.stringify({ texte, karte: kasten(doc.querySelector(".w") || doc.querySelector(".card")), zeilen });
})()`;

async function messe(html, szenarioWahl) {
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

async function zusammenfassung(outcome, resultSummary) {
  const { call } = await ausgelieferteWidgets();
  const messung = await messe(call, szenario("de", BREITEN[1], { outcome, result_summary: resultSummary }));
  return { sichtbar: messung.zeilen.summary.sichtbar, text: messung.texte.result_summary, outcomeSichtbar: messung.zeilen.outcome.sichtbar, outcomeText: messung.texte.outcome };
}

test("Fehlgeschlagener Anruf: die Grund-Zeile bleibt in jeder Sprache und Breite im Rahmen unter ihrer Beschriftung", OPTIONS, async () => {
  const { call } = await ausgelieferteWidgets();
  const befunde = [];
  for (const sprache of SPRACHEN) {
    for (const breite of BREITEN) {
      const messung = await messe(call, szenario(sprache, breite, { status: "failed", failure_reason: LANGER_GRUND, objective_achieved: false, result_summary: null }));
      const wo = `${sprache} ${breite}px`;
      const { sichtbar, wert, beschriftung, abgeschnitten } = messung.zeilen.failure;
      if (!sichtbar) befunde.push(`${wo}: Grund nicht sichtbar`);
      if (wert.rechts > messung.karte.rechts + RAND_TOLERANZ) befunde.push(`${wo}: Grund ragt rechts über die Karte`);
      if (abgeschnitten) befunde.push(`${wo}: Grund ist abgeschnitten`);
      if (wert.links < beschriftung.rechts - RAND_TOLERANZ) befunde.push(`${wo}: Grund steht nicht neben der Beschriftung`);
    }
  }
  assert.deepEqual(befunde, []);
});

test("Steht das Ergebnis als ganzer Satz am Anfang der Zusammenfassung, zeigt die Zusammenfassung nur den Rest", OPTIONS, async () => {
  const messung = await zusammenfassung("Termin am Donnerstag", "Termin am Donnerstag. Bitte 10 Uhr mitbringen.");
  assert.equal(messung.outcomeSichtbar, true);
  assert.equal(messung.outcomeText, "Termin am Donnerstag");
  assert.equal(messung.sichtbar, true);
  assert.equal(messung.text, "Bitte 10 Uhr mitbringen.");
});

test("Der führende Satz zählt nach Trimmen, ohne Groß/Klein und ohne Satzzeichen am Ende", OPTIONS, async () => {
  const messung = await zusammenfassung("  termin am DONNERSTAG!  ", "Termin am Donnerstag?! Danach Rückruf.");
  assert.equal(messung.text, "Danach Rückruf.");
  assert.equal(messung.sichtbar, true);
});

test("Bleibt nach dem führenden Satz nichts übrig, ist die Zusammenfassung ausgeblendet", OPTIONS, async () => {
  for (const zusammen of ["Termin am Donnerstag.", "Termin am Donnerstag", "Termin am Donnerstag. "]) {
    const messung = await zusammenfassung("Termin am Donnerstag", zusammen);
    assert.equal(messung.sichtbar, false, zusammen);
    assert.equal(messung.outcomeSichtbar, true, zusammen);
  }
});

test("Beginnt die Zusammenfassung nur mit denselben Buchstaben, bleibt sie vollständig", OPTIONS, async () => {
  const wort = await zusammenfassung("Termin", "Terminverschiebung nötig");
  assert.equal(wort.sichtbar, true);
  assert.equal(wort.text, "Terminverschiebung nötig");
  const fortsetzung = await zusammenfassung("Termin am Donnerstag", "Termin am Donnerstag um 10 Uhr");
  assert.equal(fortsetzung.text, "Termin am Donnerstag um 10 Uhr");
  const ohneErgebnis = await zusammenfassung("", "Nur die Zusammenfassung.");
  assert.equal(ohneErgebnis.sichtbar, true);
  assert.equal(ohneErgebnis.text, "Nur die Zusammenfassung.");
});
