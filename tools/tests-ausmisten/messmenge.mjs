import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { chdir, cwd } from "node:process";

import { cruise } from "dependency-cruiser";

import { git, quellenDesBereichs, testpfadFrei } from "./pfade.mjs";

export const TESTDATEI = /^test\/.+\.test\.[cm]?js$/;
const QUELLDATEI = /^src\/.+\.[cm]?js$/;
const TESTHILFE = /^test\//;
const WURZELN = ["src", "test"];
const OPTIONEN = { doNotFollow: { path: "node_modules" }, moduleSystems: ["es6", "cjs"] };
const KEIN_TREFFER = 1;
const QUELLE_IN_TEXT = /["'`][^"'`\n]*?\bsrc\/([\w./-]+\.[cm]?js)(?=["'`?#])/g;
const MAX_GIT_AUSGABE = 268_435_456;

export async function importgraph() {
  const { output } = await cruise(WURZELN, OPTIONEN);
  const importe = new Map();
  const importierer = new Map();
  for (const { source, dependencies } of output.modules) {
    const ziele = dependencies.map(({ resolved }) => resolved);
    importe.set(source, ziele);
    for (const ziel of ziele) importierer.set(ziel, [...(importierer.get(ziel) ?? []), source]);
  }
  return { importe, importierer };
}

export async function imStand(commit, aufgabe) {
  const vorher = cwd();
  const ordner = mkdtempSync(join(tmpdir(), "ausmisten-stand-"));
  git(["worktree", "add", "--detach", "-q", ordner, commit], vorher);
  chdir(ordner);
  try {
    return await aufgabe();
  } finally {
    chdir(vorher);
    git(["worktree", "remove", "--force", ordner], vorher);
    rmSync(ordner, { recursive: true, force: true });
  }
}

export function graphImStand(commit) {
  return imStand(commit, importgraph);
}

function quelldateien(graph) {
  const module = [...graph.importe.keys()];
  return module.filter((datei) => QUELLDATEI.test(datei)).sort();
}

export function erreichendeTests(datei, graph) {
  const erreicht = new Set([datei]);
  for (const ziel of erreicht) {
    for (const quelle of graph.importierer.get(ziel) ?? []) erreicht.add(quelle);
  }
  return [...erreicht].filter((pfad) => TESTDATEI.test(pfad)).sort();
}

function erwaehnende(namen, rev) {
  if (namen.length === 0) return [];
  const muster = [...new Set(namen)].flatMap((name) => ["-e", name]);
  const args = [
    "-c",
    "core.quotePath=false",
    "grep",
    "-l",
    "-z",
    "-F",
    ...muster,
    rev,
    "--",
    "test/",
  ];
  const lauf = spawnSync("git", args, { encoding: "utf8", maxBuffer: MAX_GIT_AUSGABE });
  if (lauf.status === KEIN_TREFFER) return [];
  if (lauf.status !== 0) throw new Error(`git grep in ${rev}: ${lauf.stderr.trim()}`);
  const eintraege = lauf.stdout.split("\0").filter(Boolean);
  return eintraege.map((eintrag) => eintrag.slice(rev.length + 1));
}

function abhaengige(startpfade, sicht) {
  const menge = new Set(startpfade);
  let rand = [...startpfade];
  while (rand.length > 0) {
    const durchImport = rand.flatMap((pfad) => sicht.graph.importierer.get(pfad) ?? []);
    const hilfen = rand.filter((pfad) => !TESTDATEI.test(pfad)).map((pfad) => basename(pfad));
    const kandidaten = [...durchImport, ...erwaehnende(hilfen, sicht.rev)];
    rand = [...new Set(kandidaten)].filter((pfad) => testpfadFrei(pfad) && !menge.has(pfad));
    for (const pfad of rand) menge.add(pfad);
  }
  return menge;
}

export function geaenderteTestdateien(geaendert, sicht) {
  const { importe } = sicht.graph;
  const menge = [...abhaengige(geaendert, sicht)];
  return menge.filter((pfad) => TESTDATEI.test(pfad) && importe.has(pfad)).sort();
}

function direkteQuellen(startpfade, graph) {
  const besucht = new Set(startpfade);
  const quellen = new Set();
  for (const datei of besucht) {
    for (const ziel of graph.importe.get(datei) ?? []) {
      if (QUELLDATEI.test(ziel)) quellen.add(ziel);
      else if (TESTHILFE.test(ziel)) besucht.add(ziel);
    }
  }
  return { quellen: [...quellen], besucht: [...besucht].sort() };
}

function inhaltIm(rev, pfad) {
  const lauf = spawnSync("git", ["show", `${rev}:${pfad}`], {
    encoding: "utf8",
    maxBuffer: MAX_GIT_AUSGABE,
  });
  return lauf.status === 0 ? lauf.stdout : "";
}

function genannteQuellen(pfade, { rev, vorhanden }) {
  const genannt = pfade.flatMap((pfad) =>
    [...inhaltIm(rev, pfad).matchAll(QUELLE_IN_TEXT)].map(([, quelle]) => `src/${quelle}`),
  );
  return genannt.filter((quelle) => vorhanden.has(quelle));
}

export function messmenge({ bereich, bereiche, geaendert, alt }) {
  const tests = geaenderteTestdateien(geaendert, alt);
  const hilfen = geaendert.filter((pfad) => !TESTDATEI.test(pfad));
  const { quellen, besucht } = direkteQuellen([...tests, ...hilfen], alt.graph);
  const alleQuellen = quelldateien(alt.graph);
  const genannt = genannteQuellen(besucht, { rev: alt.rev, vorhanden: new Set(alleQuellen) });
  const eigene = quellenDesBereichs(bereich, bereiche, alleQuellen);
  const dateien = [...new Set([...eigene, ...quellen, ...genannt])].sort();
  return { dateien, alt: tests, beobachtet: besucht };
}
