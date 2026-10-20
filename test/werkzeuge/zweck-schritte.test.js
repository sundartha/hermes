import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUND, MELDUNG, PRUEFUNG, kenntZweck } from "../../tools/auftrag/zweck.mjs";
import { REPO_ROOT } from "./probe-repo.js";
import { dateienMitEndung, jobnamenVon, quelltext, workflowSchritte } from "./zweck-quellen.js";

const ZUORDNUNG = "tools/zweck/zuordnung/workflow-schritte.json";
const SOLL = ".github/soll/einstellungen.json";
const TRENNER = " › ";
const LOKALE_ACTION = /^\.\/(\.github\/actions\/[\w-]+)$/;
const ARTEN = ["zweck", "gruppen", "aufbau", "meldet"];
const ZWECK_ZEIGEN = "tools/zweck-zeigen.mjs";
const WORKFLOW_ENDUNG = ".yml";
const OHNE_URTEIL = new Map([["tools/testlaufzeit-reporter.mjs", "Reporter des Testlaufs, schreibt nur Laufzeiten; das Urteil und den Block gibt der Starter aus"]]);
const AUFGERUFEN = /\b((?:tools|scripts)\/[\w./-]+\.m?js)\b/g;
const KONSTANTEN = [
  ["MELDUNG", MELDUNG],
  ["PRUEFUNG", PRUEFUNG],
  ["GRUND", GRUND],
];

