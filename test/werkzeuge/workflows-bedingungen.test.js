import assert from "node:assert/strict";
import { test } from "node:test";

import { workflowLines } from "./workflow-dateien.js";

const TOKEN = /\s*(\|\||&&|==|!=|!|\(|\)|'[^']*'|[A-Za-z_][\w-]*(?:\.[\w-]+)*(?:\(\))?)/y;
const EINGEBETTET = /\$\{\{\s*(.*?)\s*\}\}/g;
const GANZ_AUSDRUCK = /^\$\{\{\s*(.*?)\s*\}\}$/;

function zerlege(ausdruck) {
  const text = ausdruck.trimEnd();
  const liste = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < text.length) {
    const start = TOKEN.lastIndex;
    const treffer = TOKEN.exec(text);
    assert.ok(treffer, `unlesbar ab Stelle ${start}: ${text}`);
    liste.push(treffer[1]);
  }
  return liste;
}

function nachschlagen(kontext, name) {
  return name.split(".").reduce((teil, schluessel) => teil?.[schluessel], kontext) ?? "";
}

function wert(ausdruck, kontext) {
  const liste = zerlege(ausdruck);
  let stelle = 0;
  const naechstes = () => liste[stelle++];
  const einzeln = () => {
    const token = naechstes();
    if (token === "!") return !einzeln();
    if (token === "(") {
      const innen = oder();
      assert.equal(naechstes(), ")", ausdruck);
      return innen;
    }
    if (token.startsWith("'")) return token.slice(1, -1);
    if (token === "always()") return true;
    assert.ok(!token.endsWith("()"), `unbekannte Funktion ${token}`);
    return nachschlagen(kontext, token);
  };
  const vergleich = () => {
    const links = einzeln();
    if (liste[stelle] !== "==" && liste[stelle] !== "!=") return links;
    const art = naechstes();
    const rechts = einzeln();
    return art === "==" ? links === rechts : links !== rechts;
  };
  const und = () => {
    let links = vergleich();
    while (liste[stelle] === "&&") {
      stelle++;
      const rechts = vergleich();
      links = Boolean(links) && Boolean(rechts);
    }
    return links;
  };
  const oder = () => {
    let links = und();
    while (liste[stelle] === "||") {
      stelle++;
      const rechts = und();
      links = Boolean(links) || Boolean(rechts);
    }
    return links;
  };
  const ergebnis = oder();
  assert.equal(stelle, liste.length, `Rest nicht gelesen: ${ausdruck}`);
  return ergebnis;
}

function auswerten(ausdruck, kontext) {
  return Boolean(wert(ausdruck, kontext));
}

function jobBedingung(datei, job) {
  const zeilen = workflowLines(datei);
  const beginn = zeilen.indexOf(`  ${job}:`);
  assert.notEqual(beginn, -1, `Job ${job} fehlt in ${datei}`);
  const ende = zeilen.findIndex((zeile, index) => index > beginn && /^ {2}\S/.test(zeile));
  const zeile = zeilen.slice(beginn, ende === -1 ? undefined : ende).find((eintrag) => eintrag.startsWith("    if: "));
  assert.ok(zeile, `Job ${job} in ${datei} hat keine einzeilige Bedingung`);
  return zeile.slice("    if: ".length);
}

function gruppe(datei, kontext) {
  const zeilen = workflowLines(datei);
  const beginn = zeilen.indexOf("concurrency:");
  assert.notEqual(beginn, -1, `concurrency fehlt in ${datei}`);
  const block = new Map();
  for (const zeile of zeilen.slice(beginn + 1)) {
    const treffer = /^ {2}([\w-]+): (.*)$/.exec(zeile);
    if (!treffer) break;
    block.set(treffer[1], treffer[2]);
  }
  const abbruch = block.get("cancel-in-progress") ?? "false";
  const ganz = GANZ_AUSDRUCK.exec(abbruch);
  return {
    name: block.get("group").replace(EINGEBETTET, (_, ausdruck) => String(wert(ausdruck, kontext))),
    abbrechen: ganz ? auswerten(ganz[1], kontext) : abbruch === "true",
  };
}

const AUFRAEUMEN = "aufraeumen.yml";
const ZIEL_WEITER = { result: "success", outputs: { ausgang: "weiter" } };
const PRUEFEN_WEITER = { result: "success", outputs: { ausgang: "weiter" } };

const AGENT_FAELLE = [
  { agent: { result: "skipped", outputs: {} }, laeuft: true },
  { agent: { result: "success", outputs: { ausgang: "weiter" } }, laeuft: true },
  { agent: { result: "success", outputs: { ausgang: "stopp" } }, laeuft: false },
  { agent: { result: "failure", outputs: { ausgang: "weiter" } }, laeuft: false },
  { agent: { result: "cancelled", outputs: { ausgang: "weiter" } }, laeuft: false },
  { agent: { result: "failure", outputs: {} }, laeuft: false },
];

test("aufraeumen.yml: Prüfen und PR laufen nur, wenn der Agent übersprungen wurde oder erfolgreich mit Ausgang weiter endete", () => {
  const fall = (job, agent, laeuft) => `${job} bei Agent ${agent.result}/${agent.outputs.ausgang ?? "-"}: ${laeuft ? "läuft" : "läuft nicht"}`;
  const erwartet = [];
  const erhalten = [];
  for (const job of ["pruefen", "pr"]) {
    const bedingung = jobBedingung(AUFRAEUMEN, job);
    for (const { agent, laeuft } of AGENT_FAELLE) {
      const kontext = { needs: { ziel: ZIEL_WEITER, agent, pruefen: PRUEFEN_WEITER } };
      erwartet.push(fall(job, agent, laeuft));
      erhalten.push(fall(job, agent, auswerten(bedingung, kontext)));
    }
  }
  assert.deepEqual(erhalten, erwartet);
});

test("staging.yml: ein Hand-Start teilt keine Nebenläufigkeitsgruppe mit Push-Läufen und bricht nichts ab", () => {
  const push = gruppe("staging.yml", { github: { event_name: "push" } });
  const hand = gruppe("staging.yml", { github: { event_name: "workflow_dispatch" } });
  assert.notEqual(hand.name, push.name);
  assert.equal(push.abbrechen, true);
  assert.equal(hand.abbrechen, false);
});
