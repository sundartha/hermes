import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, execPath } from "node:process";
import { fileURLToPath } from "node:url";

import { patternFlagsFor } from "../../test/testbaenke-run.mjs";

import { EXIT_GRUEN, EXIT_ROT, gueltigerAuftrag, meldeBefunde } from "./befehle.mjs";
import { istAusfuehrbarerTest } from "./format.mjs";
import { NUL, gibtEsIn, git } from "./git.mjs";
import { satzNummer, schutzSaetze } from "./schutzkennung.mjs";

const BERICHT = fileURLToPath(new URL("faelle-bericht.mjs", import.meta.url));
const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const FALL_ENDE = /^\}\)/;
const EINZUG = /^[ \t]*/;
const UMBAU = "Das ist ein Strukturumbau, und ein Umbau ist ein eigener Schritt.";

function geaenderteTestdateien(basis, root) {
  const pfade = git(["diff", "--name-only", "--no-renames", "--diff-filter=M", "-z", basis], { cwd: root }).split(NUL);
  return pfade.filter(istAusfuehrbarerTest);
}

function zahl(text) {
  return text === undefined ? 1 : Number(text);
}

function hunks(basis, root, pfad) {
  const zeilen = git(["diff", "-U0", "--no-renames", basis, "--", pfad], { cwd: root }).split("\n");
  const treffer = zeilen.map((zeile) => HUNK.exec(zeile)).filter((kopf) => kopf !== null);
  return treffer.map(([, entfernt, start, anzahl]) => ({ start: Number(start), anzahl: zahl(anzahl), entfernt: zahl(entfernt) }));
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

function liegtIn({ start, anzahl }, nummer) {
  return start <= nummer && nummer < start + anzahl;
}

function reichtIn({ start, anzahl }, { zeile, bis }) {
  return start <= bis && start + Math.max(anzahl, 1) > zeile;
}

function istNeu(fall, stuecke) {
  const beginntNeu = stuecke.some((stueck) => liegtIn(stueck, fall.zeile));
  return beginntNeu && stuecke.filter((stueck) => reichtIn(stueck, fall)).every(({ entfernt }) => entfernt === 0);
}

export function neueFaelle(basis, root, pfad) {
  const { faelle } = laufe(root, pfad);
  if (!gibtEsIn(basis, pfad, root)) return faelle;
  const gespannt = spannen(faelle, readFileSync(join(root, pfad), "utf8").split("\n"));
  const stuecke = hunks(basis, root, pfad);
  return gespannt.filter((fall) => istNeu(fall, stuecke));
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

function dateiBefunde({ basis, root, anzahl }, pfad) {
  const zeilen = readFileSync(join(root, pfad), "utf8").split("\n");
  const { faelle, dateiRot } = laufe(root, pfad);
  const gespannt = spannen(faelle, zeilen);
  const stuecke = hunks(basis, root, pfad);
  const treffer = stuecke.flatMap((hunk) => beruehrt(gespannt, zeilen, hunk));
  const geaendert = new Set(treffer.flatMap((stelle) => stelle.faelle));
  const schutz = (fall) => satzNummer(fall.name, anzahl) !== null && istNeu(fall, stuecke);
  const befunde = [...geaendert]
    .filter((fall) => !fall.rot && !schutz(fall))
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

function saetzeDes({ phasendatei, auftrag: kennung, root }) {
  if (phasendatei === undefined) return { anzahl: 0, befunde: [] };
  const { auftrag, befunde } = gueltigerAuftrag(phasendatei, kennung, root);
  return { anzahl: schutzSaetze(auftrag).length, befunde };
}

export function faelle({ basis, root, phasendatei, auftrag }) {
  const { anzahl, befunde: aufruf } = saetzeDes({ phasendatei, auftrag, root });
  if (aufruf.length > 0) return meldeBefunde(aufruf);
  const dateien = geaenderteTestdateien(basis, root);
  const befunde = dateien.flatMap((pfad) => dateiBefunde({ basis, root, anzahl }, pfad));
  for (const befund of befunde) console.log(`Verstoß: ${befund}`);
  console.log(`${befunde.length === 0 ? "grün" : "rot"}: ${dateien.length} bestehende Testdateien geändert, ${befunde.length} Befunde.`);
  return befunde.length === 0 ? EXIT_GRUEN : EXIT_ROT;
}
