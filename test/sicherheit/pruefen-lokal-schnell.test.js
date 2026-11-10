import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { echtWarten as warte } from "../echt-warten.js";

const WURZEL = resolve(import.meta.dirname, "../..");
const PRUEFEN = join(WURZEL, "tools/pruefen.mjs");
const DIREKTE_TESTS = 22;
const LOKALE_HOECHSTZAHL = 20;
const SCHNELLE_SCHRITTE = ["lint", "bestaende", "typen", "architektur", "katalog", "testschutz", "tests"];

function gitUmgebung() {
  const umgebung = { ...process.env };
  for (const name of Object.keys(umgebung)) if (name.startsWith("GIT_")) delete umgebung[name];
  return umgebung;
}

function git(ordner, ...args) {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: ordner, env: gitUmgebung(), encoding: "utf8" }).trim();
}

function schreibe(ordner, dateien) {
  for (const [pfad, inhalt] of Object.entries(dateien)) {
    mkdirSync(dirname(join(ordner, pfad)), { recursive: true });
    writeFileSync(join(ordner, pfad), inhalt);
  }
}

function attrappe(pfad, protokoll, rest = "") {
  writeFileSync(pfad, `#!/bin/sh\necho "\${0##*/} $*" >> "${protokoll}"\n${rest}\nexit 0\n`);
  chmodSync(pfad, 0o755);
}

function aufruf(protokoll) {
  return existsSync(protokoll) ? readFileSync(protokoll, "utf8").trim().split("\n") : [];
}

function probe(arbeit) {
  const testName = (nummer) => `test/t${String(nummer).padStart(2, "0")}.test.js`;
  const direkte = Array.from({ length: DIREKTE_TESTS }, (leer, index) => testName(index + 1));
  const module = [
    ...direkte.map((pfad) => ({ source: pfad, dependencies: [{ resolved: "src/a.js" }] })),
    { source: "src/b.js", dependencies: [{ resolved: "src/a.js" }] },
    { source: "test/indirekt.test.js", dependencies: [{ resolved: "src/b.js" }] },
  ];
  const ordner = join(arbeit, "probe");
  mkdirSync(ordner);
  git(ordner, "init", "-q");
  schreibe(ordner, { "src/a.js": "export const a = 1;\n", "tools/katalog-pruefen.mjs": "" });
  git(ordner, "add", "--", ".");
  git(ordner, "commit", "-q", "-m", "basis");
  const basis = git(ordner, "rev-parse", "HEAD");
  writeFileSync(join(ordner, "src/a.js"), "export const a = 2;\n");
  const protokolle = Object.fromEntries(["npm", "npx", "semgrep", "docker", "depcruise"].map((name) => [name, join(arbeit, `${name}.log`)]));
  const attrappen = join(arbeit, "attrappen");
  const kern = join(arbeit, "kern");
  mkdirSync(attrappen);
  mkdirSync(kern);
  symlinkSync(process.execPath, join(kern, "node"));
  symlinkSync(execFileSync("which", ["git"], { encoding: "utf8" }).trim(), join(kern, "git"));
  for (const name of ["npm", "npx", "docker"]) attrappe(join(attrappen, name), protokolle[name]);
  mkdirSync(join(ordner, "node_modules/.bin"), { recursive: true });
  attrappe(join(ordner, "node_modules/.bin/depcruise"), protokolle.depcruise, `printf '%s' '${JSON.stringify({ modules: module, summary: { violations: [] } })}'`);
  return { ordner, basis, protokolle, attrappen, kern, direkte };
}

function pruefen(umgebung, args, mitSemgrep = false) {
  const { ordner, basis, protokolle, attrappen, kern } = umgebung;
  if (mitSemgrep) attrappe(join(attrappen, "semgrep"), protokolle.semgrep);
  const ergebnis = spawnSync("node", [PRUEFEN, ...args, "--basis", basis], { cwd: ordner, env: { ...gitUmgebung(), PATH: `${attrappen}:${kern}` }, encoding: "utf8" });
  return { gruen: ergebnis.status === 0, text: ergebnis.stdout + ergebnis.stderr };
}

