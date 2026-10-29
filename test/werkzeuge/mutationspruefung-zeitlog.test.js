import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { test } from "node:test";

import { BASIS, EXIT_ROT, NEGATIV, NULL, pruefe, quelle, schluessel, UEBERLEBT } from "./mutationspruefung-hilfen.js";
import { isolatedEnvironment, probeDirectory, probeRepository, REPO_ROOT, runIn, writeFiles } from "./probe-repo.js";

const LOGORDNER = ".mutationspruefung/log";
const PRAEFIX = "Mutationslog: ";
const URTEIL = /^(?:grün|rot): .+$/gm;
const FORTSCHRITT_ABSTAND_S = 30;
const MS_JE_SEKUNDE = 1000;
const PHASEN = ["sperre", "testauswahl", "sandbox", "erstlauf", "mutanten", "loeschprobe"];
const MIT_SPALTE = /^\S+:\d+:\d+-\d+:\d+ /;
const UEBERLEBEND = ["Survived", "NoCoverage"];
const GETOETET = "Killed";
const BESTAETIGUNGSLAUF = "im Bestätigungslauf";
const ERSTER_LAUF = "erster Lauf";
const LASTMITTEL = 3;

function logs(repo) {
  const ordner = join(repo, LOGORDNER);
  if (!existsSync(ordner) || !statSync(ordner).isDirectory()) return [];
  return readdirSync(ordner)
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => readFileSync(join(ordner, name), "utf8").trim().split("\n").map((zeile) => JSON.parse(zeile)));
}

function logDer(repo, betriebsart) {
  const treffer = logs(repo).filter(([start]) => start.art === "start" && start.betriebsart === betriebsart);
  assert.equal(treffer.length, 1, JSON.stringify(logs(repo)));
  return treffer[0];
}

function arten(eintraege, art) {
  return eintraege.filter((eintrag) => eintrag.art === art);
}

function logzeilen(text) {
  return text.split("\n").filter((zeile) => zeile.startsWith(PRAEFIX));
}

function rotesRepo(context) {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV, NULL) });
  return repo;
}

function rotLaufMitLog(context) {
  const repo = rotesRepo(context);
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  return { repo, lauf, eintraege: logDer(repo, "normal") };
}

function pruefeStrykerlauf(lauf) {
  assert.equal(lauf.datei, "src/zahl.js");
  assert.equal(lauf.testdateien, 1);
  assert.ok(lauf.mutanten > 0, JSON.stringify(lauf));
  for (const dauer of [lauf.ms_sandbox, lauf.ms_erstlauf, lauf.ms_mutanten]) assert.ok(Number.isFinite(dauer) && dauer >= 0, JSON.stringify(lauf));
  const gezaehlt = Object.values(lauf.status).reduce((summe, zahl) => summe + zahl, 0);
  assert.equal(gezaehlt, lauf.mutanten, JSON.stringify(lauf));
  assert.deepEqual([lauf.getoetet, lauf.zeitueberschreitung], [lauf.status.Killed ?? 0, lauf.status.Timeout ?? 0], JSON.stringify(lauf));
  assert.deepEqual(lauf.langsamste.map(({ datei }) => datei), ["test/zahl.test.js"], JSON.stringify(lauf));
}

