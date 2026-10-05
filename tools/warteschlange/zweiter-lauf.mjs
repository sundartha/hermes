import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cwd, env } from "node:process";

import { TEST_NAME_PATTERN } from "../katalog-pruefen.mjs";
import { adresseDiesesLaufs } from "./gleicher-stand.mjs";

const FORMAT = 1;
const GATE_LISTE = "tools/gate-tests.json";
const MASTER = "origin/master:";
const ERGEBNIS = ".pruefung/wackelig.json";
const FUNDSTELLE = /^(.*):\d+:\d+$/;
const TESTDATEI = /\.test\.[cm]?js$/;
const KATALOG_NAME = /^SG-\d{2,}(?!\d)/;
const EXIT_GRUEN = 0;
const EXIT_ROT = 1;
const JSON_EINZUG = 2;
const NAMENSTRENNER = " › ";
const GRUENDE = {
  zweimalRot: "zweimal rot",
  gate: "Safety-Gate-Test, kein zweiter Lauf",
  katalog: "Bedrohungskatalog, kein zweiter Lauf",
  ohneFundstelle: "ohne Fundstelle",
  ohneTest: "rot ohne erkennbaren Test",
  mitgesperrt: "kein zweiter Lauf wegen eines anderen roten Tests",
  zweiterOhneErgebnis: "zweiter Lauf ohne Ergebnis",
  nichtGelaufen: "im zweiten Lauf nicht gelaufen",
  mehrdeutig: "gleichnamiger Test, nicht eindeutig",
};

function ausMaster(pfad, root) {
  const lauf = spawnSync("git", ["show", MASTER + pfad], { cwd: root, encoding: "utf8" });
  return lauf.status === 0 ? lauf.stdout : "";
}

function gateTests(text) {
  return Object.values(JSON.parse(text)).flatMap((gate) => gate.tests ?? []);
}

function gateDateien(root) {
  const master = execFileSync("git", ["show", MASTER + GATE_LISTE], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const arbeitsstand = readFileSync(join(root, GATE_LISTE), "utf8");
  return new Set([...gateTests(arbeitsstand), ...gateTests(master)]);
}

function dateiDer(fehlschlag) {
  const pfad = FUNDSTELLE.exec(fehlschlag.location)?.[1];
  const istTest = pfad !== undefined && TESTDATEI.test(pfad) && pfad !== fehlschlag.name;
  return istTest ? pfad : null;
}

function enthaeltKatalogtest(pfad, root) {
  const texte = [readFileSync(join(root, pfad), "utf8"), ausMaster(pfad, root)];
  return texte.some((text) => [...text.matchAll(TEST_NAME_PATTERN)].length > 0);
}

function sperrgrund(rot, { gates, root }) {
  if (rot.datei === null || !existsSync(join(root, rot.datei))) return GRUENDE.ohneFundstelle;
  if (gates.has(rot.datei)) return GRUENDE.gate;
  if (KATALOG_NAME.test(rot.name) || enthaeltKatalogtest(rot.datei, root)) {
    return GRUENDE.katalog;
  }
  return null;
}

function commitDesLaufs(root) {
  if (env.GITHUB_SHA) return env.GITHUB_SHA;
  const kopf = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  return kopf.status === 0 ? kopf.stdout.trim() : null;
}

function halteFest(root, { wackelig, rot }) {
  const pfad = join(root, ERGEBNIS);
  mkdirSync(dirname(pfad), { recursive: true });
  const inhalt = {
    format: FORMAT,
    commit: commitDesLaufs(root),
    lauf: adresseDiesesLaufs(),
    wackelig: wackelig.map(({ datei, test }) => ({ datei, test })),
    rot: rot.map(({ datei, test, grund }) => ({ datei, test, grund })),
  };
  writeFileSync(pfad, `${JSON.stringify(inhalt, null, JSON_EINZUG)}\n`);
  for (const { datei, test } of wackelig) {
    console.log(`Wackelig (im zweiten Lauf grün): ${datei} › ${test}`);
  }
  for (const { datei, test, grund } of rot) {
    console.log(`Rot (${grund}): ${datei ?? "ohne Datei"} › ${test ?? "ohne Testnamen"}`);
  }
  return { code: rot.length === 0 ? EXIT_GRUEN : EXIT_ROT, wiederGruen: wackelig.length };
}

function mitGrund(rote, grund) {
  return rote.map((rot) => ({ ...rot, grund: rot.grund ?? grund }));
}

function ohneZweitenLauf(rote, umfeld) {
  const ohneTest = { datei: null, test: null, grund: GRUENDE.ohneTest };
  if (!umfeld.vollstaendig || rote.length === 0) {
    return [ohneTest, ...mitGrund(rote, GRUENDE.mitgesperrt)];
  }
  const gesperrt = rote.map((rot) => ({ ...rot, grund: sperrgrund(rot, umfeld) }));
  if (gesperrt.every(({ grund }) => grund === null)) return null;
  return mitGrund(gesperrt, GRUENDE.mitgesperrt);
}

function kennung({ datei, path }) {
  return JSON.stringify([datei, ...path]);
}

function grundNachZweitemLauf(rot, tapText, { ergebnisse, mitErgebnis }) {
  if (!mitErgebnis(tapText)) return GRUENDE.zweiterOhneErgebnis;
  const gesucht = kennung(rot);
  const gleiche = ergebnisse(tapText).filter(
    ({ path }) => kennung({ datei: rot.datei, path }) === gesucht,
  );
  if (gleiche.length === 0) return GRUENDE.nichtGelaufen;
  if (gleiche.length > 1) return GRUENDE.mehrdeutig;
  return gleiche[0].passed ? null : GRUENDE.zweimalRot;
}

function auswerten(rote, protokolle, werkzeuge) {
  const kennungen = rote.map(kennung);
  const bewertet = rote.map((rot, index) => {
    const doppelt = kennungen.indexOf(kennungen[index]) !== kennungen.lastIndexOf(kennungen[index]);
    const grund = doppelt
      ? GRUENDE.mehrdeutig
      : grundNachZweitemLauf(rot, protokolle.get(rot.datei), werkzeuge);
    return { ...rot, grund };
  });
  return {
    wackelig: bewertet.filter(({ grund }) => grund === null),
    rot: bewertet.filter(({ grund }) => grund !== null),
  };
}

async function nachlaufen(rote, werkzeuge) {
  const dateien = [...new Set(rote.map(({ datei }) => datei))].sort();
  const laeufe = await Promise.all(
    dateien.map((datei, index) => werkzeuge.nachlaufen(datei, index + 1)),
  );
  return new Map(dateien.map((datei, index) => [datei, laeufe[index].tapText]));
}

export async function zweiterLauf(erster, werkzeuge, root = cwd()) {
  const rote = werkzeuge
    .fehlschlaege(erster.tapText)
    .map((rot) => ({
      ...rot,
      datei: dateiDer(rot),
      test: rot.path.join(NAMENSTRENNER),
      grund: null,
    }));
  const vollstaendig = werkzeuge.vollstaendigRot(erster.tapText);
  const umfeld = { vollstaendig, gates: vollstaendig ? gateDateien(root) : new Set(), root };
  const gesperrt = ohneZweitenLauf(rote, umfeld);
  if (gesperrt !== null) return halteFest(root, { wackelig: [], rot: gesperrt });
  const protokolle = await nachlaufen(rote, werkzeuge);
  return halteFest(root, auswerten(rote, protokolle, werkzeuge));
}
