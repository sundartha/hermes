import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cwd, env } from "node:process";
import { fileURLToPath } from "node:url";

import { patternFlagsFor } from "../../test/testbaenke-run.mjs";
import { gruppen } from "../mutationspruefung/gruppen.mjs";
import { katalogtests } from "../testwirkung/katalog.mjs";
import { rang } from "./entscheiden.mjs";
import { TESTDATEI, erreichendeTests } from "./messmenge.mjs";
import { GATE_DATEI, gateDateien } from "./pfade.mjs";

const SCHEMA_SCHLUESSEL = "$schema";
const KONFIGURATIONSDATEI = fileURLToPath(new URL("../../stryker.config.json", import.meta.url));
const KONFIGURATION = Object.fromEntries(
  Object.entries(JSON.parse(readFileSync(KONFIGURATIONSDATEI, "utf8"))).filter(
    ([schluessel]) => schluessel !== SCHEMA_SCHLUESSEL,
  ),
);
const BANK = "regression";
const ARBEITSORDNER = join("node_modules", ".cache", "tests-ausmisten");
const LEERRAUM = /\s+/g;
const STRYKER_LAUF = fileURLToPath(new URL("stryker-lauf.mjs", import.meta.url));
const KEIN_PROZESS = "ESRCH";
const MS_JE_SEKUNDE = 1000;
const NACHKOMMA = 10;

function sekundenSeit(beginn) {
  return Math.round(((Date.now() - beginn) / MS_JE_SEKUNDE) * NACHKOMMA) / NACHKOMMA;
}

function eintrag({ fileName, location, mutatorName, replacement, status }) {
  const datei = relative(cwd(), fileName);
  const { start, end } = location;
  const ersatz = (replacement ?? "").replace(LEERRAUM, " ");
  const ort = `${start.line}:${start.column}-${end.line}:${end.column}`;
  return {
    schluessel: `${datei}:${ort} ${mutatorName} → ${ersatz}`,
    status,
    zeilen: [start.line, end.line],
  };
}

function beendeGruppe(pid) {
  try {
    process.kill(-pid, "SIGKILL");
  } catch (fehler) {
    if (fehler.code !== KEIN_PROZESS) throw fehler;
  }
}

async function inEigenerGruppe(args, optionen) {
  const kind = spawn(process.execPath, args, { ...optionen, detached: true });
  const aufraeumen = () => beendeGruppe(kind.pid);
  process.once("exit", aufraeumen);
  try {
    const [exit] = await once(kind, "exit");
    return exit;
  } finally {
    process.removeListener("exit", aufraeumen);
    aufraeumen();
  }
}

async function strykerImEigenenProzess(optionen) {
  const ordner = mkdtempSync(join(ARBEITSORDNER, "auftrag-"));
  try {
    const [auftrag, antwort] = [join(ordner, "optionen.json"), join(ordner, "ergebnis.json")];
    writeFileSync(auftrag, JSON.stringify(optionen));
    const exit = await inEigenerGruppe([STRYKER_LAUF, auftrag, antwort], {
      stdio: ["ignore", "inherit", "inherit"],
    });
    if (exit !== 0) throw new Error(`Der Stryker-Lauf endete mit Exit ${exit}.`);
    const { ergebnisse, fehler } = JSON.parse(readFileSync(antwort, "utf8"));
    if (fehler !== undefined) throw new Error(fehler);
    return ergebnisse;
  } finally {
    rmSync(ordner, { recursive: true, force: true });
  }
}

async function strykerLauf({ mutate, tests }) {
  mkdirSync(ARBEITSORDNER, { recursive: true });
  const tempDirName = mkdtempSync(join(ARBEITSORDNER, "lauf-"));
  try {
    const optionen = {
      ...KONFIGURATION,
      mutate,
      tap: {
        ...KONFIGURATION.tap,
        testFiles: tests,
        nodeArgs: [...KONFIGURATION.tap.nodeArgs, ...patternFlagsFor(BANK)],
      },
      configFile: KONFIGURATIONSDATEI,
      tempDirName,
    };
    return (await strykerImEigenenProzess(optionen)).map(eintrag);
  } finally {
    rmSync(tempDirName, { recursive: true, force: true });
  }
}

function offeneBereiche(datei, stati) {
  const offen = [...stati.values()].filter(({ status }) => rang(status) === 0);
  return [...new Set(offen.map(({ zeilen: [von, bis] }) => `${datei}:${von}-${bis}`))];
}

