import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { test } from "node:test";
import { once } from "node:events";
import { pathToFileURL } from "node:url";

import { REPO_ROOT, isolatedEnvironment, probeDirectory } from "./probe-repo.js";
import { echtWarten } from "../echt-warten.js";

const SCHWERLAUF = join(REPO_ROOT, "tools/schwerlauf.mjs");
const SPERRE = pathToFileURL(join(REPO_ROOT, "tools/schwerlauf/sperre.mjs")).href;
const WARTET = /^Schwerer Lauf wartet seit \d+ min auf die Sperre /;
const FRIST = { timeout: 30_000 };
const ARBEIT_MS = 2000;
const PRUEFABSTAND_MS = 100;
const PRUEFUNGEN_BIS_AUFGABE = 50;
const PERL = "/usr/bin/perl";
const NUR_EIGENTUEMER = 0o600;
const RECHTE_BITS = 0o777;
const ANDERES_NACHSEHEN = 'use Fcntl qw(:flock); open(my $f, ">>", $ARGV[0]) or die; flock($f, LOCK_SH) or die; $| = 1; print "schaut\\n"; 1 while sysread(STDIN, my $rest, 4096);';

function umgebung(context) {
  const env = { ...isolatedEnvironment(), SCHWERLAUF_SPERRDATEI: join(probeDirectory(context, {}), "sperre") };
  delete env.SCHWERLAUF_HALTER;
  return env;
}

function starte(args, { env, cwd = REPO_ROOT }) {
  const kind = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const lauf = { kind, stdout: "", stderr: "", ende: once(kind, "exit") };
  kind.stdout.setEncoding("utf8").on("data", (teil) => (lauf.stdout += teil));
  kind.stderr.setEncoding("utf8").on("data", (teil) => (lauf.stderr += teil));
  return lauf;
}

function zeile(strom, muster) {
  return new Promise((gefunden) => {
    createInterface({ input: strom }).on("line", (text) => {
      if (muster.test(text)) gefunden(text);
    });
  });
}

async function wartet(lauf) {
  const geendet = lauf.ende.then(([code]) => {
    throw new Error(`Lauf endete mit Exit ${code}, ohne auf die Sperre zu warten: ${lauf.stderr}`);
  });
  await Promise.race([zeile(lauf.kind.stderr, WARTET), geendet]);
}

async function halter(context, env) {
  const skript = `import { nimmSperreAuchFuerKindprozesse } from ${JSON.stringify(SPERRE)};
await nimmSperreAuchFuerKindprozesse("Halter im Test");
console.log("gehalten");
setInterval(() => {}, 1000);`;
  const lauf = starte(["--input-type=module", "-e", skript], { env });
  context.after(() => lauf.kind.kill("SIGKILL"));
  await zeile(lauf.kind.stdout, /^gehalten$/);
  return lauf;
}

function arbeit(name) {
  return `const beginn = Date.now(); setTimeout(() => console.log(JSON.stringify({ name: ${JSON.stringify(name)}, beginn, ende: Date.now() })), ${ARBEIT_MS});`;
}

test("zwei gleichzeitig gestartete schwere Läufe laufen nacheinander, der wartende nennt Halter und Beginn", FRIST, async (context) => {
  const env = umgebung(context);
  const laeufe = ["A", "B"].map((name) => starte([SCHWERLAUF, "--", process.execPath, "-e", arbeit(name)], { env }));
  await Promise.all(laeufe.map(({ ende }) => ende));

  const zeiten = laeufe.map(({ stdout }) => JSON.parse(stdout)).sort((a, b) => a.beginn - b.beginn);
  const erster = laeufe.find(({ stdout }) => JSON.parse(stdout).name === zeiten[0].name);
  const zweiter = laeufe.find((lauf) => lauf !== erster);
  assert.ok(zeiten[0].ende <= zeiten[1].beginn, JSON.stringify(zeiten));
  assert.equal(erster.stderr, "");
  assert.match(zweiter.stderr, WARTET);
  assert.match(zweiter.stderr, new RegExp(`gehalten von PID ${erster.kind.pid}, .*seit \\d{4}-\\d\\d-\\d\\dT`));
  assert.deepEqual(laeufe.map(({ kind }) => kind.exitCode), [0, 0]);
});

