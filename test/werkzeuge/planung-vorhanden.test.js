import assert from "node:assert/strict";
import { test } from "node:test";

import { NUTZEN, erkundungBefunde } from "../../tools/auftrag/planung/erkundung.mjs";
import { probeRepository } from "./probe-repo.js";

const EINGANG = ["export function nimmAn(anfrage) {", "  return anfrage;", "}", ""].join("\n");
const KOSTEN = [
  "export function summeMikroCent(betraege) {",
  "  const summe = betraege.reduce((gesamt, betrag) => gesamt + betrag, 0);",
  "  return Number.isSafeInteger(summe) ? summe : null;",
  "}",
  "",
].join("\n");
const SOLL = new Map([["S1", { text: "Gegeben ein Lauf\nWenn er endet\nDann steht die Summe da" }]]);
const NEUE_FUNKTION = { datei: "src/bericht.js", funktion: "gesamtKosten", neu: "funktion", neueZeilen: 8 };
const TREFFER_DER_REGEL = "src/kosten.js:3";

function repo(context) {
  return probeRepository(context, {
    "src/eingang.js": EINGANG,
    "src/kosten.js": KOSTEN,
    "docs/design.md": "Die Summe prüft isSafeInteger nach der Rundungsregel.\n",
    "src/bericht.js": "export function zeige() {\n  return 1;\n}\n",
    "test/vorhanden.test.js": "",
  });
}

function bericht(vorhanden) {
  return {
    nummern: {
      S1: {
        weg: [
          { rolle: "eingang", datei: "src/eingang.js", funktion: "nimmAn", von: 1, bis: 3 },
          { rolle: "wirkung", datei: "src/bericht.js", funktion: "zeige", von: 1, bis: 3 },
        ],
        aenderungen: [{ ...NEUE_FUNKTION, vorhanden }],
        tests: ["test/vorhanden.test.js"],
        schema: { aenderung: false, fundstelle: "src/kosten.js Zeile 1" },
        codeowners: [],
        ownerEntscheidung: "keine, weil keine geschützte Datei betroffen ist",
        eingangImTest: "erreichbar",
        widersprueche: [],
      },
    },
  };
}

function pruefe(context, vorhanden) {
  return erkundungBefunde(bericht(vorhanden), { gruppe: ["S1"], soll: SOLL, root: repo(context) });
}

function nurBefund(ergebnis, teil) {
  assert.equal(ergebnis.befunde.length, 1, ergebnis.befunde.join("\n"));
  assert.ok(ergebnis.befunde[0].includes(teil), ergebnis.befunde[0]);
}

const NUTZT_SUMME = { suche: ["gesamtKosten", "isSafeInteger"], treffer: [TREFFER_DER_REGEL], urteil: NUTZEN, nutzen: { datei: "src/kosten.js", funktion: "summeMikroCent" } };

test("eine neue Funktion, deren Regel die Suche in einer anderen Datei findet, ist mit Urteil nutzen grün", (context) => {
  const { befunde, annahmen } = pruefe(context, NUTZT_SUMME);
  assert.deepEqual(befunde, []);
  assert.deepEqual(annahmen.filter(({ angabe }) => angabe !== "ownerEntscheidung"), []);
});

test("ein Treffer in einer Datei, in der die Suche nichts findet, oder auf einer Zeile, die es nicht gibt, ist ein Befund", (context) => {
  nurBefund(pruefe(context, { ...NUTZT_SUMME, treffer: [TREFFER_DER_REGEL, "src/eingang.js:1"] }), "treffer src/eingang.js:1 liegt in keiner Datei");
  nurBefund(pruefe(context, { ...NUTZT_SUMME, treffer: [TREFFER_DER_REGEL, "src/kosten.js:9"] }), "treffer src/kosten.js:9 liegt in keiner Datei");
});

test("eine angesehene Zeile in einer Datei mit Fund zählt als Treffer, auch wenn die Suche genau diese Zeile nicht ausgibt", (context) => {
  assert.deepEqual(pruefe(context, { ...NUTZT_SUMME, treffer: ["src/kosten.js:1"] }).befunde, []);
});

test("findet die Suche die Regel, darf treffer nicht leer sein", (context) => {
  nurBefund(pruefe(context, { ...NUTZT_SUMME, treffer: [], urteil: "kein Treffer passt, weil nichts da ist" }), "hat 1 Treffer, treffer nennt keinen");
});

test("eine Suche nur nach dem neuen Namen ist ein Befund, weil sie keine nachgebaute Regel findet", (context) => {
  nurBefund(pruefe(context, { suche: ["gesamtKosten"], treffer: [], urteil: "kein Treffer passt, weil die Suche leer ist" }), "keinen Suchbegriff außer dem neuen Namen gesamtKosten");
});

test("kein Treffer passt mit Grund ist grün und steht mit Suchbegriffen und Fundzahl als Annahme im Bericht", (context) => {
  const urteil = "kein Treffer passt, weil summeMikroCent ganze Beträge prüft und hier Minuten addiert werden";
  const { befunde, annahmen } = pruefe(context, { ...NUTZT_SUMME, urteil, nutzen: undefined });
  assert.deepEqual(befunde, []);
  assert.ok(annahmen.some(({ angabe, text }) => angabe === "vorhanden" && text.endsWith(`${urteil} (Suche nach gesamtKosten, isSafeInteger: 1 Funde)`)), JSON.stringify(annahmen));
});

test("ein Urteil ohne Grund oder ohne bekannte Form ist ein Befund", (context) => {
  nurBefund(pruefe(context, { ...NUTZT_SUMME, urteil: "kein Treffer passt, weil", nutzen: undefined }), "ohne Grund");
  nurBefund(pruefe(context, { ...NUTZT_SUMME, urteil: "passt schon", nutzen: undefined }), "urteil muss");
});

test("nutzen mit einer Datei außerhalb der Treffer oder einer fehlenden Funktion ist ein Befund", (context) => {
  nurBefund(pruefe(context, { ...NUTZT_SUMME, nutzen: { datei: "src/eingang.js", funktion: "nimmAn" } }), "nutzen nennt src/eingang.js, das unter treffer nicht vorkommt");
  nurBefund(pruefe(context, { ...NUTZT_SUMME, nutzen: { datei: "src/kosten.js", funktion: "gibtEsNicht" } }), "Funktion gibtEsNicht fehlt in src/kosten.js");
});

test("ein ungültiges Suchmuster ist ein Befund und bricht die Prüfung nicht ab", (context) => {
  nurBefund(pruefe(context, { ...NUTZT_SUMME, suche: ["summe[", "isSafeInteger"] }), "Suchbegriff summe[ ist kein gültiges Muster");
});

test("eine Suche, deren Begriffe außer dem neuen Namen im Code nichts finden, ist ein Befund statt eines Belegs für nichts gefunden", (context) => {
  nurBefund(pruefe(context, { suche: ["gesamtKosten", "zzqx"], treffer: [], urteil: "kein Treffer passt, weil es so etwas nicht gibt" }), "findet im Code nichts");
});

test("ein Fund nur in Dokumenten ist kein Fund im Code: die Suche zählt ihn nicht, und ein Treffer dort ist ein Befund", (context) => {
  nurBefund(pruefe(context, { suche: ["gesamtKosten", "Rundungsregel"], treffer: [], urteil: "kein Treffer passt, weil es nur im Design steht" }), "findet im Code nichts");
  nurBefund(pruefe(context, { ...NUTZT_SUMME, treffer: [TREFFER_DER_REGEL, "docs/design.md:1"] }), "treffer docs/design.md:1 liegt in keiner Datei");
});
