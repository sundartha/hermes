import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { once } from "node:events";

import { PRE_PUSH_HOOK, REPO_ROOT, passingTest, probeDirectory, probeRepository } from "./probe-repo.js";
import { EIN_PLATZ_FREI, FRIST, SCHWERLAUF, SPERRE, WARTET, halter, naechsterLaufNachTodVon, starte, starteArbeit, umgebung, wartet, zeile, zeitenVon } from "./schwerlauf-lauf.js";
import { echtWarten } from "../echt-warten.js";

const PRUEFABSTAND_MS = 100;
const PRUEFUNGEN_BIS_AUFGABE = 50;
const WARTEZEIT_AUF_SPERRE_MS = 3_600_000;
const LAUFZEIT_NACH_FREIGABE_MS = 2000;
const INNERE_FRIST_MS = 10_000;
const PERL = "/usr/bin/perl";
const NUR_EIGENTUEMER = 0o600;
const RECHTE_BITS = 0o777;
const LEERLAUF_MS = 1000;
const BIS_DER_GETOETETE_HALTER_ENDET_MS = 1000;
const HALTER_TOETEN = 'process.kill(halter.pid, "SIGKILL");';
const SPERRE_VERLOREN = /^Sperre für schwere Läufe während des Laufs verloren \(perl beendet\), der Lauf zählt als rot: Halter im Test$/m;
const ANDERES_NACHSEHEN = 'use Fcntl qw(:flock); open(my $f, ">>", $ARGV[0]) or die; flock($f, LOCK_SH) or die; $| = 1; print "schaut\\n"; 1 while sysread(STDIN, my $rest, 4096);';

async function nacheinander(laeufe) {
  const erster = await Promise.race(laeufe.map((lauf) => lauf.begonnen.then(() => lauf)));
  const zweiter = laeufe.find((lauf) => lauf !== erster);
  const zuerst = await Promise.race([zweiter.wartend, zweiter.begonnen, zweiter.ende.then(() => "geendet")]);
  assert.equal(zuerst, "wartet", zweiter.stdout + zweiter.stderr);
  erster.kind.stdin.end();
  await zweiter.begonnen;
  zweiter.kind.stdin.end();
  await Promise.all(laeufe.map(({ ende }) => ende));
  assert.ok(zeitenVon(erster).ende <= zeitenVon(zweiter).beginn, JSON.stringify([erster, zweiter].map(zeitenVon)));
  return { erster, zweiter };
}

test("zwei gleichzeitig gestartete schwere Läufe laufen nacheinander, der wartende nennt Halter und Beginn", FRIST, async (context) => {
  const env = umgebung(context);
  const laeufe = ["A", "B"].map((name) => starteArbeit(context, name, { env }));
  const { erster, zweiter } = await nacheinander(laeufe);

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

  assert.match(belegt.stdout, new RegExp(`^Platz 1: belegt von PID ${gehalten.kind.pid}, Halter im Test, `, "m"));
  assert.match(frei.stdout, EIN_PLATZ_FREI);
});

test("--stand meldet frei, während ein anderes Nachsehen auf die Sperre schaut", FRIST, async (context) => {
  const env = umgebung(context);
  const nachsehen = spawn(PERL, ["-e", ANDERES_NACHSEHEN, env.SCHWERLAUF_SPERRDATEI], { stdio: ["pipe", "pipe", "inherit"] });
  context.after(() => nachsehen.kill("SIGKILL"));
  await zeile(nachsehen.stdout, /^schaut$/);
  const stand = starte([SCHWERLAUF, "--stand"], { env });
  await stand.ende;

  assert.match(stand.stdout, EIN_PLATZ_FREI);
});

