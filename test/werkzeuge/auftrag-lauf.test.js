import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { PIN_FEHLT } from "../../tools/auftrag/lauf.mjs";
import { BASIS, EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { commitAll, runIn, writeFiles } from "./probe-repo.js";

const ZEILEN_UEBER_GRENZE = 401;
const GELOESCHTE_ZEILEN = 360;
const NEUE_ZEILEN = 50;
const ANTWORTEN_JE_SITZUNG = 2;
const NIE = { wiederholung: "-", gleichzeitig: "-", zeitueberschreitung: "-", abbruch: "-" };

const ROTER_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { verdopple } from "../src/rechnen.js";',
  'test("verdoppelt", () => assert.equal(verdopple(2), 4));',
  "",
].join("\n");

function funktion(erwarteterFehler) {
  return {
    id: "A1",
    art: "funktion",
    ziel: "Verdopple Zahlen",
    bereich: "src/rechnen.js",
    erwarteteDateien: ["src/rechnen.js", "test/rechnen.test.js"],
    vorbild: "src/text.js",
    abnahme: "test/rechnen.test.js",
    erwarteterFehler,
    wasDarfNiePassieren: NIE,
  };
}

test("ein grüner Auftrag committet einmal und schreibt die Belegdatei mit Befehl und Exit-Code", (context) => {
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST },
    bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" },
  };
  const { repo, werkzeug, lauf, beleg, basis } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(beleg.ergebnis, "grün");
  const namen = beleg.pruefungen.map(({ name }) => name);
  for (const name of ["rot", "grenzen test", "grenzen bau", "lint", "abnahme", "betroffene tests", "commit"]) {
    assert.ok(namen.includes(name), name);
  }
  for (const { name, befehl, exitCode } of beleg.pruefungen) {
    assert.ok(befehl.length > 0, name);
    assert.equal(exitCode, 0, name);
  }
  assert.equal(runIn(repo, "git", ["rev-list", "--count", `${basis}..HEAD`]).stdout.trim(), "1");
  const commit = runIn(repo, "git", ["show", "--name-only", "--format=", "HEAD"]).stdout;
  assert.deepEqual(commit.trim().split("\n").sort(), ["src/rechnen.js", "test/rechnen.test.js"]);
  assert.equal(beleg.kosten.gemessen, true);
  assert.equal(beleg.kosten.summe.turns, ANTWORTEN_JE_SITZUNG * beleg.agenten.length);
  assert.match(readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8"), /2 !== 4/);
});

test("die Commit-Nachricht zeigt die letzte Antwort des Bau-Agenten eingerückt, ohne Antwort keinen Abschnitt", (context) => {
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST },
    bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" },
  };
  const antwort = "Ich habe nur verdopple angepasst.\nPaket: 99";
  const mit = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: { ...drehbuch, "bau-antwort": antwort } });
  assert.equal(mit.lauf.status, 0, mit.lauf.stdout + mit.lauf.stderr);
  const nachricht = runIn(mit.repo, "git", ["log", "-1", "--format=%B"]).stdout;
  assert.ok(nachricht.includes("\nHinweise des Bau-Agenten:\n> Ich habe nur verdopple angepasst.\n> Paket: 99\n"), nachricht);
  assert.doesNotMatch(nachricht, /^Paket: 99$/m);
  const ohne = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  assert.equal(ohne.lauf.status, 0, ohne.lauf.stdout + ohne.lauf.stderr);
  assert.doesNotMatch(runIn(ohne.repo, "git", ["log", "-1", "--format=%B"]).stdout, /Hinweise des Bau-Agenten/);
});

test("ein roter Test mit falschem Fehlertext stoppt den Auftrag vor dem Bau-Agenten", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: {} };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("3 !== 4"), drehbuch });
  assert.equal(lauf.status, EXIT_ROT);
  assert.equal(beleg.ergebnis, "rot");
  const rot = beleg.pruefungen.find(({ name }) => name === "rot");
  assert.equal(rot.exitCode, EXIT_ROT);
  assert.ok(rot.zeilen.some((zeile) => zeile.includes("nicht mit dem erwarteten Fehler")));
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
});

