import { spawn } from "node:child_process";
import { appendFileSync, globSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cwd, env, exit } from "node:process";
import { parseArgs } from "node:util";

import { TOOL_TEST_GLOB } from "../../test/testbaenke-run.mjs";
import { neuerTempOrdner } from "../temp-ordner.mjs";
import { alsEintrag, lesemengeAusDatei } from "./lesemenge-strace.mjs";
import { waehleTeil } from "./teilung.mjs";

const AUFRUF =
  "Aufruf: node tools/testlaufzeit/lesemenge-aufzeichnen.mjs --teil <k> --teile <n> --aus <datei.jsonl> [--ohne-strace] [--leerlauf] [--gleichzeitig <n>] [--rohproben <n>] [--rohordner <ordner>]";
const EXIT_FEHLER = 1;
const EXIT_AUFRUF = 2;
const GANZE_ZAHL = /^[1-9]\d*$/;
const STANDARD_GLEICHZEITIG = 4;
const STANDARD_ROHPROBEN = 3;
const ROHZEILEN = 3000;
const MS_JE_SEKUNDE = 1000;
const LEERLAUF_DATEI = "test/werkzeuge/zz-lesemenge-leerlauf.test.js";
const LEERLAUF_NAME = "(leerlauf)";
const LEERLAUF_INHALT = 'import { test } from "node:test";\n\ntest("leer", () => {});\n';
const SPERR_VARIABLE = "SCHWERLAUF_SPERRDATEI";
const STRACE_FLAGGEN = ["-f", "-y", "-qq", "-s", "4096", "-e", "trace=%file,execve"];
const RUNNER = ["test/testbaenke-run.mjs", "regression"];
const RUNNER_FLAGGEN = ["--", "--test-concurrency=4"];

function optionen() {
  return parseArgs({
    options: {
      teil: { type: "string" },
      teile: { type: "string" },
      aus: { type: "string" },
      "ohne-strace": { type: "boolean", default: false },
      leerlauf: { type: "boolean", default: false },
      gleichzeitig: { type: "string", default: String(STANDARD_GLEICHZEITIG) },
      rohproben: { type: "string", default: String(STANDARD_ROHPROBEN) },
      rohordner: { type: "string" },
    },
  }).values;
}

function ganzeZahl(text) {
  return GANZE_ZAHL.test(text ?? "") ? Number(text) : null;
}

function befehl(datei, log, mitStrace) {
  const runner = ["node", ...RUNNER, datei, ...RUNNER_FLAGGEN];
  return mitStrace ? ["strace", ...STRACE_FLAGGEN, "-o", log, "--", ...runner] : runner;
}

function laufen({ datei, nummer }, { ordner, mitStrace }) {
  const log = join(ordner, `strace-${nummer}.log`);
  const [programm, ...argumente] = befehl(datei, log, mitStrace);
  const start = Date.now();
  return new Promise((aufgeloest) => {
    const kind = spawn(programm, argumente, {
      stdio: "ignore",
      env: { ...env, [SPERR_VARIABLE]: join(ordner, `sperre-${nummer}.lock`) },
    });
    kind.on("error", () => aufgeloest({ log, exit: null, dauerMs: Date.now() - start }));
    kind.on("close", (status) => aufgeloest({ log, exit: status, dauerMs: Date.now() - start }));
  });
}

function rohprobe(log, ziel) {
  const zeilen = readFileSync(log, "utf8").split("\n").slice(0, ROHZEILEN);
  writeFileSync(ziel, `${zeilen.join("\n")}\n`);
}

async function aufzeichnen(auftrag, einstellungen) {
  const { wurzel, mitStrace, aus, rohordner, rohproben } = einstellungen;
  const lauf = await laufen(auftrag, einstellungen);
  const eintrag = { datei: auftrag.name ?? auftrag.datei, exit: lauf.exit, dauer_ms: lauf.dauerMs };
  if (mitStrace) {
    Object.assign(eintrag, alsEintrag(await lesemengeAusDatei(lauf.log, wurzel)));
    if (rohordner !== undefined && auftrag.nummer < rohproben) rohprobe(lauf.log, join(rohordner, `roh-${auftrag.nummer}.log`));
    rmSync(lauf.log, { force: true });
  }
  appendFileSync(aus, `${JSON.stringify(eintrag)}\n`);
  console.log(`${eintrag.datei}: exit ${lauf.exit}, ${(lauf.dauerMs / MS_JE_SEKUNDE).toFixed(1)} s`);
}

async function mitGrenze(auftraege, gleichzeitig, aufgabe) {
  const warteschlange = [...auftraege];
  const arbeiter = Array.from({ length: gleichzeitig }, async () => {
    for (let naechste = warteschlange.shift(); naechste !== undefined; naechste = warteschlange.shift()) {
      await aufgabe(naechste);
    }
  });
  await Promise.all(arbeiter);
}

async function main() {
  const werte = optionen();
  const teil = ganzeZahl(werte.teil);
  const anzahl = ganzeZahl(werte.teile);
  const gleichzeitig = ganzeZahl(werte.gleichzeitig);
  const rohproben = Number(werte.rohproben);
  if (teil === null || anzahl === null || teil > anzahl || gleichzeitig === null || werte.aus === undefined) {
    console.error(AUFRUF);
    return EXIT_AUFRUF;
  }
  const dateien = waehleTeil({ dateien: globSync(TOOL_TEST_GLOB), teil, anzahl });
  if (dateien === null) return EXIT_FEHLER;
  writeFileSync(werte.aus, "");
  if (werte.rohordner !== undefined) mkdirSync(werte.rohordner, { recursive: true });
  const einstellungen = {
    ordner: neuerTempOrdner("lesemenge-"),
    wurzel: realpathSync(cwd()),
    mitStrace: !werte["ohne-strace"],
    aus: werte.aus,
    rohordner: werte.rohordner,
    rohproben,
  };
  const auftraege = dateien.map((datei, nummer) => ({ datei, nummer }));
  if (werte.leerlauf) writeFileSync(LEERLAUF_DATEI, LEERLAUF_INHALT);
  try {
    if (werte.leerlauf) await aufzeichnen({ datei: LEERLAUF_DATEI, name: LEERLAUF_NAME, nummer: dateien.length }, einstellungen);
    await mitGrenze(auftraege, gleichzeitig, (auftrag) => aufzeichnen(auftrag, einstellungen));
  } finally {
    rmSync(LEERLAUF_DATEI, { force: true });
  }
  return 0;
}

exit(await main().catch((fehler) => {
  console.error(`${AUFRUF}\n${fehler.stack}`);
  return EXIT_FEHLER;
}));
