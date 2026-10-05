import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cwd, env } from "node:process";

import { TEST_NAME_PATTERN } from "../katalog-pruefen.mjs";

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
const GRUENDE = {
  zweimalRot: "zweimal rot",
  gate: "Safety-Gate-Test, kein zweiter Lauf",
  katalog: "Bedrohungskatalog, kein zweiter Lauf",
  ohneFundstelle: "ohne Fundstelle",
  ohneTest: "rot ohne erkennbaren Test",
  mitgesperrt: "kein zweiter Lauf wegen eines anderen roten Tests",
  zweiterOhneErgebnis: "zweiter Lauf ohne Ergebnis",
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

function adresseDesLaufs() {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: lauf } = env;
  return server && repo && lauf ? `${server}/${repo}/actions/runs/${lauf}` : null;
}

function halteFest(root, { wackelig, rot }) {
  const pfad = join(root, ERGEBNIS);
  mkdirSync(dirname(pfad), { recursive: true });
  const inhalt = {
    format: FORMAT,
    commit: commitDesLaufs(root),
    lauf: adresseDesLaufs(),
    wackelig: wackelig.map(({ datei, name }) => ({ datei, test: name })),
    rot: rot.map(({ datei, name, grund }) => ({ datei, test: name, grund })),
  };
  writeFileSync(pfad, `${JSON.stringify(inhalt, null, JSON_EINZUG)}\n`);
  for (const { datei, name } of wackelig) {
    console.log(`Wackelig (im zweiten Lauf grün): ${datei} › ${name}`);
  }
  for (const { datei, name, grund } of rot) console.log(`Rot (${grund}): ${datei} › ${name}`);
  return { code: rot.length === 0 ? EXIT_GRUEN : EXIT_ROT, wiederGruen: wackelig.length };
}

function mitGrund(rote, grund) {
  return rote.map((rot) => ({ ...rot, grund: rot.grund ?? grund }));
}

function ohneZweitenLauf(rote, umfeld) {
  const ohneTest = { datei: null, name: null, grund: GRUENDE.ohneTest };
  if (!umfeld.vollstaendig || rote.length === 0) {
    return [ohneTest, ...mitGrund(rote, GRUENDE.mitgesperrt)];
  }
  const gesperrt = rote.map((rot) => ({ ...rot, grund: sperrgrund(rot, umfeld) }));
  if (gesperrt.every(({ grund }) => grund === null)) return null;
  return mitGrund(gesperrt, GRUENDE.mitgesperrt);
}

function auswerten(rote, zweiter, { fehlschlaege, bestanden, mitErgebnis }) {
  if (!mitErgebnis(zweiter.tapText)) {
    return { wackelig: [], rot: mitGrund(rote, GRUENDE.zweiterOhneErgebnis) };
  }
  const nochRot = new Set(fehlschlaege(zweiter.tapText).map(({ name }) => name));
  const gruen = new Set(bestanden(zweiter.tapText).map(({ name }) => name));
  const wiederGruen = ({ name }) => gruen.has(name) && !nochRot.has(name);
  return {
    wackelig: rote.filter(wiederGruen),
    rot: mitGrund(
      rote.filter((rot) => !wiederGruen(rot)),
      GRUENDE.zweimalRot,
    ),
  };
}

export async function zweiterLauf(erster, werkzeuge, root = cwd()) {
  const rote = werkzeuge
    .fehlschlaege(erster.tapText)
    .map((rot) => ({ ...rot, datei: dateiDer(rot), grund: null }));
  const vollstaendig = werkzeuge.vollstaendigRot(erster.tapText);
  const umfeld = { vollstaendig, gates: vollstaendig ? gateDateien(root) : new Set(), root };
  const gesperrt = ohneZweitenLauf(rote, umfeld);
  if (gesperrt !== null) return halteFest(root, { wackelig: [], rot: gesperrt });
  const zweiter = await werkzeuge.nachlaufen([...new Set(rote.map(({ datei }) => datei))].sort());
  return halteFest(root, auswerten(rote, zweiter, werkzeuge));
}