test("der Bau-Agent wird an Bereich, Zeilengrenze, geschützten Dateien, Tests und Belegen gestoppt", (context) => {
  const faelle = [
    { bau: { "lib/fremd.js": "x\n" }, erwartet: "außerhalb des Bereichs src/: lib/fremd.js" },
    { bau: { "src/gross.js": "x\n".repeat(ZEILEN_UEBER_GRENZE) }, erwartet: "erlaubt sind 400" },
    { bau: { "src/geschuetzt.js": "export const WERT = 2;\n" }, erwartet: "geschützte Datei geändert" },
    { bau: { "test/text.test.js": "neu\n" }, erwartet: "Bau-Agent hat einen Test geändert" },
    { bau: { ".fortschritt/probe/A1.json": "{}\n" }, erwartet: "hat .fortschritt/ verändert" },
  ];
  for (const { bau, erwartet } of faelle) {
    const { lauf, beleg, basis, kopf } = starte(context, { auftrag: UMBAU, drehbuch: { bau } });
    assert.equal(lauf.status, EXIT_ROT, erwartet);
    assert.equal(beleg.ergebnis, "rot", erwartet);
    assert.ok(JSON.stringify(beleg).includes(erwartet), `${erwartet}: ${JSON.stringify(beleg)}`);
    assert.equal(kopf, basis, erwartet);
  }
});

test("gelöschte Zeilen zählen nicht zur Grenze: 360 gelöscht und 50 neu besteht sie", (context) => {
  const dateien = { "src/lang.js": "export const ZEILE = 1;\n".repeat(GELOESCHTE_ZEILEN) };
  const drehbuch = { bau: { "src/lang.js": "export const ZEILE = 2;\n".repeat(NEUE_ZEILEN) } };
  const { lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch, dateien });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const grenze = beleg.pruefungen.find(({ name }) => name === "grenzen bau");
  assert.equal(grenze.exitCode, 0);
  assert.ok(grenze.zeilen.includes(`grün: 1 Dateien geändert, ${NEUE_ZEILEN} neue Zeilen Produktcode, Rolle bau.`), grenze.zeilen.join("\n"));
});

test("der Test-Agent darf nur den Abnahmetest und erwartete Testdateien ändern", (context) => {
  const testDateien = { "test/rechnen.test.js": ROTER_TEST, "test/text.test.js": "angehängt\n" };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch: { test: testDateien } });
  assert.equal(lauf.status, EXIT_ROT);
  assert.ok(JSON.stringify(beleg).includes("fremden Test geändert: test/text.test.js"));
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
});

test("steigt der Test-Agent mit „Auftrag passt nicht“ aus, startet kein Bau-Agent und die Notiz nennt den Grund", (context) => {
  const grund = "Ziel und erwarteter Fehler widersprechen sich.";
  const drehbuch = { "test-antwort": `Auftrag passt nicht: ${grund}`, "notiz-antwort": "1. Ziel klären" };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch });
  assert.equal(lauf.status, EXIT_ROT);
  assert.deepEqual([beleg.ausstieg, beleg.runden], [grund, []]);
  assert.ok(beleg.entscheidung.text.includes(`Auftrag passt nicht: ${grund}`));
  assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), false);
});

test("lauf mit unvollständiger Phase startet keinen Agenten", (context) => {
  const ohneNie = { ...funktion("2 !== 4"), wasDarfNiePassieren: undefined };
  const { werkzeug, lauf } = starte(context, { auftrag: ohneNie, drehbuch: {} });
  assert.equal(lauf.status, EXIT_ROT);
  assert.match(lauf.stderr, /wasDarfNiePassieren fehlt/);
  assert.equal(existsSync(join(werkzeug, "prompt-test.txt")), false);
});

