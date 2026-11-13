import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, posix } from "node:path";
import { pathToFileURL } from "node:url";

const KARTE = "tools/bausteine.json";
const BEREICHE = "tools/bereiche.json";
const HINWEISE = "tools/hinweise-erzeugen.mjs";
const NAME = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
const EXIT_FEHLER = 1;
const EINRUECKUNG = 2;
const ARGUMENTE_AB = 2;
const ZEILE = "\n";
const ARTEN = ["route", "fachdatei", "test"];
const KOPF_REGEL = /^\^(src\/[\w/.-]+?)\\\.\[jt\]s\$$/;
const BEGRIFF = /^export const (\w+)/m;
const GRUPPE = /\(([^)|]+)(?:\|[^)]*)?\)/g;

const ROUTE = `import { Router } from "express";
import { z } from "zod";
import { pruefeKoerper } from "../utils/eingabe-pruefen.js";
import { HTTP_NOT_FOUND, antworteFehler } from "../utils/http.js";

export const %KONSTANTE%_PATH = "/api/%NAME%";

const NICHT_GEBAUT = "not_implemented";

const KOERPER = z.object({}).strict();

export function make%PASCAL%Routes({ webAuthMw }) {
  const router = Router();

  router.post(%KONSTANTE%_PATH, webAuthMw, (req, res) => {
    if (pruefeKoerper(res, { schema: KOERPER }, req.body) === undefined) return;
    antworteFehler(res, HTTP_NOT_FOUND, NICHT_GEBAUT);
  });

  return router;
}
`;

const FACHDATEI = `import { %BEGRIFF% } from "%ZU_BEGRIFFEN%";
import { anfrage } from "%ZU_ANFRAGE%";
import { MS_PER_SECOND } from "%ZU_TIMER%";

const FRIST_SEKUNDEN = 10;
const FRIST_MS = FRIST_SEKUNDEN * MS_PER_SECOND;

export const %KONSTANTE%_BEGRIFF = %BEGRIFF%;

export async function hole%PASCAL%(url, { signal } = {}) {
  const antwort = await anfrage(url, { fristMs: FRIST_MS, signal });
  return antwort.json();
}
`;

const TEST = `import assert from "node:assert/strict";
import { test } from "node:test";

import * as eingang from "%ZUM_EINGANG%";

test("%NAME%: der Eingang des Bereichs stellt Funktionen bereit", () => {
  assert.ok(Object.keys(eingang).length > 0);
});
`;

class Abbruch extends Error {}

function lies(wurzel, datei) {
  return JSON.parse(readFileSync(join(wurzel, datei), "utf8"));
}

function ausfuellen(vorlage, werte) {
  return Object.entries(werte).reduce((text, [schluessel, wert]) => text.replaceAll(`%${schluessel}%`, wert), vorlage);
}

function pascal(name) {
  return name.split("-").map((teil) => teil[0].toUpperCase() + teil.slice(1)).join("");
}

function relativ(von, nach) {
  const weg = posix.relative(dirname(von), nach);
  return weg.startsWith(".") ? weg : `./${weg}`;
}

function eingangsDatei(wurzel, regel) {
  const treffer = KOPF_REGEL.exec(regel.replace(GRUPPE, "$1"));
  if (!treffer) return undefined;
  return [`${treffer[1]}.js`, `${treffer[1]}.ts`].find((pfad) => existsSync(join(wurzel, pfad)));
}

function karteneintrag(karte, baustein) {
  const eintrag = karte.bausteine.find((kandidat) => kandidat.baustein === baustein);
  if (!eintrag) throw new Abbruch(`Unbekannter Baustein ${baustein}; er steht nicht in ${KARTE}.`);
  return eintrag;
}

function planeRoute(wurzel, baustein, name) {
  karteneintrag(lies(wurzel, KARTE), baustein);
  const datei = `src/routes/${name}.js`;
  const werte = { NAME: name, PASCAL: pascal(name), KONSTANTE: name.toUpperCase().replaceAll("-", "_") };
  return { datei, inhalt: ausfuellen(ROUTE, werte), karte: { baustein, eingang: true } };
}

function planeFachdatei(wurzel, baustein, name) {
  const [ordner] = karteneintrag(lies(wurzel, KARTE), baustein).quellen.filter((quelle) => quelle.endsWith("/"));
  if (!ordner) throw new Abbruch(`Der Baustein ${baustein} hat in ${KARTE} keinen Ordner für neue Dateien.`);
  const datei = `${ordner}${name}.js`;
  const begriffe = `src/begriffe/${baustein}.js`;
  const begriff = existsSync(join(wurzel, begriffe)) && BEGRIFF.exec(readFileSync(join(wurzel, begriffe), "utf8"));
  if (!begriff) throw new Abbruch(`Der Baustein ${baustein} hat keine ${begriffe} mit einem Begriff.`);
  const werte = {
    PASCAL: pascal(name),
    KONSTANTE: name.toUpperCase().replaceAll("-", "_"),
    BEGRIFF: begriff[1],
    ZU_BEGRIFFEN: relativ(datei, begriffe),
    ZU_ANFRAGE: relativ(datei, "src/utils/anfrage.js"),
    ZU_TIMER: relativ(datei, "src/utils/timer.js"),
  };
  return { datei, inhalt: ausfuellen(FACHDATEI, werte), karte: { baustein, eingang: false } };
}

