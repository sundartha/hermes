import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { chdir, cwd } from "node:process";

import { cruise } from "dependency-cruiser";

import { MESSBAR } from "./entscheiden.mjs";
import { dynamischeZiele, syntaxknoten } from "./importe.mjs";
import {
  QUELLDATEI,
  git,
  gitGelingt,
  gitLauf,
  quellenDesBereichs,
  testpfadFrei,
} from "./pfade.mjs";

export const TESTDATEI = /^test\/.+\.test\.[cm]?[jt]s$/;
const TESTHILFE = /^test\//;
const WURZELN = ["src", "test"];
const OPTIONEN = { doNotFollow: { path: "node_modules" }, moduleSystems: ["es6", "cjs"] };
const KEIN_TREFFER = 1;
const QUELLE_IN_TEXT = /["'`][^"'`\n]*?\bsrc\/([\w./-]+\.[cm]?[jt]s)(?=["'`?#])/g;
const WERKZEUGPFAD = /^(?:tools|scripts)\//;
const WERKZEUG_DATEI_IN_TEXT =
  /(?:^|[^\w-])((?:tools|scripts)\/[\w./-]*\.(?:mjs|cjs|js|mts|cts|ts|sh|json))\b/g;
const SKRIPT = /\.[cm]?[jt]s$/;
const EIGENES_MODUL = /^(?:src|test)\/.+\.[cm]?[jt]s$/;

export async function importgraph(ordner = cwd()) {
  const { output } = await cruise(WURZELN, { ...OPTIONEN, baseDir: realpathSync(ordner) });
  const importe = new Map();
  const importierer = new Map();
  for (const { source, dependencies } of output.modules) {
    const statisch = dependencies.map(({ resolved }) => resolved);
    const dynamisch = EIGENES_MODUL.test(source) ? dynamischeZiele(source, ordner) : [];
    const ziele = [...new Set([...statisch, ...dynamisch])];
    importe.set(source, ziele);
    for (const ziel of ziele) importierer.set(ziel, [...(importierer.get(ziel) ?? []), source]);
  }
  return { importe, importierer };
}

async function imWorktree(commit, aufgabe, repo = cwd()) {
  const ordner = mkdtempSync(join(tmpdir(), "ausmisten-stand-"));
  git(["worktree", "add", "--detach", "-q", ordner, commit], repo);
  try {
    return await aufgabe(ordner);
  } finally {
    git(["worktree", "remove", "--force", ordner], repo);
    rmSync(ordner, { recursive: true, force: true });
  }
}

export function imStand(commit, aufgabe) {
  return imWorktree(commit, async (ordner) => {
    const vorher = cwd();
    chdir(ordner);
    try {
      return await aufgabe();
    } finally {
      chdir(vorher);
    }
  });
}

export function graphImStand(commit, repo = cwd()) {
  return imWorktree(commit, importgraph, repo);
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

export function erwaehnende(namen, rev) {
  if (namen.length === 0) return [];
  const muster = [...new Set(namen)].flatMap((name) => ["-e", name]);
  const lauf = gitLauf(["grep", "-l", "-z", "-F", ...muster, rev, "--", "test/"]);
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
      if (MESSBAR.test(ziel)) quellen.add(ziel);
      else if (TESTHILFE.test(ziel)) besucht.add(ziel);
    }
  }
  return { quellen: [...quellen], besucht: [...besucht].sort() };
}

function inhaltIm(rev, pfad) {
  const lauf = gitLauf(["show", `${rev}:${pfad}`]);
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

function kette(test, graph) {
  const besucht = new Set([test]);
  const ziele = new Set();
  for (const datei of besucht) {
    for (const ziel of graph.importe.get(datei) ?? []) {
      ziele.add(ziel);
      if (TESTHILFE.test(ziel) && !QUELLDATEI.test(ziel)) besucht.add(ziel);
    }
  }
  return { besucht: [...besucht], ziele: [...ziele] };
}

function textwert(knoten) {
  if (knoten.type === "Literal" && typeof knoten.value === "string") return [knoten.value];
  if (knoten.type === "TemplateElement") return [knoten.value.cooked ?? knoten.value.raw];
  return [];
}

function literale(datei, text) {
  const knoten = syntaxknoten(datei, text);
  return knoten === undefined ? [text] : knoten.flatMap(textwert);
}

function werkzeugeInText(datei, text) {
  const teile = SKRIPT.test(datei) ? literale(datei, text) : [text];
  return teile.flatMap((teil) =>
    [...teil.matchAll(WERKZEUG_DATEI_IN_TEXT)].map(([, pfad]) => pfad),
  );
}

function testVerstoesse(test, { alt, dateien }) {
  const { besucht, ziele } = kette(test, alt.graph);
  const vorhanden = new Set(quelldateien(alt.graph));
  const quellen = [
    ...ziele.filter((ziel) => MESSBAR.test(ziel)),
    ...genannteQuellen(besucht, { rev: alt.rev, vorhanden }),
  ];
  const befunde = [];
  if (!quellen.some((quelle) => dateien.has(quelle))) {
    befunde.push(
      `${test}: erreicht keine Datei der Messmenge unter src/, scripts/ oder tools/; seine Wirkung lässt sich so nicht messen`,
    );
  }
  const importiert = new Set(ziele.filter((ziel) => dateien.has(ziel)));
  const werkzeug = ziele.filter((ziel) => WERKZEUGPFAD.test(ziel) && !importiert.has(ziel));
  const genannt = besucht.filter((datei) =>
    werkzeugeInText(datei, inhaltIm(alt.rev, datei)).some((pfad) => !importiert.has(pfad)),
  );
  if (werkzeug.length > 0 || genannt.length > 0) {
    befunde.push(
      `${test}: prüft tools/ oder scripts/ (${[...werkzeug, ...genannt].join(", ")}) über Dateien, die er nicht importiert, oder über Programme, die er startet; deren Mutanten misst Stryker nicht, solche Tests mistet die Ausnahme nicht aus`,
    );
  }
  return befunde;
}

function ungenutzt(pfad, alt) {
  if (TESTDATEI.test(pfad) || !gitGelingt(["cat-file", "-e", `${alt.rev}:${pfad}`])) return [];
  const nutzer = [...abhaengige([pfad], alt)].filter((datei) => TESTDATEI.test(datei));
  if (nutzer.length > 0) return [];
  return [
    `${pfad}: keine Testdatei lädt oder nennt diese Datei; ihre Änderung lässt sich nicht messen`,
  ];
}

export function mengenVerstoesse({ geaendert, alt, menge }) {
  const dateien = new Set(menge.dateien);
  return [
    ...menge.alt.flatMap((test) => testVerstoesse(test, { alt, dateien })),
    ...geaendert.flatMap((pfad) => ungenutzt(pfad, alt)),
  ];
}