test("eine leere Liste wasDarfNiePassieren ist gültig, ein leerer Satz darin nicht", (context) => {
  const drehbuch = {
    test: { "test/rechnen.test.js": ROTER_TEST },
    bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" },
  };
  const leer = starte(context, { auftrag: { ...funktion("2 !== 4"), wasDarfNiePassieren: [] }, drehbuch });
  assert.equal(leer.lauf.status, 0, leer.lauf.stdout + leer.lauf.stderr);
  assert.equal(leer.beleg.ergebnis, "grün");
  const ohneSatz = starte(context, { auftrag: { ...funktion("2 !== 4"), wasDarfNiePassieren: [""] }, drehbuch });
  assert.equal(ohneSatz.lauf.status, EXIT_ROT);
  assert.match(ohneSatz.lauf.stderr, /wasDarfNiePassieren muss eine Liste von Sätzen sein/);
});

const NEU_MUTANT = "src/rechnen.js:2:7 ConditionalExpression → false";
const ALT_MUTANT = "src/text.js:2:10 MethodExpression → text";
const GLEICHWERTIG_MIT_GRUND = `Gleichwertig: ${NEU_MUTANT}, weil die Sieben ohne Sonderfall dasselbe Ergebnis hätte`;
const ERSATZ_MUTATION = `import { readFileSync } from "node:fs";
const lies = (pfad) => readFileSync(pfad, "utf8");
const alt = process.argv.includes("--alter-stand");
const offen = alt ? !lies("test/text.test.js").includes("leer") : lies("src/rechnen.js").includes("=== 7") && !lies("test/rechnen.test.js").includes("(7)");
const mutant = alt ? ${JSON.stringify(ALT_MUTANT)} : ${JSON.stringify(NEU_MUTANT)};
if (offen && !process.argv.includes(mutant)) process.exitCode = 1;
console.log(process.exitCode ? "Verstoß: Mutant überlebt: " + mutant : "grün: keiner überlebt");
`;
const MIT_MUTATION = {
  "mutation.mjs": ERSATZ_MUTATION,
  "package.json": BASIS["package.json"].replace('"lint"', '"test:mutation":"node mutation.mjs","lint"'),
};
const MIT_SIEBEN = { "src/rechnen.js": "export function verdopple(zahl) {\n  if (zahl === 7) return 0;\n  return zahl * 2;\n}\n" };
const SIEBEN_TEST = `${ROTER_TEST}test("sieben", () => assert.equal(verdopple(7), 0));\n`;

function pruefung(beleg, name) {
  return beleg.pruefungen.findLast((eintrag) => eintrag.name === name)?.exitCode;
}

test("überlebt ein Mutant, streicht oder meldet der Bau-Agent in seiner Sitzung, sonst ergänzt der Test-Agent", (context) => {
  const faelle = [
    { zusatz: { "bau-nachrunde-antwort": GLEICHWERTIG_MIT_GRUND }, letzte: "mutation nach Bau", nachricht: GLEICHWERTIG_MIT_GRUND },
    { zusatz: { "test-nachrunde": { "test/rechnen.test.js": SIEBEN_TEST } }, letzte: "mutation nach Test", nachricht: "Art: funktion" },
  ];
  for (const { zusatz, letzte, nachricht } of faelle) {
    const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: MIT_SIEBEN, ...zusatz };
    const { repo, werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: MIT_MUTATION });
    assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
    assert.deepEqual([pruefung(beleg, "mutation"), pruefung(beleg, letzte)], [EXIT_ROT, 0]);
    const [ersterBau, nachrunde] = beleg.agenten.filter(({ rolle }) => rolle === "bau");
    assert.equal(nachrunde.sitzung, ersterBau.sitzung);
    assert.match(readFileSync(join(werkzeug, "prompt-bau-nachrunde.txt"), "utf8"), /src\/rechnen\.js:2:7/);
    assert.ok(runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout.includes(nachricht), letzte);
  }
});

