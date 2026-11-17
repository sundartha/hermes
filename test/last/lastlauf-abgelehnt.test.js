import assert from "node:assert/strict";
import { register } from "node:module";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { baueErgebnis } from "../../scripts/last/ergebnis.js";
import { fuehreLastlaufAus, laufeMitDateien } from "../../scripts/last/lauf.mjs";

const K6_KONFIG_ATTRAPPE = fileURLToPath(new URL("./k6-attrappe-konfig.mjs", import.meta.url));
const K6_ATTRAPPE_FEHLER = fileURLToPath(new URL("./k6-attrappe-fehler.mjs", import.meta.url));
const SPRACHEN = 3;
const TEXTE_JE_SPRACHE = 2;
const BEGRENZER_TEXTE = (await laufeMitDateien([process.execPath, K6_KONFIG_ATTRAPPE], { ziele: ["http://z"] })).ablehnungstexte;
const BASIS = {
  ziele: ["http://z"],
  tokens: ["t"],
  webhooks: { gueltig: [{ kopf: {}, koerper: "gueltig" }], ungueltig: [{ kopf: {}, koerper: "ungueltig" }] },
  appSub: "s",
  appEmail: "e",
};

globalThis.__k6 = { antwort: null, zaehler: [], exec: { scenario: { name: "" }, vu: { idInTest: 1, iterationInScenario: 0 } } };
globalThis.__ENV = { LAST_KONFIG: "k", LAST_ERGEBNIS: "e" };
globalThis.open = () => JSON.stringify({ ...BASIS, ablehnungstexte: BEGRENZER_TEXTE });
register("./k6-module-attrappe.mjs", import.meta.url);
const ablaeufe = await import("../../scripts/last/ablaeufe.js");

const k6 = globalThis.__k6;
const rpc = (ergebnis) => ({
  status: 200,
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, result: ergebnis }),
  timings: { duration: 1 },
  cookies: {},
});
const fehlerAntwort = (text) => rpc({ isError: true, content: [{ type: "text", text }] });

function place(t, antwort) {
  t.mock.method(console, "error", () => undefined);
  k6.zaehler = [];
  k6.antwort = () => antwort;
  ablaeufe.anruf();
  const summe = (name) => k6.zaehler.filter(([n]) => n === name).reduce((s, [, w]) => s + w, 0);
  return { abgelehnt: summe("abgelehnt"), fehler: summe("ablauf_fehler"), gestartet: summe("anrufe_gestartet") };
}

test("Abgelehnt: die Konfig nennt zwei verschiedene Texte je Sprache, darunter den deutschen Auslastungstext", () => {
  assert.equal(BEGRENZER_TEXTE.length, SPRACHEN * TEXTE_JE_SPRACHE);
  assert.equal(new Set(BEGRENZER_TEXTE).size, BEGRENZER_TEXTE.length);
  assert.ok(BEGRENZER_TEXTE[0].startsWith("Hermes ist gerade ausgelastet. Es wurde kein Anruf gestartet."));
  assert.ok(BEGRENZER_TEXTE[1].startsWith("Fuer dieses Hermes-Konto laufen bereits so viele Anrufe gleichzeitig wie erlaubt"));
});

test("Abgelehnt: jeder Begrenzertext zaehlt als abgelehnt, nicht als Fehler und nicht als Anruf", (t) => {
  for (const text of BEGRENZER_TEXTE) {
    assert.deepEqual(place(t, fehlerAntwort(text)), { abgelehnt: 1, fehler: 0, gestartet: 0 }, text);
  }
});

const ANDERE = [
  ["gate_error", "Ausgehende Anrufe sind derzeit vom Hermes-Betreiber pausiert."],
  ["kyc", "Ausgehende Anrufe erfordern eine verifizierte Identitaet."],
  ["aehnlicher Wortlaut", "Hermes ist gerade ausgelastet."],
  ["Text mit Zusatz", `${BEGRENZER_TEXTE[0]} Mehr.`],
  ["Text mit Leerzeichen davor", ` ${BEGRENZER_TEXTE[1]}`],
  ["isError ohne Text", undefined],
];

test("Abgelehnt: jede andere isError-Antwort zaehlt weiter als ablauf_fehler", (t) => {
  for (const [name, text] of ANDERE) {
    const antwort = text === undefined ? rpc({ isError: true }) : fehlerAntwort(text);
    assert.deepEqual(place(t, antwort), { abgelehnt: 0, fehler: 1, gestartet: 0 }, name);
  }
});

test("Abgelehnt: laufeMitDateien schreibt die Begrenzertexte in die Konfig", async (t) => {
  t.mock.method(process.stderr, "write", () => true);
  const konfig = await laufeMitDateien([process.execPath, K6_KONFIG_ATTRAPPE], { ziele: ["http://z"] });
  assert.deepEqual(konfig.ablehnungstexte, BEGRENZER_TEXTE);
  assert.deepEqual(konfig.ziele, ["http://z"]);
});

test("Abgelehnt: baueErgebnis nennt abgelehnt als Zahl, fehlend ist undefined", () => {
  const daten = { metrics: { abgelehnt: { values: { count: 3 } } } };
  assert.equal(baueErgebnis(daten).abgelehnt, 3);
  assert.equal(baueErgebnis({ metrics: {} }).abgelehnt, undefined);
});

test("Abgelehnt: abgelehnt fliesst nicht in die Fehlerquote", () => {
  const daten = {
    metrics: {
      http_reqs: { values: { count: 200 } },
      http_req_failed: { values: { passes: 0 } },
      ablauf_fehler: { values: { count: 0 } },
      abgelehnt: { values: { count: 10 } },
    },
  };
  assert.equal(baueErgebnis(daten).fehlerquoteProzent, 0);
});

test("Abgelehnt: das Protokoll des ersten Laufs nennt abgelehnt", async (t) => {
  const zeilen = [];
  t.mock.method(console, "error", (zeile) => void zeilen.push(String(zeile)));
  const ergebnis = { fehlerquoteProzent: 0.6, anfragen: 440, httpFehlgeschlagen: 2, ablaufFehler: 1, abgelehnt: 4, verloreneAnrufe: 0, wartezeitSekunden: 1, routen: [{ name: "r", istMs: 1, budgetMs: 2 }] };
  const starte = async () => ({ ziele: ["http://localhost:3999"], konfiguration: { stderrZeilen: [], ergebnis }, schliessen: async () => undefined });
  await fuehreLastlaufAus({ k6Befehl: [process.execPath, K6_ATTRAPPE_FEHLER], starte });
  assert.match(zeilen.join("\n"), /abgelehnt 4/);
});