function planeTest(wurzel, bereich, name) {
  const eintrag = lies(wurzel, BEREICHE).find((kandidat) => kandidat.bereich === bereich);
  if (!eintrag) throw new Abbruch(`Unbekannter Bereich ${bereich}; er steht nicht in ${BEREICHE}.`);
  const datei = `test/${bereich}/${name}.test.js`;
  const eingang = [...eintrag.eingaenge, ...eintrag.fachlogik].map((regel) => eingangsDatei(wurzel, regel)).find(Boolean);
  if (!eingang) throw new Abbruch(`Der Bereich ${bereich} hat in ${BEREICHE} keinen Eingang, über den ein Test laufen kann.`);
  return { datei, inhalt: ausfuellen(TEST, { NAME: name, ZUM_EINGANG: relativ(datei, eingang) }) };
}

const PLANER = { route: planeRoute, fachdatei: planeFachdatei, test: planeTest };

function einrueckung(text, stelle) {
  const zeilen = text.slice(0, stelle).split(ZEILE);
  const letzte = zeilen[zeilen.length - 1];
  return letzte.replace(/\S.*/, "");
}

function eintragen(text, ziel, pfad) {
  const { baustein, schluessel } = ziel;
  const anfang = text.indexOf(`"baustein": "${baustein}"`);
  const stelle = text.indexOf(`"${schluessel}": [`, anfang);
  if (stelle === -1) return text;
  const innen = stelle + `"${schluessel}": [`.length;
  const ende = text.indexOf("]", innen);
  const liste = JSON.parse(`[${text.slice(innen, ende)}]`);
  if (liste.includes(pfad)) return text;
  const mehrzeilig = text.slice(innen, ende).includes(ZEILE);
  const rand = einrueckung(text, stelle);
  const alle = [...liste, pfad].map((eintrag) => JSON.stringify(eintrag));
  const zeilen = alle.map((eintrag) => `${rand}${" ".repeat(EINRUECKUNG)}${eintrag}`);
  const neu = mehrzeilig ? `${ZEILE}${zeilen.join(`,${ZEILE}`)}${ZEILE}${rand}` : alle.join(", ");
  return text.slice(0, innen) + neu + text.slice(ende);
}

function inKarte(wurzel, { datei, karte: { baustein, eingang } }) {
  const pfad = join(wurzel, KARTE);
  const roh = JSON.parse(readFileSync(pfad, "utf8"));
  const ordner = karteneintrag(roh, baustein).quellen.filter((quelle) => quelle.endsWith("/"));
  let text = readFileSync(pfad, "utf8");
  if (!ordner.some((anfang) => datei.startsWith(anfang))) text = eintragen(text, { baustein, schluessel: "quellen" }, datei);
  if (eingang) text = eintragen(text, { baustein, schluessel: "eingaenge" }, datei);
  writeFileSync(pfad, text);
}

function lesen(argv) {
  const stelle = argv.indexOf("--wurzel");
  const wurzel = stelle === -1 ? process.cwd() : argv[stelle + 1];
  const rest = stelle === -1 ? argv : argv.filter((ignoriert, index) => index !== stelle && index !== stelle + 1);
  const [art, ziel, name] = rest;
  if (!ARTEN.includes(art) || !ziel || !name) {
    throw new Abbruch(`Aufruf: npm run neu -- <${ARTEN.join("|")}> <baustein oder bereich> <name>`);
  }
  if (!NAME.test(name)) throw new Abbruch(`Der Name ${name} muss klein geschrieben und mit Bindestrichen getrennt sein.`);
  return { wurzel, art, ziel, name };
}

export function neu(argv) {
  const { wurzel, art, ziel, name } = lesen(argv);
  const plan = PLANER[art](wurzel, ziel, name);
  if (existsSync(join(wurzel, plan.datei))) throw new Abbruch(`${plan.datei} gibt es schon.`);
  mkdirSync(join(wurzel, dirname(plan.datei)), { recursive: true });
  writeFileSync(join(wurzel, plan.datei), plan.inhalt);
  if (plan.karte) {
    inKarte(wurzel, plan);
    spawnSync(process.execPath, [join(wurzel, HINWEISE)], { cwd: wurzel, stdio: "inherit" });
  }
  return plan.datei;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(`${neu(process.argv.slice(ARGUMENTE_AB))} angelegt.`);
  } catch (fehler) {
    if (!(fehler instanceof Abbruch)) throw fehler;
    console.error(fehler.message);
    process.exitCode = EXIT_FEHLER;
  }
}