const PATCH = ".git/auftrag-umbau/probe/A1.patch";
const NOETIG_GRUND = "eine Sieben sonst verdoppelt würde";
const NOETIG = `Nötig: ${NEU_MUTANT}, weil ${NOETIG_GRUND}`;
const PASST_NICHT = "Auftrag passt nicht: Die Zeile ist nötig, nur der Test fehlt.";

function ehrlicheNachrunde(antwort) {
  return { "bau-nachrunde-antwort": { "Nötig: <Mutant>": antwort, "": PASST_NICHT } };
}

function mitSieben(context, zusatz) {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: MIT_SIEBEN, ...zusatz };
  return starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: MIT_MUTATION });
}

function pruefeGesichert({ repo, beleg }) {
  assert.equal(beleg.patch, join(realpathSync(repo), PATCH));
  assert.match(readFileSync(join(repo, PATCH), "utf8"), /^\+ {2}if \(zahl === 7\) return 0;$/m);
}

test("hält der Bau-Agent eine überlebende Zeile für nötig, ergänzt der Test-Agent den Test und der Auftrag wird grün", (context) => {
  const nachgeholt = { "test-nachrunde": { "test/rechnen.test.js": SIEBEN_TEST } };
  const { repo, werkzeug, lauf, beleg } = mitSieben(context, { ...ehrlicheNachrunde(NOETIG), ...nachgeholt });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.deepEqual([pruefung(beleg, "mutation"), pruefung(beleg, "mutation nach Test")], [EXIT_ROT, 0]);
  assert.ok(readFileSync(join(werkzeug, "prompt-test-nachrunde.txt"), "utf8").includes(NOETIG_GRUND));
  assert.equal(runIn(repo, "git", ["show", "HEAD:src/rechnen.js"]).stdout, MIT_SIEBEN["src/rechnen.js"]);
  assert.doesNotMatch(runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout, /^Gleichwertig: /m);
});

test("eine als nötig gemeldete Zeile gilt nie als gleichwertig; tötet kein Test den Mutanten, bleibt der Auftrag rot", (context) => {
  const ergebnis = mitSieben(context, ehrlicheNachrunde(`${NOETIG}\n${GLEICHWERTIG_MIT_GRUND}`));
  const { lauf, beleg } = ergebnis;
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.equal(beleg.grund, `Mutant überlebt: ${NEU_MUTANT}`);
  assert.equal(pruefung(beleg, "mutation nach Test"), EXIT_ROT);
  const mutationen = beleg.pruefungen.filter(({ name }) => name.startsWith("mutation"));
  assert.ok(mutationen.every(({ befehl }) => !befehl.includes("--gleichwertig")), JSON.stringify(mutationen));
  pruefeGesichert(ergebnis);
});

test("endet der Auftrag rot in der Mutationsprüfung, liegt der Bau als Patch am Ablageort und steht im Beleg", (context) => {
  const ergebnis = mitSieben(context, { "bau-nachrunde-antwort": PASST_NICHT });
  assert.equal(ergebnis.lauf.status, EXIT_ROT, ergebnis.lauf.stdout + ergebnis.lauf.stderr);
  assert.equal(pruefung(ergebnis.beleg, "mutation"), EXIT_ROT);
  pruefeGesichert(ergebnis);
});