test("ein Mutationslauf schreibt ein Zeit-Log mit Start, Warten an der Sperre, Testauswahl, je Datei Mutanten und Dauern und Ende", (context) => {
  const { repo, lauf, eintraege } = rotLaufMitLog(context);
  const [start] = eintraege;
  assert.equal(start.basis, "HEAD");
  assert.equal(start.commit, runIn(repo, "git", ["rev-parse", "HEAD"]).stdout.trim());
  assert.equal(arten(eintraege, "sperre").length, 1);
  assert.ok(Number.isFinite(arten(eintraege, "sperre")[0].ms));
  const [auswahl] = arten(eintraege, "testauswahl");
  assert.deepEqual([auswahl.dateien, auswahl.testdateien], [1, 1], JSON.stringify(auswahl));
  const strykerlaeufe = arten(eintraege, "stryker");
  assert.ok(strykerlaeufe.length > 0, JSON.stringify(eintraege));
  for (const strykerlauf of strykerlaeufe) pruefeStrykerlauf(strykerlauf);
  assert.equal(strykerlaeufe[0].anlass, "erster Lauf");
  const [datei] = arten(eintraege, "datei");
  assert.deepEqual([datei.datei, datei.nummer, datei.von, datei.laeufe], ["src/zahl.js", 1, 1, strykerlaeufe.length]);
  assert.equal(datei.ueberlebt, schluessel(lauf.stdout, UEBERLEBT).length, lauf.stdout);
  const loeschproben = arten(eintraege, "loeschprobe");
  assert.deepEqual(loeschproben.map(({ datei: geprueft }) => geprueft), ["src/zahl.js"], JSON.stringify(eintraege));
  assert.ok(Number.isFinite(loeschproben[0].ms), JSON.stringify(loeschproben));
  const zeilen = logzeilen(lauf.stderr);
  for (const phase of [/^Mutationslog: Sperre nach .+ Warten erhalten$/, /^Mutationslog: Testauswahl \(Seite neu\): 1 Dateien, 1 Testdateien in /, /^Mutationslog: Löschprobe src\/zahl\.js in /]) {
    assert.equal(zeilen.filter((zeile) => phase.test(zeile)).length, 1, `${phase}\n${zeilen.join("\n")}`);
  }
  const ende = eintraege.at(-1);
  assert.equal(ende.art, "ende");
  assert.equal(ende.exit, EXIT_ROT);
  assert.deepEqual(Object.keys(ende.phasen).sort(), [...PHASEN].sort());
  assert.deepEqual(
    [ende.phasen.sperre, ende.phasen.testauswahl, ende.phasen.loeschprobe],
    [arten(eintraege, "sperre")[0].ms, auswahl.ms, loeschproben[0].ms],
    JSON.stringify(ende),
  );
  assert.ok(Object.values(ende.phasen).every((dauer) => dauer >= 0 && dauer <= ende.ms), JSON.stringify(ende));
});

test("das Zeit-Log nennt je überlebendem Mutanten Lage, Mutator und Status und im Bestätigungslauf je getötetem Mutanten die tötende Testdatei", (context) => {
  const repo = rotesRepo(context);
  const lauf = pruefe(repo, "--basis", "HEAD");
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  const mutanten = arten(logDer(repo, "normal"), "mutant");
  const ueberlebende = schluessel(lauf.stdout, UEBERLEBT).filter((verstoss) => MIT_SPALTE.test(verstoss));
  assert.ok(ueberlebende.length > 0, lauf.stdout);
  for (const verstoss of ueberlebende) {
    const treffer = mutanten.filter((eintrag) => eintrag.schluessel === verstoss && UEBERLEBEND.includes(eintrag.status));
    assert.ok(treffer.length > 0, `${verstoss}\n${JSON.stringify(mutanten)}`);
    for (const { datei, lage, mutator } of treffer) assert.ok(verstoss.startsWith(`${datei}:${lage.start.line}:${lage.start.column}-${lage.end.line}:${lage.end.column} ${mutator} → `), `${verstoss}\n${JSON.stringify(treffer)}`);
  }
  const bestaetigt = mutanten.filter(({ anlass, status }) => anlass === BESTAETIGUNGSLAUF && status === GETOETET);
  assert.ok(bestaetigt.length > 0, JSON.stringify(mutanten));
  for (const eintrag of bestaetigt) assert.deepEqual(eintrag.toeter, ["test/zahl.test.js"], JSON.stringify(eintrag));
  assert.deepEqual(mutanten.filter(({ anlass, status }) => anlass === ERSTER_LAUF && status === GETOETET), [], JSON.stringify(mutanten));
});