function nachTests(datei, tests, graph) {
  const importierer = graph.importierer.get(datei) ?? [];
  const direkt = new Set(importierer.filter((pfad) => TESTDATEI.test(pfad)));
  const zuerst = tests.filter((test) => direkt.has(test));
  return [...gruppen(zuerst), ...gruppen(tests.filter((test) => !direkt.has(test)))];
}

function offen(datei, { stati, ziele }) {
  if (ziele === undefined) return stati.size === 0 ? [datei] : offeneBereiche(datei, stati);
  const uebrig = [...ziele].filter(([schluessel]) => rang(stati.get(schluessel)?.status) === 0);
  return [...new Set(uebrig.map(([, [von, bis]]) => `${datei}:${von}-${bis}`))];
}

async function messe({ datei, testgruppen, ziele }) {
  const stati = new Map();
  for (const gruppe of testgruppen) {
    const mutate = offen(datei, { stati, ziele });
    if (mutate.length === 0) break;
    for (const ergebnis of await strykerLauf({ mutate, tests: gruppe })) {
      const bisher = stati.get(ergebnis.schluessel);
      const gesucht = ziele === undefined || ziele.has(ergebnis.schluessel);
      if (gesucht && (bisher === undefined || rang(ergebnis.status) > rang(bisher.status))) {
        stati.set(ergebnis.schluessel, ergebnis);
      }
    }
  }
  return stati;
}

export function gateMenge() {
  const gates = gateDateien(readFileSync(GATE_DATEI, "utf8"));
  const katalog = katalogtests("HEAD").tests.map(({ datei }) => datei);
  return new Set([...gates, ...katalog]);
}

export async function trockenlauf(tests) {
  if (tests.length === 0) return { sekunden: 0, exit: 0 };
  const beginn = Date.now();
  const exit = await inEigenerGruppe(
    ["--test", ...KONFIGURATION.tap.nodeArgs, ...patternFlagsFor(BANK), ...tests],
    { stdio: "ignore", env: { ...env, NODE_ENV: "test" } },
  );
  return { sekunden: sekundenSeit(beginn), exit };
}

function protokolliere(ergebnis, { datei, art, stati, tests, beginn }) {
  const zahlen = {
    datei,
    art,
    mutanten: stati.size,
    tests: tests.length,
    sekunden: sekundenSeit(beginn),
  };
  ergebnis.jeDatei.push(zahlen);
  console.log(
    `${datei} (${art}): ${zahlen.mutanten} Mutanten, ${zahlen.tests} Testdateien, ${zahlen.sekunden} s`,
  );
}

function uebernimm(ziel, stati) {
  for (const [schluessel, { status, zeilen }] of stati) ziel.set(schluessel, { status, zeilen });
}

export async function messeGegenAlte({ dateien, alt, gateAlt }) {
  const ergebnis = { mutanten: new Map(), gate: new Map(), jeDatei: [] };
  for (const datei of dateien) {
    for (const [art, tests] of [
      ["mutanten", alt],
      ["gate", gateAlt],
    ]) {
      if (tests.length === 0) continue;
      const beginn = Date.now();
      const stati = await messe({ datei, testgruppen: gruppen(tests) });
      uebernimm(ergebnis[art], stati);
      protokolliere(ergebnis, { datei, art, stati, tests, beginn });
    }
  }
  return ergebnis;
}

function getoeteteIn(datei, liste) {
  return [...liste].filter(
    ([schluessel, { status }]) => schluessel.startsWith(`${datei}:`) && rang(status) > 0,
  );
}

export async function messeGegenNeue({ dateien, basis, neu, graph, gates }) {
  const ergebnis = { mutanten: new Map(), gate: new Map(), jeDatei: [] };
  const neuGate = neu.filter((test) => gates.has(test));
  for (const datei of dateien) {
    const uebrige = erreichendeTests(datei, graph).filter((test) => !neu.includes(test));
    const plaene = [
      ["mutanten", neu, uebrige],
      ["gate", neuGate, uebrige.filter((test) => gates.has(test))],
    ];
    for (const [art, zuerst, danach] of plaene) {
      const getoetet = getoeteteIn(datei, basis[art]);
      if (getoetet.length === 0) continue;
      const beginn = Date.now();
      const testgruppen = [...gruppen(zuerst), ...nachTests(datei, danach, graph)];
      const ziele = new Map(getoetet.map(([schluessel, { zeilen }]) => [schluessel, zeilen]));
      const stati = await messe({ datei, testgruppen, ziele });
      uebernimm(ergebnis[art], stati);
      protokolliere(ergebnis, { datei, art, stati, tests: [...zuerst, ...danach], beginn });
    }
  }
  return ergebnis;
}