test("ein Umbau ungeschützten Verhaltens wird verworfen; mit dem Test auf dem alten Stand läuft er neu", (context) => {
  const umbau = { "src/text.js": "export function gross(text) {\n  return text.toLocaleUpperCase();\n}\n" };
  const leerTest = { "test/text.test.js": `${BASIS["test/text.test.js"]}test("leer", () => assert.equal(gross(""), ""));\n` };
  for (const [nachrunde, status] of [[{}, EXIT_ROT], [leerTest, 0]]) {
    const drehbuch = { bau: umbau, "test-nachrunde": nachrunde };
    const { repo, werkzeug, lauf, beleg, basis } = starte(context, { auftrag: UMBAU, drehbuch, dateien: MIT_MUTATION });
    assert.equal(lauf.status, status, lauf.stdout + lauf.stderr);
    assert.ok(beleg.hinweise.includes(`Umbau verworfen: auf dem alten Stand überlebt ${ALT_MUTANT}`));
    assert.match(readFileSync(join(werkzeug, "prompt-test-nachrunde.txt"), "utf8"), /auf dem alten Stand/);
    const geaendert = runIn(repo, "git", ["diff", "--name-only", basis, "HEAD"]).stdout.trim();
    assert.equal(geaendert, status === 0 ? "src/text.js\ntest/text.test.js" : "");
  }
});

test("ein schon gebauter Auftrag wird übersprungen, ein neu geschnittener oder zurückgenommener nicht", (context) => {
  const gebaut = "Räume src auf\n\nWarum: gebaut.\n\nAuftrag: probe/A1\nArt: umbau";
  const zuruecknehmen = (repo) =>
    runIn(repo, "git", ["-c", "user.name=Probe", "-c", "user.email=probe@example.invalid", "revert", "--no-edit", "HEAD"]);
  const faelle = [
    { name: "gebaut", nachricht: gebaut, danach: () => {}, uebersprungen: true },
    { name: "neu geschnitten", nachricht: "Schneide den Auftrag A1 neu\n\nWarum: x.\n\nAuftrag: probe/A1", danach: () => {}, uebersprungen: false },
    { name: "andere Art", nachricht: gebaut.replace("Art: umbau", "Art: funktion"), danach: () => {}, uebersprungen: false },
    { name: "andere Phase", nachricht: gebaut.replace("probe/A1", "probe2/A1"), danach: () => {}, uebersprungen: false },
    { name: "nicht im letzten Absatz", nachricht: "x\n\nAuftrag: probe/A1\nArt: umbau\n\nWarum: y.", danach: () => {}, uebersprungen: false },
    { name: "zurückgenommen", nachricht: gebaut, danach: zuruecknehmen, uebersprungen: false },
  ];
  for (const { name, nachricht, danach, uebersprungen } of faelle) {
    const vorbereiten = (repo) => {
      writeFiles(repo, { "notiz.txt": name });
      commitAll(repo, nachricht);
      danach(repo);
    };
    const { werkzeug, lauf, basis, kopf } = starte(context, { auftrag: UMBAU, drehbuch: { bau: {} }, vorbereiten });
    assert.equal(existsSync(join(werkzeug, "prompt-bau.txt")), !uebersprungen, `${name}: ${lauf.stdout}${lauf.stderr}`);
    if (uebersprungen) {
      assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
      assert.equal(kopf, basis, name);
    }
  }
});