test("--stand nennt den Halter, solange die Sperre gehalten wird, und danach frei", FRIST, async (context) => {
  const env = umgebung(context);
  const gehalten = await halter(context, env);
  const belegt = starte([SCHWERLAUF, "--stand"], { env });
  await belegt.ende;
  gehalten.kind.kill("SIGKILL");
  await gehalten.ende;
  const frei = starte([SCHWERLAUF, "--stand"], { env });
  await frei.ende;

  assert.match(belegt.stdout, new RegExp(`^belegt: PID ${gehalten.kind.pid}, Halter im Test, `));
  assert.match(frei.stdout, /^frei \(/);
});

test("--stand meldet frei, während ein anderes Nachsehen auf die Sperre schaut", FRIST, async (context) => {
  const env = umgebung(context);
  const nachsehen = spawn(PERL, ["-e", ANDERES_NACHSEHEN, env.SCHWERLAUF_SPERRDATEI], { stdio: ["pipe", "pipe", "inherit"] });
  context.after(() => nachsehen.kill("SIGKILL"));
  await zeile(nachsehen.stdout, /^schaut$/);
  const stand = starte([SCHWERLAUF, "--stand"], { env });
  await stand.ende;

  assert.match(stand.stdout, /^frei \(/);
});

test("stirbt der Halter, wird die Sperre ohne Eingriff frei und der nächste Lauf startet", FRIST, async (context) => {
  const env = umgebung(context);
  const gehalten = await halter(context, env);
  gehalten.kind.kill("SIGKILL");
  await gehalten.ende;
  const naechster = starte([SCHWERLAUF, "--", process.execPath, "-e", "console.log('lief')"], { env });
  await naechster.ende;

  assert.equal(naechster.kind.exitCode, 0, naechster.stderr);
  assert.equal(naechster.stdout, "lief\n");
});

test("ein Lauf, den der Halter selbst startet, wartet nicht auf die eigene Sperre", FRIST, async (context) => {
  const env = umgebung(context);
  const innen = [SCHWERLAUF, "--", process.execPath, "-e", "console.log('innen')"];
  const lauf = starte([SCHWERLAUF, "--", process.execPath, ...innen], { env });
  await lauf.ende;

  assert.equal(lauf.kind.exitCode, 0, lauf.stderr);
  assert.equal(lauf.stdout, "innen\n");
  assert.equal(lauf.stderr, "");
});

test("der Schlüssel eines beendeten Halters öffnet die Sperre nicht mehr", FRIST, async (context) => {
  const env = umgebung(context);
  const gehalten = await halter(context, env);
  const { schluessel } = JSON.parse(readFileSync(`${env.SCHWERLAUF_SPERRDATEI}.json`, "utf8"));
  gehalten.kind.kill("SIGKILL");
  await gehalten.ende;
  const laeufe = [
    starte([SCHWERLAUF, "--", process.execPath, "-e", arbeit("alt")], { env: { ...env, SCHWERLAUF_HALTER: schluessel } }),
    starte([SCHWERLAUF, "--", process.execPath, "-e", arbeit("neu")], { env }),
  ];
  await Promise.all(laeufe.map(({ ende }) => ende));

  const zeiten = laeufe.map(({ stdout }) => JSON.parse(stdout)).sort((a, b) => a.beginn - b.beginn);
  assert.ok(zeiten[0].ende <= zeiten[1].beginn, JSON.stringify(zeiten));
});

test("ein fremder Halter-Schlüssel öffnet die Sperre nicht", FRIST, async (context) => {
  const env = umgebung(context);
  await halter(context, env);
  const lauf = starte([SCHWERLAUF, "--", process.execPath, "-e", "console.log('vorbei')"], {
    env: { ...env, SCHWERLAUF_HALTER: "geraten" },
  });
  context.after(() => lauf.kind.kill("SIGKILL"));
  await wartet(lauf);

  assert.equal(lauf.kind.exitCode, null);
  assert.equal(lauf.stdout, "");
});

function lebt(prozess) {
  try {
    process.kill(prozess, 0);
    return true;
  } catch {
    return false;
  }
}

async function bisBeendet(prozess) {
  for (let versuch = 0; versuch < PRUEFUNGEN_BIS_AUFGABE && lebt(prozess); versuch += 1) await echtWarten(PRUEFABSTAND_MS);
  return !lebt(prozess);
}

test("wird der Aufrufer eines wartenden Laufs beendet, startet der Lauf auch nach dem Freiwerden nicht", FRIST, async (context) => {
  const env = umgebung(context);
  const gehalten = await halter(context, env);
  const marke = join(probeDirectory(context, {}), "gelaufen");
  const aufrufer = spawn("sh", ["-c", '"$KNOTEN" "$SCHWERLAUF" -- "$KNOTEN" -e "require(\'node:fs\').writeFileSync(process.env.MARKE, \'\')" & echo $!; wait'], {
    env: { ...env, KNOTEN: process.execPath, SCHWERLAUF, MARKE: marke },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => aufrufer.kill("SIGKILL"));
  const lauf = Number(await zeile(aufrufer.stdout, /^\d+$/));
  context.after(() => lebt(lauf) && process.kill(lauf, "SIGKILL"));
  await zeile(aufrufer.stderr, WARTET);
  aufrufer.kill("SIGKILL");

  assert.equal(await bisBeendet(lauf), true);
  gehalten.kind.kill("SIGKILL");
  await gehalten.ende;
  const danach = starte([SCHWERLAUF, "--", process.execPath, "-e", ""], { env });
  await danach.ende;
  assert.equal(danach.kind.exitCode, 0, danach.stderr);
  assert.equal(existsSync(marke), false);
});

test("ist der Aufrufer beendet, wenn die Sperre frei wird, nimmt der wartende Lauf sie nicht", FRIST, async (context) => {
  const { sperreNehmenUndHalterEintragen } = await import("../../tools/schwerlauf/sperre.mjs");
  const datei = join(probeDirectory(context, {}), "sperre");
  const aufruferBeendet = () => true;

  await assert.rejects(sperreNehmenUndHalterEintragen(datei, "Aufrufer beendet", aufruferBeendet), /der Aufrufer ist beendet/);
  assert.equal(existsSync(`${datei}.json`), false);
});

test("endet der Prozess, der die Sperre hält, während des Laufs, endet der Lauf rot mit Meldung", FRIST, async (context) => {
  const env = umgebung(context);
  const beenden = "require('node:child_process').spawnSync('pkill', ['-P', String(process.ppid), '-f', 'usr/bin/perl'])";
  const lauf = starte([SCHWERLAUF, "--", process.execPath, "-e", beenden], { env });
  await lauf.ende;

  assert.equal(lauf.kind.exitCode, 1, lauf.stderr);
  assert.match(lauf.stderr, /Sperre für schwere Läufe während des Laufs verloren/);
});

test("lässt sich die Sperre nicht nehmen, startet der schwere Lauf nicht", FRIST, async (context) => {
  const ordner = probeDirectory(context, {});
  const marke = join(ordner, "gelaufen");
  const env = { ...umgebung(context), SCHWERLAUF_SPERRDATEI: join(ordner, "fehlt", "sperre") };
  const lauf = starte([SCHWERLAUF, "--", process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(marke)}, "")`], { env });
  await lauf.ende;

  assert.equal(lauf.kind.exitCode, 1);
  assert.match(lauf.stderr, /Sperre für schwere Läufe nicht erhalten/);
  assert.equal(existsSync(marke), false);
});

async function endetOhneHalterEintrag(context, env) {
  const marke = join(probeDirectory(context, {}), "gelaufen");
  const lauf = starte([SCHWERLAUF, "--", process.execPath, "-e", `require("node:fs").writeFileSync(${JSON.stringify(marke)}, "")`], { env });
  context.after(() => lauf.kind.kill("SIGKILL"));
  await lauf.ende;
  const danach = starte([SCHWERLAUF, "--stand"], { env });
  await danach.ende;

  assert.equal(lauf.kind.exitCode, 1, lauf.stderr);
  assert.match(lauf.stderr, /Sperre für schwere Läufe nicht erhalten: Halter nicht eintragbar/);
  assert.equal(existsSync(marke), false);
  assert.match(danach.stdout, /^frei \(/);
}

test("lässt sich der Halter nicht eintragen, endet der Lauf mit Exit 1 und die Sperre ist frei", FRIST, async (context) => {
  const env = umgebung(context);
  mkdirSync(`${env.SCHWERLAUF_SPERRDATEI}.json`);

  await endetOhneHalterEintrag(context, env);
});

test("liegt an der Stelle der Halterdatei ein Symlink, bleibt sein Ziel unberührt und der Lauf endet mit Exit 1", FRIST, async (context) => {
  const env = umgebung(context);
  const ziel = join(probeDirectory(context, {}), "fremde-datei");
  writeFileSync(ziel, "unberührt");
  symlinkSync(ziel, `${env.SCHWERLAUF_SPERRDATEI}.json`);

  await endetOhneHalterEintrag(context, env);
  assert.equal(readFileSync(ziel, "utf8"), "unberührt");
});

test("die Halterdatei kann nur der eigene Nutzer lesen und schreiben", FRIST, async (context) => {
  const env = umgebung(context);
  await halter(context, env);

  assert.equal(statSync(`${env.SCHWERLAUF_SPERRDATEI}.json`).mode & RECHTE_BITS, NUR_EIGENTUEMER);
});