test("auf der Konsole meldet der Lauf seine Phasen mit eigenem Präfix nur auf stderr, eine Zeile je Stryker-Lauf und Datei, und höchstens eine Fortschrittszeile je 30 s", (context) => {
  const repo = probeRepository(context, { ...BASIS, "src/zahl.js": quelle(NEGATIV, NULL) });
  writeFiles(repo, { "src/zahl.js": quelle(NEGATIV) });
  const lauf = pruefe(repo, "--basis", "HEAD", "--alter-stand");
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.deepEqual(logzeilen(lauf.stdout), []);
  const zeilen = logzeilen(lauf.stderr);
  const eintraege = logDer(repo, "alter-stand");
  assert.match(zeilen[0], /^Mutationslog: Log in \.mutationspruefung\/log\/\S+\.jsonl/);
  const strykerzeilen = zeilen.filter((zeile) => /^Mutationslog: Datei 1\/1 src\/zahl\.js, /.test(zeile));
  assert.equal(strykerzeilen.length, arten(eintraege, "stryker").length, zeilen.join("\n"));
  assert.equal(zeilen.filter((zeile) => /^Mutationslog: Datei 1\/1 src\/zahl\.js fertig /.test(zeile)).length, 1, zeilen.join("\n"));
  assert.match(zeilen.at(-1), /^Mutationslog: Ende nach /);
  const fortschritt = zeilen.filter((zeile) => zeile.startsWith(`${PRAEFIX}Fortschritt `));
  const sekunden = eintraege.at(-1).ms / MS_JE_SEKUNDE;
  assert.ok(fortschritt.length <= Math.floor(sekunden / FORTSCHRITT_ABSTAND_S), `${sekunden} s\n${zeilen.join("\n")}`);
});

test("kann das Zeit-Log nicht geschrieben werden, bleiben Exit-Code, überlebende Mutanten und Urteil dieselben wie mit Log", (context) => {
  const mitLog = rotesRepo(context);
  const ohneLog = rotesRepo(context);
  mkdirSync(join(ohneLog, ".mutationspruefung"));
  writeFileSync(join(ohneLog, LOGORDNER), "kein Ordner\n");
  const [erwartet, gesperrt] = [mitLog, ohneLog].map((repo) => pruefe(repo, "--basis", "HEAD"));
  assert.equal(logs(mitLog).length, 1);
  assert.deepEqual(logs(ohneLog), []);
  assert.equal(gesperrt.status, erwartet.status, gesperrt.stdout + gesperrt.stderr);
  assert.deepEqual(schluessel(gesperrt.stdout, UEBERLEBT), schluessel(erwartet.stdout, UEBERLEBT));
  assert.deepEqual(gesperrt.stdout.match(URTEIL), erwartet.stdout.match(URTEIL));
});

test("Plan und Teil der CI schreiben je ein Zeit-Log mit ihrer Betriebsart, der Teil mit seinen Stryker-Läufen", (context) => {
  const repo = rotesRepo(context);
  const ziel = join(probeDirectory(context, {}), "plan.json");
  const plan = pruefe(repo, "--basis", "HEAD", "--plan", ziel);
  assert.equal(plan.status, 0, plan.stdout + plan.stderr);
  const geplant = logDer(repo, "plan");
  assert.equal(arten(geplant, "testauswahl").length, 1);
  assert.deepEqual(arten(geplant, "stryker"), []);
  const ergebnis = join(probeDirectory(context, {}), "teil.json");
  const teil = pruefe(repo, "--basis", "HEAD", "--teil", "1", "--teile", "1", "--ergebnis", ergebnis);
  assert.equal(teil.status, 0, teil.stdout + teil.stderr);
  const gemessen = logDer(repo, "teil");
  assert.ok(arten(gemessen, "stryker").length > 0, JSON.stringify(gemessen));
  assert.equal(arten(gemessen, "datei")[0].datei, "src/zahl.js");
  assert.equal(gemessen.at(-1).exit, 0);
});

test("der Testumbau schreibt ein Zeit-Log mit den Stryker-Läufen beider Stände", (context) => {
  const repo = probeRepository(context, BASIS);
  writeFiles(repo, { "test/zahl.test.js": `${BASIS["test/zahl.test.js"]}// umgebaut\n` });
  const lauf = pruefe(repo, "--basis", "HEAD", "--testumbau");
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const eintraege = logDer(repo, "testumbau");
  const dateien = arten(eintraege, "stryker").map(({ datei }) => datei);
  assert.ok(dateien.length >= 2 && dateien.every((datei) => datei === "src/zahl.js"), JSON.stringify(eintraege));
  assert.equal(eintraege.at(-1).art, "ende");
});

