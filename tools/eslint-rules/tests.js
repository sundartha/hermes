import { basename } from "node:path";

import anfrageMitFrist from "./anfrage-mit-frist.js";
import festerImportpfad from "./fester-importpfad.js";
import keineSelbstpruefung from "./keine-selbstpruefung.js";
import keineSpeicherAttrappe from "./keine-speicher-attrappe.js";
import { pfadInDerWurzel } from "./bestand.js";
import { alleKnoten, festerText, nachAnfang, zugriffsName } from "./knoten.js";

const MELDUNG =
  "Ein Test startet sich selbst: spawn/exec/fork mit dem eigenen Dateinamen, oder node --test ohne feste andere Datei (das trifft dann auch diese Datei). Ein Muster wie --test-name-pattern schützt nicht, sobald es den aufrufenden Test trifft; das hat am 13.11. 1.220 Prozesse und 20 GB erzeugt. Teste das Kind in einer eigenen, festen Fixture-Datei, oder nimm für ein Kriterium dieser Datei kriteriumLauf aus test/gemeinsam/kriterium-lauf.mjs.";
const STARTER = new Set(["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]);
const EIGENE_NAMEN = new Set(["__filename"]);
const TESTLAUF = /(^|\s)--test(\s|=|$)/;
const DATEI = /\.[cm]?[jt]s\b/;
const EBENEN = 3;

function aufrufName(aufruf) {
  const { callee } = aufruf;
  if (callee.type === "Identifier") return callee.name;
  return callee.type === "MemberExpression" ? zugriffsName(callee) : undefined;
}

function wert(sourceCode, knoten) {
  if (knoten?.type !== "Identifier") return knoten;
  for (let scope = sourceCode.getScope(knoten); scope; scope = scope.upper) {
    const variable = scope.set.get(knoten.name);
    if (variable === undefined) continue;
    const [definition, ...weitere] = variable.defs;
    const fest = weitere.length === 0 && definition?.kind === "const";
    return fest && definition.node.init ? definition.node.init : knoten;
  }
  return knoten;
}

function sammler(sourceCode) {
  const texte = [];
  const zustand = { eigen: false, unbekannt: false };
  function sammle(knoten, tiefe = 0) {
    const ziel = wert(sourceCode, knoten);
    if (ziel === undefined || tiefe > EBENEN) return;
    const text = festerText(ziel);
    if (text !== undefined) texte.push(text);
    else if (istEigenerName(ziel)) zustand.eigen = true;
    else weiter(ziel, tiefe + 1);
  }
  function weiter(ziel, tiefe) {
    if (ziel.type === "ArrayExpression") ziel.elements.forEach((element) => sammle(element, tiefe));
    else if (ziel.type === "TemplateLiteral") {
      texte.push(...ziel.quasis.map((teil) => teil.value.cooked));
      ziel.expressions.forEach((ausdruck) => sammle(ausdruck, tiefe));
    } else if (istExecPath(ziel)) return;
    else if (ziel.type === "SpreadElement") sammle(ziel.argument, tiefe);
    else if (ziel.type === "CallExpression" && aufrufName(ziel) === "fileURLToPath") sammle(ziel.arguments[0], tiefe);
    else zustand.unbekannt = true;
  }
  return { texte, zustand, sammle };
}

function istEigenerName(ziel) {
  if (ziel.type === "Identifier") return EIGENE_NAMEN.has(ziel.name);
  if (ziel.type !== "MemberExpression") return false;
  if (ziel.object.type === "MetaProperty") return ["url", "filename"].includes(zugriffsName(ziel));
  return isProcessArgv(ziel.object) && ziel.property.value === 1;
}

function istExecPath(ziel) {
  return ziel.type === "MemberExpression" && ziel.object.name === "process" && zugriffsName(ziel) === "execPath";
}

function isProcessArgv(knoten) {
  return knoten.type === "MemberExpression" && knoten.object.type === "Identifier" && knoten.object.name === "process" && zugriffsName(knoten) === "argv";
}

function nennt(texte, datei) {
  const name = basename(datei);
  return texte.some((text) => text.includes(datei) || text.endsWith(`/${name}`) || text === name);
}

function selbstaufrufe(sourceCode, datei) {
  return alleKnoten(sourceCode)
    .filter((knoten) => knoten.type === "CallExpression" && STARTER.has(aufrufName(knoten)))
    .filter((aufruf) => {
      const { texte, zustand, sammle } = sammler(sourceCode);
      aufruf.arguments.forEach((arg) => sammle(arg));
      if (zustand.eigen || nennt(texte, datei)) return true;
      const ganz = texte.join(" ");
      return TESTLAUF.test(ganz) && !DATEI.test(ganz) && !zustand.unbekannt;
    })
    .sort(nachAnfang);
}

const keineSelbstaufruf = {
  meta: { type: "problem", schema: [], messages: { selbst: MELDUNG } },
  create(context) {
    return {
      Program() {
        const datei = pfadInDerWurzel(context.cwd, context.filename);
        for (const aufruf of selbstaufrufe(context.sourceCode, datei)) context.report({ node: aufruf, messageId: "selbst" });
      },
    };
  },
};

export default {
  meta: { name: "hermes-tests" },
  rules: {
    "keine-selbstaufruf": keineSelbstaufruf,
    "keine-selbstpruefung": keineSelbstpruefung,
    "fester-importpfad": festerImportpfad,
    "anfrage-mit-frist": anfrageMitFrist,
    "keine-speicher-attrappe": keineSpeicherAttrappe,
  },
};