test("bei einer Fehlerbehebung bekommt der Bau-Agent den Commit, den git bisect als Ursprung findet", (context) => {
  const vorbereiten = (repo) => {
    writeFiles(repo, { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" });
    commitAll(repo, "Verdopple richtig");
    writeFiles(repo, { "src/rechnen.js": BASIS["src/rechnen.js"] });
    commitAll(repo, "Runde anders");
  };
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": MIT_SIEBEN["src/rechnen.js"] } };
  const auftrag = { ...funktion("2 !== 4"), art: "fehlerbehebung" };
  const { repo, werkzeug, lauf, beleg } = starte(context, { auftrag, drehbuch, vorbereiten });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  assert.equal(pruefung(beleg, "bisect"), 0);
  assert.match(readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8"), /eingeführt hat[\s\S]+ Runde anders/);
  assert.match(runIn(repo, "git", ["log", "-1", "--format=%B"]).stdout, /^Ursache: [\s\S]+^Eingeführt mit: \w+ Runde anders$/m);
});

const PIN_MELDUNG = "Befunde bewegt: 0 -> 1  id-length: Identifier name '_' is too short (< 2).";
const ERSATZ_PIN_PRUEFUNG = `import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
const dateien = process.argv.slice(2);
appendFileSync("pin-aufrufe.txt", JSON.stringify(dateien) + "\\n");
const zuViel = dateien.filter((datei) => execFileSync("git", ["show", ":" + datei], { encoding: "utf8" }).includes("const _"));
for (const datei of zuViel) console.error("[check-staged-suppressions] Commit abgebrochen:\\n  " + datei + "\\n     " + ${JSON.stringify(PIN_MELDUNG)} + "\\n[a]\\n[b]\\n[c]\\n[d]\\n[e]");
process.exitCode = zuViel.length > 0 ? 1 : 0;
`;
const MIT_PIN_PRUEFUNG = { ...MIT_MUTATION, "scripts/check-staged-suppressions.js": ERSATZ_PIN_PRUEFUNG, ".gitignore": `${BASIS[".gitignore"]}pin-aufrufe.txt\n` };
const MIT_UNTERSTRICH = { "src/rechnen.js": "export function verdopple(zahl) {\n  const _ = 2;\n  return zahl * _;\n}\n" };

test("die Pin-Prüfung läuft direkt nach lint; ihr Befund geht vor jeder Mutationsprüfung in die nächste Runde", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: MIT_UNTERSTRICH };
  const { repo, werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: MIT_PIN_PRUEFUNG });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  const namen = beleg.pruefungen.map(({ name }) => name);
  assert.equal(namen[namen.indexOf("lint") + 1], "pin-prüfung", namen.join(", "));
  assert.equal(pruefung(beleg, "pin-prüfung"), EXIT_ROT);
  assert.ok(!namen.some((name) => name.startsWith("mutation")), namen.join(", "));
  assert.equal(beleg.grund, `pin-prüfung endete mit Exit ${EXIT_ROT}.`);
  assert.ok(readFileSync(join(repo, "pin-aufrufe.txt"), "utf8").includes('"src/rechnen.js"'));
  const zweiteRunde = readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8");
  assert.ok(zweiteRunde.includes("src/rechnen.js") && zweiteRunde.includes(PIN_MELDUNG), zweiteRunde);
});

test("ist die Pin-Prüfung grün, geht der Auftrag weiter durch die Mutationsprüfung", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" } };
  const { lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: MIT_PIN_PRUEFUNG });
  assert.equal(lauf.status, 0, lauf.stdout + lauf.stderr);
  const namen = beleg.pruefungen.map(({ name }) => name);
  assert.ok(namen.indexOf("pin-prüfung") === namen.indexOf("lint") + 1 && namen.indexOf("pin-prüfung") < namen.indexOf("mutation"), namen.join(", "));
});

function scheitertAnPinPruefung(lauf, beleg) {
  const nachLint = beleg.pruefungen[beleg.pruefungen.findIndex(({ name }) => name === "lint") + 1];
  const ergebnis = { status: lauf.status, nachLint: nachLint?.name, exitCode: nachLint?.exitCode, grund: beleg.grund };
  assert.deepEqual(ergebnis, { status: EXIT_ROT, nachLint: "pin-prüfung", exitCode: EXIT_ROT, grund: `pin-prüfung endete mit Exit ${EXIT_ROT}.` }, lauf.stdout + lauf.stderr);
}

test("fehlt das Pin-Skript, obwohl ein pre-commit-Hook da ist, scheitert die Pin-Prüfung laut, und die zweite Runde bekommt die Meldung", (context) => {
  const drehbuch = { test: { "test/rechnen.test.js": ROTER_TEST }, bau: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" } };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: funktion("2 !== 4"), drehbuch, dateien: { ".githooks/pre-commit": "#!/bin/sh\nexit 0\n" } });
  scheitertAnPinPruefung(lauf, beleg);
  assert.ok(readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8").includes(PIN_FEHLT));
});