test("stirbt der Halter, wird die Sperre ohne Eingriff frei und der nächste Lauf startet", FRIST, async (context) => {
  const env = umgebung(context);
  const naechster = await naechsterLaufNachTodVon(await halter(context, env), env);

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
  const { schluessel } = JSON.parse(readFileSync(`${env.SCHWERLAUF_SPERRDATEI}.platz-1.json`, "utf8"));
  gehalten.kind.kill("SIGKILL");
  await gehalten.ende;
  const laeufe = [
    starteArbeit(context, "alt", { env: { ...env, SCHWERLAUF_HALTER: schluessel } }),
    starteArbeit(context, "neu", { env }),
  ];
  await nacheinander(laeufe);

  assert.deepEqual(laeufe.map(({ kind }) => kind.exitCode), [0, 0]);
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

  await assert.rejects(sperreNehmenUndHalterEintragen(datei, "Aufrufer beendet", { aufruferBeendet }), /der Aufrufer ist beendet/);
  assert.equal(existsSync(`${datei}.json`), false);
});

test("zwei gleichzeitige Aufrufe aus einem Prozess erhalten bei zwei freien Plätzen je einen eigenen Platz", FRIST, async (context) => {
  const { sperreNehmenUndHalterEintragen } = await import("../../tools/schwerlauf/sperre.mjs");
  const datei = join(probeDirectory(context, {}), "sperre");
  const aufrufe = ["erster Aufruf", "zweiter Aufruf"];

  const schluessel = await Promise.all(aufrufe.map((anlass) => sperreNehmenUndHalterEintragen(datei, anlass, { plaetze: aufrufe.length })));
  assert.equal(new Set(schluessel).size, aufrufe.length);
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
  assert.match(danach.stdout, EIN_PLATZ_FREI);
}

test("lässt sich der Halter nicht eintragen, endet der Lauf mit Exit 1 und die Sperre ist frei", FRIST, async (context) => {
  const env = umgebung(context);
  mkdirSync(`${env.SCHWERLAUF_SPERRDATEI}.platz-1.json`);

  await endetOhneHalterEintrag(context, env);
});

test("liegt an der Stelle der Halterdatei ein Symlink, bleibt sein Ziel unberührt und der Lauf endet mit Exit 1", FRIST, async (context) => {
  const env = umgebung(context);
  const ziel = join(probeDirectory(context, {}), "fremde-datei");
  writeFileSync(ziel, "unberührt");
  symlinkSync(ziel, `${env.SCHWERLAUF_SPERRDATEI}.platz-1.json`);

  await endetOhneHalterEintrag(context, env);
  assert.equal(readFileSync(ziel, "utf8"), "unberührt");
});

test("die Halterdatei kann nur der eigene Nutzer lesen und schreiben", FRIST, async (context) => {
  const env = umgebung(context);
  await halter(context, env);

  assert.equal(statSync(`${env.SCHWERLAUF_SPERRDATEI}.platz-1.json`).mode & RECHTE_BITS, NUR_EIGENTUEMER);
});

async function wartetAufSperre(context, [skript, ...args], dateien = {}) {
  const env = umgebung(context);
  await halter(context, env);
  const lauf = starte([join(REPO_ROOT, skript), ...args], { env, cwd: probeDirectory(context, dateien) });
  context.after(() => lauf.kind.kill("SIGKILL"));
  await wartet(lauf);

  assert.equal(lauf.kind.exitCode, null);
  assert.match(lauf.stderr, /gehalten von PID \d+, Halter im Test, /);
}

test("der Prüfleiter vor dem Push wartet, solange ein anderer Lauf die Sperre hält", FRIST, (context) =>
  wartetAufSperre(context, ["tools/pruefleiter.mjs", "--vor-push"]));

test("die Mutationsprüfung wartet, solange ein anderer Lauf die Sperre hält", FRIST, (context) =>
  wartetAufSperre(context, ["tools/mutationspruefung.mjs", "--basis", "HEAD"]));

test("die Testwirkung wartet, solange ein anderer Lauf die Sperre hält", FRIST, (context) =>
  wartetAufSperre(context, ["tools/testwirkung.mjs", "--basis", "HEAD"]));

test("tests-ausmisten lokal wartet, solange ein anderer Lauf die Sperre hält", FRIST, (context) =>
  wartetAufSperre(context, ["tools/tests-ausmisten.mjs", "lokal", "--bereich", "probe", "--master", "HEAD"]));

test("ein Testlauf über alle Testdateien wartet, solange ein anderer Lauf die Sperre hält", FRIST, (context) =>
  wartetAufSperre(context, ["test/testbaenke-run.mjs", "regression"]));

test("ein Testlauf über ein Dateimuster wartet, solange ein anderer Lauf die Sperre hält", FRIST, (context) =>
  wartetAufSperre(context, ["test/testbaenke-run.mjs", "regression", "test/werkzeuge/**/*.test.js"]));

test("ein Testlauf über einen Ordner wartet, solange ein anderer Lauf die Sperre hält", FRIST, (context) =>
  wartetAufSperre(context, ["test/testbaenke-run.mjs", "regression", "test"], { "test/probe.test.js": passingTest("ordner") }));

test("ein Testlauf mit einzelnen Testdateien wartet nicht auf die Sperre", FRIST, async (context) => {
  const env = umgebung(context);
  await halter(context, env);
  const probe = probeDirectory(context, { "test/probe.test.js": passingTest("einzeln") });
  const lauf = starte([join(REPO_ROOT, "test/testbaenke-run.mjs"), "regression", "test/probe.test.js"], { env, cwd: probe });
  await lauf.ende;

  assert.equal(lauf.kind.exitCode, 0, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stderr, WARTET);
});

test("ein schwerer Lauf, den ein Test startet, wartet nicht auf einen echten schweren Lauf", FRIST, async (context) => {
  const env = umgebung(context);
  await halter(context, env);
  const innen = [
    'import assert from "node:assert/strict";',
    'import { spawnSync } from "node:child_process";',
    'import { test } from "node:test";',
    'test("startet einen schweren Lauf", () => {',
    `  const lauf = spawnSync(${JSON.stringify(process.execPath)}, [${JSON.stringify(SCHWERLAUF)}, "--", ${JSON.stringify(process.execPath)}, "-e", "console.log('lief')"], { encoding: "utf8", timeout: ${INNERE_FRIST_MS} });`,
    '  assert.equal(lauf.stdout, "lief\\n", lauf.stderr);',
    "});",
    "",
  ].join("\n");
  const probe = probeDirectory(context, { "test/innen.test.js": innen });
  const lauf = starte([join(REPO_ROOT, "test/testbaenke-run.mjs"), "regression", "test/innen.test.js"], { env, cwd: probe });
  await lauf.ende;

  assert.equal(lauf.kind.exitCode, 0, lauf.stdout + lauf.stderr);
});

test("die Laufzeit eines wartenden Testlaufs zählt die Wartezeit auf die Sperre nicht mit", async () => {
  const { measuredAfterLocks } = await import("../testbaenke-run.mjs");
  let jetzt = 0;
  const uhr = { now: () => jetzt };
  const { elapsedMs } = await measuredAfterLocks(
    async () => {
      jetzt += WARTEZEIT_AUF_SPERRE_MS;
      return {};
    },
    async () => {
      jetzt += LAUFZEIT_NACH_FREIGABE_MS;
      return { code: 0 };
    },
    uhr,
  );

  assert.equal(elapsedMs, LAUFZEIT_NACH_FREIGABE_MS);
});

test("der Pre-Push-Hook gibt keine umgelenkte Sperrdatei an den Prüfleiter weiter", FRIST, async (context) => {
  const probe = probeRepository(context, {
    "package.json": JSON.stringify({
      name: "pre-push-sperre",
      private: true,
      scripts: { pruefleiter: "node zeige.mjs" },
    }),
    "zeige.mjs": "console.log(JSON.stringify([process.env.SCHWERLAUF_SPERRDATEI ?? null]));\n",
  });
  const hook = spawn("sh", [PRE_PUSH_HOOK], {
    cwd: probe,
    env: { ...umgebung(context), GIT_DIR: join(probe, ".git") },
    stdio: ["ignore", "pipe", "inherit"],
  });
  let ausgabe = "";
  hook.stdout.setEncoding("utf8").on("data", (teil) => (ausgabe += teil));
  const [code] = await once(hook, "exit");

  assert.equal(code, 0, ausgabe);
  assert.equal(JSON.parse(ausgabe)[0], null);
});

function ohnePs(context) {
  const nichtAusfuehrbar = join(probeDirectory(context, {}), "ps");
  writeFileSync(nichtAusfuehrbar, "", { mode: NUR_EIGENTUEMER });
  const umlenken = `import kindprozesse from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const { spawn, spawnSync } = kindprozesse;
const ohnePs = (datei) => (datei === "/bin/ps" ? ${JSON.stringify(nichtAusfuehrbar)} : datei);
kindprozesse.spawnSync = (datei, ...rest) => spawnSync(ohnePs(datei), ...rest);
kindprozesse.spawn = (datei, ...rest) => {
  const kind = spawn(ohnePs(datei), ...rest);
  if (datei === ${JSON.stringify(PERL)}) globalThis.halterImTest = kind;
  return kind;
};
syncBuiltinESMExports();`;
  return ["--import", `data:text/javascript,${encodeURIComponent(umlenken)}`];
}

test("lässt sich ps nicht starten, endet ein Lauf mit gehaltener Sperre grün", FRIST, async (context) => {
  const lauf = starte([...ohnePs(context), SCHWERLAUF, "--", process.execPath, "-e", "0"], { env: umgebung(context) });
  await lauf.ende;

  assert.equal(lauf.kind.exitCode, 0, lauf.stderr);
  assert.equal(lauf.stderr, "");
});

async function rotNachHalten(context, danach) {
  const skript = `import { once } from "node:events";
import { nimmSperreAuchFuerKindprozesse } from ${JSON.stringify(SPERRE)};
await nimmSperreAuchFuerKindprozesse("Halter im Test");
const halter = globalThis.halterImTest;
${danach}`;
  const lauf = starte([...ohnePs(context), "--input-type=module", "-e", skript], { env: umgebung(context) });
  await lauf.ende;

  assert.equal(lauf.kind.exitCode, 1, lauf.stderr);
  return lauf.stderr;
}

test("stirbt der Halter während des Laufs und ist abgeholt, endet der Lauf auch ohne ps rot", FRIST, async (context) => {
  const abholen = `const wach = setInterval(() => {}, ${LEERLAUF_MS}); await once(halter, "exit"); clearInterval(wach);`;

  assert.match(await rotNachHalten(context, `${HALTER_TOETEN} ${abholen}`), SPERRE_VERLOREN);
});

test("stirbt der Halter kurz vor dem Ende und ist noch nicht abgeholt, endet der Lauf auch ohne ps rot", FRIST, async (context) => {
  const endeOhneAbholen = `Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${BIS_DER_GETOETETE_HALTER_ENDET_MS}); process.exit(0);`;

  assert.match(await rotNachHalten(context, `${HALTER_TOETEN} ${endeOhneAbholen}`), SPERRE_VERLOREN);
});

test("lässt sich die Eingabe des Halters beim Ende nicht beschreiben, endet der Lauf rot und nennt den Grund", FRIST, async (context) => {
  assert.match(
    await rotNachHalten(context, "halter.stdin.destroy(); process.exit(0);"),
    /^Sperre für schwere Läufe während des Laufs nicht prüfbar \(Eingabe von perl nicht beschreibbar: .+\), der Lauf zählt als rot: Halter im Test$/m,
  );
});