function inProbe(pruefung) {
  const arbeit = mkdtempSync(join(tmpdir(), "pruefen-schnell-"));
  try {
    return pruefung(probe(arbeit));
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
}

test("npm run pruefen ohne Schritt fährt nur den schnellen Teilsatz mit Architektur, aber ohne Semgrep", () => {
  inProbe((umgebung) => {
    const ergebnis = pruefen(umgebung, [], true);
    assert.deepEqual([...ergebnis.text.matchAll(/^# (\S+)$/gm)].map(([, schritt]) => schritt), SCHNELLE_SCHRITTE);
    assert.equal(ergebnis.gruen, true);
    assert.deepEqual(aufruf(umgebung.protokolle.semgrep), []);
    assert.equal(aufruf(umgebung.protokolle.depcruise).length, 4);
  });
});

test("Der Schritt tests startet nur direkte Tests, höchstens 20, mit 2 Prozessen, und nennt die übrigen", () => {
  inProbe((umgebung) => {
    const ergebnis = pruefen(umgebung, []);
    const erwartet = `npm test -- ${umgebung.direkte.slice(0, LOKALE_HOECHSTZAHL).join(" ")} -- --test-concurrency=2`;
    assert.deepEqual(aufruf(umgebung.protokolle.npm), [erwartet]);
    assert.match(ergebnis.text, /3 weitere betroffene Tests laufen nur in der CI\./);
  });
});

test("Semgrep ohne Binary wird übersprungen und startet kein Docker", () => {
  inProbe((umgebung) => {
    const ergebnis = pruefen(umgebung, ["semgrep"]);
    assert.match(ergebnis.text, /Semgrep übersprungen: semgrep nicht installiert; die CI prüft es\./);
    assert.equal(ergebnis.gruen, true);
    assert.deepEqual(aufruf(umgebung.protokolle.docker), []);
  });
});

const SPERRE_TAKT_MS = 20;
const SPERRE_HALTEN_MS = 400;
const SPERRE_VERSATZ_MS = 120;
const SPERRE_KURZ_MS = 40;
const VERWAISTE_WARTENDE = 6;

function sperrLaeufer(arbeit) {
  const skript = join(arbeit, "lauf.mjs");
  writeFileSync(skript, `
    import { spawnSync } from "node:child_process";
    import { appendFileSync } from "node:fs";
    import { echtWarten as warte } from ${JSON.stringify(pathToFileURL(join(WURZEL, "test/echt-warten.js")).href)};
    import { nimmPruefsperre } from ${JSON.stringify(pathToFileURL(PRUEFEN).href)};
    const [name, datei, protokoll, haltenMs, warteMs] = process.argv.slice(2);
    try {
      await nimmPruefsperre({ datei, warteMs: Number(warteMs), taktMs: ${SPERRE_TAKT_MS} });
    } catch (fehler) {
      console.log(fehler.message);
      process.exit(7);
    }
    appendFileSync(protokoll, name + " start\\n");
    if (name === "halterMitKind") spawnSync(process.execPath, [process.argv[1], "kind", datei, protokoll, "0", "400"], { stdio: "inherit" });
    await warte(Number(haltenMs));
    appendFileSync(protokoll, name + " ende\\n");
  `);
  const sperre = join(arbeit, "sperre");
  const protokoll = join(arbeit, "sperre.log");
  const starte = (name, haltenMs, { warteMs = 10_000 } = {}) => {
    const kind = spawn("node", [skript, name, sperre, protokoll, String(haltenMs), String(warteMs)], { env: { ...process.env, HERMES_PRUEFEN_SPERRE: "" } });
    let text = "";
    kind.stdout.on("data", (stueck) => {
      text += stueck;
    });
    const ende = new Promise((fertig) => kind.on("close", (status) => fertig({ status, text })));
    return { kind, ende, text: () => text };
  };
  return { sperre, protokoll, starte };
}

async function mitSperrLaeufer(pruefung) {
  const arbeit = mkdtempSync(join(tmpdir(), "pruefen-sperre-"));
  try {
    await pruefung(sperrLaeufer(arbeit));
  } finally {
    rmSync(arbeit, { recursive: true, force: true });
  }
}

test("Zwei gleichzeitige lokale Prüfläufe laufen nacheinander, der zweite meldet einmal, auf wen er wartet", async () => {
  await mitSperrLaeufer(async ({ protokoll, starte }) => {
    const erster = starte("a", SPERRE_HALTEN_MS);
    await warte(SPERRE_VERSATZ_MS);
    const zweiter = starte("b", 0);
    const [ersterErgebnis, zweiterErgebnis] = await Promise.all([erster.ende, zweiter.ende]);
    assert.deepEqual(readFileSync(protokoll, "utf8").trim().split("\n"), ["a start", "a ende", "b start", "b ende"]);
    assert.equal(ersterErgebnis.text, "");
    assert.equal(zweiterErgebnis.text, `pruefen: warte auf anderen Prüflauf (PID ${erster.kind.pid})\n`);
  });
});

test("Nach kill -9 des Halters ist die Sperre frei und der nächste Lauf wartet nicht", async () => {
  await mitSperrLaeufer(async ({ sperre, starte }) => {
    const halter = starte("halter", 60_000);
    while (!existsSync(sperre)) await warte(SPERRE_TAKT_MS);
    halter.kind.kill("SIGKILL");
    await halter.ende;
    const danach = await starte("danach", 0).ende;
    assert.deepEqual(danach, { status: 0, text: "" });
  });
});

test("Ein lebender Halter hält die Sperre, nach 30 Minuten (hier verkürzt) bricht das Warten mit klarer Meldung ab", async () => {
  await mitSperrLaeufer(async ({ sperre, starte }) => {
    const halter = starte("halter", 60_000);
    while (!existsSync(sperre)) await warte(SPERRE_TAKT_MS);
    const ergebnis = await starte("fremd", 0, { warteMs: SPERRE_HALTEN_MS }).ende;
    halter.kind.kill("SIGKILL");
    assert.equal(ergebnis.status, 7);
    assert.match(ergebnis.text, new RegExp(`warte auf anderen Prüflauf \\(PID ${halter.kind.pid}\\)\\npruefen: Abbruch, .*länger als 30 Minuten`));
  });
});

test("Ein Kindprozess des Halters läuft mit dem Vermerk des Halters, ohne zu warten", async () => {
  await mitSperrLaeufer(async ({ protokoll, starte }) => {
    const halter = await starte("halterMitKind", 0).ende;
    assert.deepEqual(halter, { status: 0, text: "" });
    assert.deepEqual(readFileSync(protokoll, "utf8").trim().split("\n"), ["halterMitKind start", "kind start", "kind ende", "halterMitKind ende"]);
  });
});

test("Mehrere Wartende auf eine verwaiste Sperre überlappen sich nie", async () => {
  await mitSperrLaeufer(async ({ sperre, protokoll, starte }) => {
    const tot = spawn("node", ["-e", ""]);
    await new Promise((fertig) => tot.on("close", fertig));
    writeFileSync(sperre, String(tot.pid));
    const laeufe = Array.from({ length: VERWAISTE_WARTENDE }, (leer, index) => starte(`w${index}`, SPERRE_KURZ_MS).ende);
    for (const { status } of await Promise.all(laeufe)) assert.equal(status, 0);
    const zeilen = readFileSync(protokoll, "utf8").trim().split("\n");
    assert.equal(zeilen.length, 2 * VERWAISTE_WARTENDE);
    zeilen.forEach((zeile, index) => assert.match(zeile, index % 2 === 0 ? / start$/ : / ende$/));
    assert.equal(new Set(zeilen.map((zeile) => zeile.split(" ")[0])).size, VERWAISTE_WARTENDE);
    zeilen.forEach((zeile, index) => index % 2 === 1 && assert.equal(zeile.split(" ")[0], zeilen[index - 1].split(" ")[0]));
  });
});