function pflichtNamen() {
  const text = quelltext(SOLL);
  return new Set([...text.matchAll(/"context":\s*"([^"]+)"/g)].map(([, name]) => name));
}

function pflichtWorkflows() {
  const namen = pflichtNamen();
  return dateienMitEndung(".github/workflows", [".yml"]).filter((pfad) => jobnamenVon(pfad).some((name) => namen.has(name)));
}

function actionOrdner({ werte }) {
  return LOKALE_ACTION.exec(werte.uses ?? "")?.[1];
}

function lokaleActions(schritte) {
  const ordner = new Set(schritte.map(actionOrdner).filter(Boolean));
  return [...ordner].map((pfad) => `${pfad}/action.yml`);
}

function schluessel({ datei, job, werte }) {
  return [datei, job, werte.name].filter((teil) => teil !== null && teil !== undefined).join(TRENNER);
}

function schritteDerPflichtChecks() {
  const schritte = pflichtWorkflows().flatMap((pfad) => workflowSchritte(pfad).schritte);
  const inActions = lokaleActions(schritte).flatMap((pfad) => workflowSchritte(pfad).schritte);
  return [...schritte, ...inActions].filter(({ werte }) => werte.run !== undefined || LOKALE_ACTION.test(werte.uses ?? ""));
}

function eintraegeDerZuordnung() {
  return JSON.parse(quelltext(ZUORDNUNG));
}

function alsListe(wert) {
  return [wert].flat();
}

function nenntId(pfad, id) {
  const text = quelltext(pfad);
  if (text.includes(`"${id}"`) || text.includes(`zweck-zeigen.mjs ${id}`)) return true;
  return KONSTANTEN.some(([gruppe, werte]) => Object.entries(werte).some(([name, wert]) => wert === id && text.includes(`${gruppe}.${name}`)));
}

test("die Pflicht-Checks aus dem Soll haben Workflow-Dateien, und jeder Schritt mit run hat einen Namen", () => {
  const jobnamen = new Set(pflichtWorkflows().flatMap(jobnamenVon));
  assert.deepEqual([...pflichtNamen()].filter((name) => !jobnamen.has(name)), [], "Pflicht-Check ohne Job");
  for (const schritt of schritteDerPflichtChecks()) assert.ok(schritt.werte.name, `${schritt.datei} › ${schritt.job}: Schritt ohne Namen`);
});

test("jeder Schritt mit run und jede lokale Action der Pflicht-Checks ist einer Zweck-ID zugeordnet oder als Aufbau- oder Meldeschritt geführt, und kein Name kommt im selben Job doppelt vor", () => {
  const erwartet = schritteDerPflichtChecks().map(schluessel);
  assert.deepEqual(erwartet.filter((name, stelle) => erwartet.indexOf(name) !== stelle), [], "zwei Schritte mit demselben Namen im selben Job");
  const eingetragen = Object.keys(eintraegeDerZuordnung());
  assert.deepEqual(erwartet.filter((name) => !eingetragen.includes(name)), [], "Schritt ohne Eintrag in tools/zweck/zuordnung/workflow-schritte.json");
  assert.deepEqual(eingetragen.filter((name) => !erwartet.includes(name)), [], "Eintrag ohne Schritt");
});

test("jeder Eintrag hat genau eine Art mit Text, und jede Zweck-ID hat einen Text", () => {
  for (const [name, eintrag] of Object.entries(eintraegeDerZuordnung())) {
    const arten = ARTEN.filter((art) => eintrag[art] !== undefined);
    assert.equal(arten.length, 1, `${name}: ${arten.join(", ") || "keine Art"}`);
    for (const wert of alsListe(eintrag[arten[0]])) assert.ok(typeof wert === "string" && wert.trim() !== "", name);
    for (const id of alsListe(eintrag.zweck ?? [])) assert.ok(kenntZweck(id), `${name}: kein Text für ${id}`);
  }
});

function belegeGeprueft(name, eintrag) {
  const belege = alsListe(eintrag.beleg ?? []);
  assert.ok(belege.length > 0 && belege.every((pfad) => existsSync(join(REPO_ROOT, pfad))), `${name}: Beleg fehlt`);
  for (const id of alsListe(eintrag.zweck ?? [])) assert.ok(belege.some((pfad) => nenntId(pfad, id)), `${name}: ${id} steht in keinem Beleg`);
  if (eintrag.gruppen !== undefined) assert.ok(existsSync(join(REPO_ROOT, eintrag.gruppen)) && belege.some((pfad) => quelltext(pfad).includes("lint-zweck")), name);
  return belege;
}

function aufgerufeneDateien(schritt) {
  const skript = schritt.roh.join("\n");
  return [...skript.matchAll(AUFGERUFEN)].map(([, pfad]) => pfad).filter((pfad) => existsSync(join(REPO_ROOT, pfad)));
}

function laedtBeleg(pfad, belege) {
  if (pfad === ZWECK_ZEIGEN) return belege.some((beleg) => beleg.endsWith(WORKFLOW_ENDUNG));
  const text = quelltext(pfad);
  return belege.some((beleg) => beleg === pfad || (!beleg.endsWith(WORKFLOW_ENDUNG) && text.includes(`/${beleg.split("/").at(-1)}"`)));
}

test("jede zugeordnete Zweck-ID nennt eine Datei, die sie ausgibt, und der Schritt ruft diese Datei oder ein Werkzeug, das sie lädt", () => {
  const schritte = new Map(schritteDerPflichtChecks().map((schritt) => [schluessel(schritt), schritt]));
  const mitZweck = Object.entries(eintraegeDerZuordnung()).filter(([, eintrag]) => eintrag.zweck !== undefined || eintrag.gruppen !== undefined);
  assert.ok(mitZweck.length > 0);
  const aufgerufen = new Set();
  for (const [name, eintrag] of mitZweck) {
    const belege = belegeGeprueft(name, eintrag);
    const dateien = aufgerufeneDateien(schritte.get(name));
    for (const datei of dateien) aufgerufen.add(datei);
    for (const pfad of dateien.filter((datei) => !OHNE_URTEIL.has(datei))) assert.ok(laedtBeleg(pfad, belege), `${name}: ${pfad} lädt keinen Beleg`);
  }
  for (const datei of OHNE_URTEIL.keys()) assert.ok(aufgerufen.has(datei), `${datei} steht ohne Aufruf in der Liste`);
});
