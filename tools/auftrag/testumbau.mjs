import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { TEST_FILE, dependentsGraph, testsReaching } from "../testgraph.mjs";

import { EXIT_GRUEN, EXIT_ROT } from "./befehle.mjs";
import { laufe } from "./faelle.mjs";
import { istTestdatei } from "./format.mjs";
import { NUL, git, legeWorktreeAn } from "./git.mjs";
import { aenderungsReichweite, direkteImporteure, nenntDatei, testsInReichweite } from "./reichweite.mjs";

export const ENTFERNT = "Entfernt: ";
const KEIN_TREFFER = 1;
const MODULE = "node_modules";

export function beruehrteTestdateienSamtHilfen(basis, root) {
  const verfolgt = git(["diff", "--name-only", "--no-renames", "-z", basis], { cwd: root }).split(NUL);
  const neu = git(["ls-files", "--others", "--exclude-standard", "-z"], { cwd: root }).split(NUL);
  return [...new Set([...verfolgt, ...neu])].filter((pfad) => pfad !== "" && istTestdatei(pfad)).sort();
}

function erwaehnende(pfad, wurzel) {
  const lauf = spawnSync("git", ["grep", "-l", "-z", "--untracked", "-F", basename(pfad), "--", "test/"], { cwd: wurzel, encoding: "utf8" });
  if (lauf.status === KEIN_TREFFER) return [];
  if (lauf.status !== 0) throw new Error(`git grep ${basename(pfad)}: ${lauf.stderr.trim()}`);
  return lauf.stdout.split(NUL).filter((datei) => TEST_FILE.test(datei));
}

function erreichteTests(pfad, { graph, wurzel, reichweite }) {
  const eintrag = reichweite[pfad];
  if (eintrag === undefined || eintrag.alle || TEST_FILE.test(pfad)) return [pfad, ...testsReaching(pfad, graph), ...erwaehnende(pfad, wurzel)];
  const direkte = new Set(direkteImporteure(graph, pfad));
  const genannt = erwaehnende(pfad, wurzel).filter((test) => !direkte.has(test) && nenntDatei(readFileSync(join(wurzel, test), "utf8"), pfad));
  return [...testsInReichweite(pfad, eintrag, { graph, wurzel }), ...genannt];
}

function jeDatei(geaendert, kontext) {
  return new Map(geaendert.map((pfad) => {
    const erreicht = erreichteTests(pfad, kontext);
    return [pfad, [...new Set(erreicht)].filter((test) => TEST_FILE.test(test) && existsSync(join(kontext.wurzel, test))).sort()];
  }));
}

export async function testsJeDatei(geaendert, wurzel, reichweite = {}) {
  return jeDatei(geaendert, { graph: await dependentsGraph(wurzel), wurzel, reichweite });
}

async function genauUndBreit(geaendert, wurzel, reichweite) {
  const graph = await dependentsGraph(wurzel);
  return { genau: jeDatei(geaendert, { graph, wurzel, reichweite }), breit: jeDatei(geaendert, { graph, wurzel, reichweite: {} }) };
}

export async function betroffeneTests(geaendert, wurzel, reichweite = {}) {
  return vereint(await testsJeDatei(geaendert, wurzel, reichweite));
}

export async function imAltenStand(basis, root, arbeit) {
  const ordner = mkdtempSync(join(tmpdir(), "testumbau-"));
  const entferne = legeWorktreeAn(basis, ordner, root);
  try {
    if (existsSync(join(root, MODULE))) symlinkSync(join(root, MODULE), join(ordner, MODULE));
    return await arbeit(ordner);
  } finally {
    entferne();
    rmSync(ordner, { recursive: true, force: true });
  }
}

function messe(dateien, wurzel) {
  return new Map(dateien.map((datei) => [datei, laufe(wurzel, datei)]));
}

function rotBefunde(stand, wann) {
  return [...stand].flatMap(([datei, { faelle, dateiRot }]) => {
    const rot = faelle.filter((fall) => fall.rot).map(({ name }) => `${datei}: Der Fall „${name}“ ist ${wann} dem Umbau rot.`);
    return rot.length === 0 && dateiRot ? [`${datei} ist ${wann} dem Umbau rot.`] : rot;
  });
}

function aktive(faelle) {
  return faelle.filter(({ still }) => !still);
}

function entfernteFaelle(vorher, nachher) {
  return [...vorher].flatMap(([datei, { faelle }]) => {
    const uebrig = aktive(nachher.get(datei)?.faelle ?? []).map(({ name }) => name);
    return aktive(faelle).filter(({ name }) => {
      const stelle = uebrig.indexOf(name);
      if (stelle !== -1) uebrig.splice(stelle, 1);
      return stelle === -1;
    }).map(({ name }) => ({ datei, name }));
  });
}

function ohneWirkung(geaendert, vorher, nachher) {
  if (geaendert.length === 0) return ["Der Testumbau hat keine Testdatei geändert."];
  const unerreicht = geaendert.filter((pfad) => vorher.get(pfad).length === 0 && nachher.get(pfad).length === 0);
  return unerreicht.map((pfad) => `Kein ausführbarer Test erreicht die geänderte Datei ${pfad}; ihre Wirkung ist nicht messbar.`);
}

function vereint(jeDatei) {
  return [...new Set([...jeDatei.values()].flat())].sort();
}

export async function testumbauFaelle({ basis, root }) {
  const geaendert = beruehrteTestdateienSamtHilfen(basis, root);
  const reichweite = aenderungsReichweite(basis, geaendert, root);
  const alt = await imAltenStand(basis, root, async (ordner) => {
    const { genau, breit } = await genauUndBreit(geaendert, ordner, reichweite);
    return { breit, stand: messe(vereint(genau), ordner) };
  });
  const { genau: jeDatei, breit } = await genauUndBreit(geaendert, root, reichweite);
  const vorher = alt.stand;
  const nachher = messe(vereint(jeDatei), root);
  const alle = [...new Set([...vorher.keys(), ...nachher.keys()])];
  const befunde = [...ohneWirkung(geaendert, alt.breit, breit), ...rotBefunde(vorher, "vor"), ...rotBefunde(nachher, "nach")];
  const entfernt = entfernteFaelle(vorher, nachher);
  for (const befund of befunde) console.log(`Verstoß: ${befund}`);
  for (const { datei, name } of entfernt) console.log(`${ENTFERNT}${datei}: ${name}`);
  const urteil = befunde.length === 0 ? "grün" : "rot";
  console.log(`${urteil}: ${geaendert.length} Testdateien geändert, ${alle.length} betroffene Testdateien vor und nach dem Umbau gelaufen, ${entfernt.length} Fälle entfernt, ${befunde.length} Befunde.`);
  return befunde.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}