test("das Zeit-Log hält vor und nach jedem Stryker-Lauf Last und Prozesse fest, je Prozess nur Kennzahlen und höchstens 120 Zeichen Argumente", (context) => {
  const { eintraege } = rotLaufMitLog(context);
  const strykerlaeufe = arten(eintraege, "stryker");
  const prozesse = arten(eintraege, "prozesse");
  for (const zeitpunkt of ["vor", "nach"]) {
    assert.equal(prozesse.filter((eintrag) => eintrag.zeitpunkt === zeitpunkt).length, strykerlaeufe.length, JSON.stringify(prozesse));
  }
  for (const eintrag of prozesse) {
    assert.equal(eintrag.datei, "src/zahl.js");
    assert.equal(eintrag.last.length, LASTMITTEL, JSON.stringify(eintrag));
    assert.ok(eintrag.last.every(Number.isFinite), JSON.stringify(eintrag));
    for (const prozess of eintrag.prozesse) {
      assert.deepEqual(Object.keys(prozess).sort(), ["alter_s", "argumente", "befehl", "cpu", "pid", "ppid"], JSON.stringify(prozess));
      assert.ok(prozess.argumente.length <= 120, JSON.stringify(prozess));
      assert.ok([prozess.pid, prozess.ppid, prozess.alter_s, prozess.cpu].every(Number.isFinite), JSON.stringify(prozess));
      assert.match(prozess.befehl, /node|stryker|tap/);
    }
  }
  assert.ok(prozesse.some((eintrag) => eintrag.prozesse.some(({ befehl }) => befehl === "node")), JSON.stringify(prozesse));
});

function prozesszeilen(repo) {
  return arten(logDer(repo, "normal"), "prozesse");
}

function mitErsatzPs(context, skript, vorbereiten = () => {}) {
  const repo = rotesRepo(context);
  vorbereiten(repo);
  const werkzeuge = probeDirectory(context, {});
  writeFileSync(join(werkzeuge, "ps"), `#!/bin/sh\n${skript}\n`);
  chmodSync(join(werkzeuge, "ps"), 0o755);
  const lauf = spawnSync(process.execPath, [join(REPO_ROOT, "tools/mutationspruefung.mjs"), "--basis", "HEAD"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...isolatedEnvironment(), PATH: `${werkzeuge}${delimiter}${process.env.PATH}` },
  });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  return repo;
}

test("scheitert das Auslesen der Prozesse, läuft die Prüfung unverändert weiter und das Zeit-Log lässt die Prozesszeilen aus", (context) => {
  assert.deepEqual(prozesszeilen(mitErsatzPs(context, "exit 1")), []);
});

test("das Zeit-Log rechnet das Alter eines Prozesses mit und ohne Tagesanteil in Sekunden und nimmt nur node, stryker und tap auf", (context) => {
  const ausgabe = ["  4242     1 3-02:03:04  1.5 node /opt/lauf.js --eins", "  4243  4242       05:06  0.0 /usr/bin/node arbeiter.js", "  4244     1       00:07  9.0 nodemon lauf.js"];
  const [erste] = prozesszeilen(mitErsatzPs(context, `cat <<'ENDE'\n${ausgabe.join("\n")}\nENDE`));
  assert.deepEqual(erste.prozesse, [
    { pid: 4242, ppid: 1, alter_s: 266_584, cpu: 1.5, befehl: "node", argumente: "/opt/lauf.js --eins" },
    { pid: 4243, ppid: 4242, alter_s: 306, cpu: 0, befehl: "node", argumente: "arbeiter.js" },
  ]);
});

test("kann das Zeit-Log nicht geschrieben werden, wird auch kein ps gestartet", (context) => {
  const aufruf = join(probeDirectory(context, {}), "ps-aufgerufen");
  mitErsatzPs(context, `echo "$*" >> "${aufruf}"\nexit 1`, (repo) => {
    mkdirSync(join(repo, ".mutationspruefung"));
    writeFileSync(join(repo, LOGORDNER), "keine Ordner hier");
  });
  const aufrufe = existsSync(aufruf) ? readFileSync(aufruf, "utf8") : "";
  assert.doesNotMatch(aufrufe, /etime=/);
});
