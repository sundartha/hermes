import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { patternFlagsFor } from "../../test/testbaenke-run.mjs";

import { EXIT_GRUEN, EXIT_ROT } from "./befehle.mjs";
import { istAusfuehrbarerTest } from "./format.mjs";
import { NUL, git } from "./git.mjs";

const BERICHT = fileURLToPath(new URL("faelle-bericht.mjs", import.meta.url));
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;
const FALL_ENDE = /^\}\)/;
const EINZUG = /^[ \t]*/;
const UMBAU = "Das ist ein Strukturumbau, und ein Umbau ist ein eigener Schritt.";

function geaenderteTestdateien(basis, root) {
  const pfade = git(["diff", "--name-only", "--no-renames", "--diff-filter=M", "-z", basis], { cwd: root }).split(NUL);
  return pfade.filter(istAusfuehrbarerTest);
}

function hunks(basis, root, pfad) {
  const zeilen = git(["diff", "-U0", "--no-renames", basis, "--", pfad], { cwd: root }).split("\n");
  const treffer = zeilen.map((zeile) => HUNK.exec(zeile)).filter((kopf) => kopf !== null);
  return treffer.map(([, start, anzahl]) => ({ start: Number(start), anzahl: anzahl === undefined ? 1 : Number(anzahl) }));
}

export function laufe(root, pfad) {
  const ordner = mkdtempSync(join(tmpdir(), "faelle-"));
  const ziel = join(ordner, "faelle.jsonl");
  try {
    const argumente = ["--test", `--test-reporter=${BERICHT}`, `--test-reporter-destination=${ziel}`];
    const lauf = spawnSync(execPath, [...argumente, ...patternFlagsFor("regression"), pfad], {
      cwd: root,
      env: { ...env, NODE_ENV: "test", TMPDIR: ordner },
      encoding: "utf8",
    });
    const zeilen = existsSync(ziel) ? readFileSync(ziel, "utf8").split("\n").filter(Boolean) : [];
    const faelle = zeilen.map((zeile) => JSON.parse(zeile)).filter(({ zeile }) => Number.isInteger(zeile));
    return { faelle, dateiRot: lauf.status !== EXIT_GRUEN };
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

function einzug(zeile) {
  return EINZUG.exec(zeile)[0].length;
}

function schlusszeile(zeilen, fall, naechster) {
  const eigener = einzug(zeilen[fall.zeile - 1] ?? "");
  const rumpf = zeilen.slice(fall.zeile, naechster - 1);
  const index = rumpf.findIndex(
    (zeile) => zeile.trim() !== "" && einzug(zeile) <= eigener && (eigener > 0 || FALL_ENDE.test(zeile)),
  );
  if (index === -1) return naechster - 1;
  const schliesst = einzug(rumpf[index]) === eigener && FALL_ENDE.test(rumpf[index].trimStart());
  return schliesst ? fall.zeile + index + 1 : fall.zeile + index;
}

function spannen(faelle, zeilen) {
  const sortiert = [...faelle].sort((links, rechts) => links.zeile - rechts.zeile);
  return sortiert.map((fall) => {
    const naechster = sortiert.find(({ zeile }) => zeile > fall.zeile)?.zeile ?? zeilen.length + 1;
    return { ...fall, bis: schlusszeile(zeilen, fall, naechster) };
  });
}

function faelleAn(faelle, nummer) {
  return faelle.filter(({ zeile, bis }) => zeile <= nummer && nummer <= bis);
}

function beruehrt(faelle, zeilen, { start, anzahl }) {
  const bereich = anzahl === 0 ? [start, start + 1] : Array.from({ length: anzahl }, (leer, versatz) => start + versatz);
  const belegt = bereich.filter((nummer) => (zeilen[nummer - 1] ?? "").trim() !== "");
  if (belegt.length > 0) return belegt.map((nummer) => ({ nummer, faelle: faelleAn(faelle, nummer) }));
  const letzte = faelleAn(faelle, bereich.at(-1));
  return [{ nummer: bereich[0], faelle: faelleAn(faelle, bereich[0]).filter((fall) => letzte.includes(fall)) }];
}

function dateiBefunde(basis, root, pfad) {
  const zeilen = readFileSync(join(root, pfad), "utf8").split("\n");
  const { faelle, dateiRot } = laufe(root, pfad);
  const gespannt = spannen(faelle, zeilen);
  const treffer = hunks(basis, root, pfad).flatMap((hunk) => beruehrt(gespannt, zeilen, hunk));
  const geaendert = new Set(treffer.flatMap((stelle) => stelle.faelle));
  const befunde = [...geaendert]
    .filter(({ rot }) => !rot)
    .map(({ name }) => `${pfad}: Der geänderte Fall „${name}“ ist gegen den unveränderten Produktcode grün. ${UMBAU}`);
  const draussen = treffer.find((stelle) => stelle.faelle.length === 0);
  if (draussen !== undefined) {
    const ganz = `${pfad}: Zeile ${draussen.nummer} liegt in keinem Testfall; die ganze Datei zählt als geändert und ist gegen den unveränderten Produktcode grün. ${UMBAU}`;
    return dateiRot ? befunde : [...befunde, ganz];
  }
  const unveraendertRot = gespannt.filter((fall) => fall.rot && !geaendert.has(fall));
  return [
    ...befunde,
    ...unveraendertRot.map(({ name }) => `${pfad}: Der unveränderte Fall „${name}“ ist rot; er muss gegen den unveränderten Produktcode grün bleiben.`),
  ];
}

export function faelle({ basis, root }) {
  const dateien = geaenderteTestdateien(basis, root);
  const befunde = dateien.flatMap((pfad) => dateiBefunde(basis, root, pfad));
  for (const befund of befunde) console.log(`Verstoß: ${befund}`);
  console.log(`${befunde.length === 0 ? "grün" : "rot"}: ${dateien.length} bestehende Testdateien geändert, ${befunde.length} Befunde.`);
  return befunde.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}
