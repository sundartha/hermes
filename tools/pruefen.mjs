import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { env } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expectedBlocks, FOLDER_INSTRUCTIONS, withBlock } from "./anweisungen-karte.mjs";
import { bausteinBefunde } from "./bausteine.mjs";
import { beendeRestlaeufe, starteLauf } from "./mutation-laeufe.mjs";
import { testschutzBefunde, TESTSCHUTZ_AUSWEG } from "./testschutz.mjs";

const REMOTES = ["hermes/master", "upstream/master", "origin/master"];
const CODE = /\.(?:[cm]?js|ts)$/;
const TESTDATEI = /^test\/.*\.test\.[cm]?[jt]s$/;
const OHNE_LOKALE_SPERRE = 20;
const LOKALE_SCHRITTE = ["lint", "bestaende", "typen", "katalog", "testschutz", "tests"];
const LOKALE_PROZESSE = "--test-concurrency=2";
const SEMGREP_REGELN = ["p/javascript", "p/typescript", "p/nodejsscan", "p/expressjs"];
const BESTAENDE = [
  { datei: "eslint-suppressions.json" },
  { datei: "tools/bausteine.json", feld: "altlast" },
  { datei: "tools/basis/lieferkette-ausnahmen.json" },
  ...["anfrage-mit-frist", "fester-importpfad", "keine-speicher-attrappe", "quelltext-als-text", "selbstpruefung", "zeitglieder-bestand"].map((name) => ({ datei: `tools/basis/${name}.json` })),
];
const MIGRATIONEN = "src/db/migrations";
const SQUAWK_AUSSCHLUSS = /squawk-ignore/i;
const SQUAWK_ENDUNG = /\.sql$/i;
const WERKZEUGE = dirname(dirname(fileURLToPath(import.meta.url)));
const DEPCRUISE = "node_modules/.bin/depcruise";
const ARCHITEKTUR_ORDNER = ["src", "test"];
const EXIT_ROT = 1;
const GROSSE_AUSGABE = 268_435_456;
const ERSTE_DATEI = 3;
const JSON_EINZUG = 2;
const MUTANT = "__STRYKER_ACTIVE_MUTANT__";
const MUTATION_PLAN = "MUTATION_PLAN";
const MUTANT_OHNE_PROCESS = [
  'import fs from "node:fs";',
  'import { syncBuiltinESMExports } from "node:module";',
  'const anker = "(g.__stryker__ = {})";',
  'const ersatz = "(g.__stryker__ = { activeMutant: " + JSON.stringify(process.env.__STRYKER_ACTIVE_MUTANT__) + " })";',
  "const lesen = fs.readFileSync;",
  "fs.readFileSync = function (...args) {",
  "  const inhalt = lesen.apply(this, args);",
  '  return typeof inhalt === "string" ? inhalt.replaceAll(anker, ersatz) : inhalt;',
  "};",
  "syncBuiltinESMExports();",
].join("\n");
const MUTANT_VORLADEN = `--import=data:text/javascript,${encodeURIComponent(MUTANT_OHNE_PROCESS)}`;
const MUTATION_PARALLEL = 4;
const MUTANTEN_JE_TEIL = 4;
const TEILE_HOECHSTENS = 20;
const ZAEHLEN = "MUTANTEN_ZAEHLEN";
const MINUTE_MS = 60_000;
const FRIST_MINUTEN = 20;
const MUTATION_FRIST_MS = FRIST_MINUTEN * MINUTE_MS;
const MUTANT_FRIST_MINUTEN = 10;
const MUTANT_FRIST_MS = MUTANT_FRIST_MINUTEN * MINUTE_MS;
const SCHUTZ = /stryMutAct_\w+\("(\d+)"\)/g;
const TESTFRIST_S = "180";
const BEGRUENDUNG_MINDESTENS = 20;
const MUTATION_ANZEIGE = 80;
const GETOETET = "getötet";
const STARTPFAD = /["'`]src["'`]\s*,\s*["'`]([\w.-]+\.m?js)["'`]|["'`](src\/[\w./-]+\.m?js)["'`]/g;
const EINBETTUNG = /new URL\(\s*["'`](\.{1,2}\/[\w./-]+\.m?js)["'`]\s*,\s*import\.meta\.url\s*\)/g;
const GLOBAL_GESETZT = /\b(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g;
const WORT = /[\w$]+/g;
const MERKMAL = /["'`]([^"'`\n]{4,})["'`]|\b([A-Za-z_$][\w$]{5,})\b/g;
const TS_ENDUNG = /(?<=\w)\.ts(?!\w)/g;
const HUNK = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/;
const NEUE_DATEI = "+++ b/";
const BEGRUENDET = /`([^`\s]+:\d+\/\d+)`[^\S\n]*[:–—-]?(.*)/g;
const LEERER_LAUF = "Leerer Lauf: keine Mutanten auf geänderten Zeilen unter src/, nichts geprüft.";
const MUTATION_AUSWEG = "Rot: Jeder nicht getötete Mutant braucht einen Test, der ihn tötet, oder unter „## Überlebende Mutanten“ im PR-Text eine Zeile mit seinem Schlüssel in Backticks und dem Grund, warum er äquivalent ist. Danach diesen Job neu starten.";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function lauf(befehl, args, optionen = {}) {
  return spawnSync(befehl, args, { stdio: "inherit", ...optionen }).status === 0;
}

function basisAus(argv) {
  const stelle = argv.indexOf("--basis");
  if (stelle !== -1) return argv[stelle + 1];
  const remote = REMOTES.find((ref) => spawnSync("git", ["rev-parse", "--verify", "-q", ref]).status === 0);
  if (remote === undefined) throw new Error(`Kein Master gefunden (${REMOTES.join(", ")}); --basis <sha> angeben.`);
  return git(["merge-base", "HEAD", remote]);
}

function geaendert(basis) {
  const liste = git(["diff", "--name-only", "--diff-filter=ACMR", basis]);
  return liste === "" ? [] : liste.split("\n").filter((pfad) => existsSync(pfad));
}

function geaenderteMigrationen(basis) {
  const liste = git(["diff", "-z", "--name-only", "--diff-filter=ACMR", basis, "--", MIGRATIONEN]);
  return liste === "" ? [] : liste.split("\0").filter((pfad) => pfad !== "");
}

function migrationsBefunde(dateien) {
  const falscheEndung = dateien.filter((pfad) => !SQUAWK_ENDUNG.test(pfad)).map((pfad) => `${pfad}: keine .sql-Datei, Squawk würde sie nie prüfen`);
  const ausschluss = dateien.filter((pfad) => SQUAWK_ENDUNG.test(pfad) && SQUAWK_AUSSCHLUSS.test(readFileSync(pfad, "utf8")));
  return [...falscheEndung, ...ausschluss.map((pfad) => `${pfad}: squawk-ignore schaltet eine Squawk-Regel ab; das ist eine Lockerung und braucht die Freigabe von Antonio`)];
}

function squawkLaeuft(dateien) {
  const programm = join(WERKZEUGE, "node_modules/.bin/squawk");
  if (!existsSync(programm)) {
    console.log("Squawk fehlt: erst npm ci ausführen.");
    return false;
  }
  return lauf(programm, ["-c", join(WERKZEUGE, "tools/basis/squawk.toml"), "--reporter", "gcc", ...dateien]);
}

function migrationenPruefen(basis) {
  const dateien = geaenderteMigrationen(basis);
  if (dateien.length === 0) {
    console.log("Migrationen: keine geänderte Migration.");
    return true;
  }
  const befunde = migrationsBefunde(dateien);
  for (const befund of befunde) console.log(befund);
  const squawk = squawkLaeuft(dateien.filter((pfad) => SQUAWK_ENDUNG.test(pfad)));
  return befunde.length === 0 && squawk;
}

function abhaengigkeiten(wurzel) {
  const { stdout } = spawnSync(join(process.cwd(), DEPCRUISE), [...ARCHITEKTUR_ORDNER, "--config", ".dependency-cruiser.cjs", "--output-type", "json"], {
    cwd: wurzel,
    encoding: "utf8",
    maxBuffer: GROSSE_AUSGABE,
  });
  return JSON.parse(stdout);
}

function verstoesse(wurzel) {
  return abhaengigkeiten(wurzel).summary.violations.map(({ rule, from, to }) => `${rule.name}: ${from} → ${to}`);
}

function bausteinkarteBefunde() {
  const { zuordnung, eingaenge, richtung, zusammenfassung } = bausteinBefunde(abhaengigkeiten(process.cwd()).modules);
  if (zusammenfassung !== undefined) console.log(zusammenfassung);
  const veraltet = [...expectedBlocks(process.cwd())]
    .filter(([ordner, block]) => {
      const pfad = join(ordner, FOLDER_INSTRUCTIONS);
      const text = existsSync(pfad) ? readFileSync(pfad, "utf8") : "";
      return withBlock(text, block) !== text;
    })
    .map(([ordner]) => `${ordner}${FOLDER_INSTRUCTIONS} passt nicht mehr zu tools/bausteine.json: npm run hinweise ausführen.`);
  return [...zuordnung, ...eingaenge, ...richtung, ...veraltet];
}

function graph() {
  const nutzer = new Map();
  for (const { source, dependencies } of abhaengigkeiten(process.cwd()).modules) {
    for (const { resolved } of dependencies) nutzer.set(resolved, [...(nutzer.get(resolved) ?? []), source]);
  }
  return nutzer;
}

function testTiefen(dateien, nutzer) {
  const tiefen = new Map(dateien.filter((pfad) => TESTDATEI.test(pfad)).map((pfad) => [pfad, 0]));
  const gesehen = new Set(dateien);
  let rand = dateien;
  for (let tiefe = 0; rand.length > 0; tiefe += 1) {
    const naechste = [...new Set(rand.flatMap((pfad) => nutzer.get(pfad) ?? []))].filter((pfad) => !gesehen.has(pfad));
    for (const pfad of naechste) {
      gesehen.add(pfad);
      if (TESTDATEI.test(pfad)) tiefen.set(pfad, tiefe);
    }
    rand = naechste;
  }
  return tiefen;
}

export function betroffeneTests(dateien) {
  const tiefen = testTiefen(dateien, graph());
  const alle = [...tiefen.keys()].sort();
  return { direkt: alle.filter((pfad) => tiefen.get(pfad) === 0), alle };
}

function blatt(eintrag) {
  return typeof eintrag === "string" ? eintrag : JSON.stringify(eintrag);
}

function eintraege(wert, schluessel = "", liste = new Map()) {
  const dazu = (name, anzahl) => liste.set(name, (liste.get(name) ?? 0) + anzahl);
  if (typeof wert === "number") dazu(schluessel, wert);
  else if (typeof wert === "string") dazu(`${schluessel}|${wert}`, 1);
  else if (Array.isArray(wert)) for (const eintrag of wert) dazu(`${schluessel}|${blatt(eintrag)}`, 1);
  else if (wert !== null && typeof wert === "object") {
    for (const [name, eintrag] of Object.entries(wert)) eintraege(eintrag, `${schluessel}|${name}`, liste);
  }
  return liste;
}

function bestandAuf(stand, { datei, feld }) {
  const text = stand === null ? (existsSync(datei) ? readFileSync(datei, "utf8") : "") : spawnSync("git", ["show", `${stand}:${datei}`], { encoding: "utf8" }).stdout;
  if (!text) return new Map();
  const inhalt = JSON.parse(text);
  return eintraege(feld === undefined ? inhalt : inhalt[feld]);
}

function ohneUmzug(vorher, jetzt) {
  const verschwunden = new Map([...vorher].map(([name, anzahl]) => [name, anzahl - (jetzt.get(name) ?? 0)]));
  return [...jetzt].filter(([name, anzahl]) => {
    const alt = name.replace(TS_ENDUNG, ".js");
    let offen = anzahl - (vorher.get(name) ?? 0);
    while (offen > 0 && alt !== name && !vorher.has(name) && !jetzt.has(alt) && (verschwunden.get(alt) ?? 0) > 0) {
      verschwunden.set(alt, verschwunden.get(alt) - 1);
      offen -= 1;
    }
    return offen > 0;
  }).map(([name]) => name);
}

export function gewachseneEintraege(vorher, jetzt) {
  return ohneUmzug(vorher, jetzt).map((name) => name.slice(1));
}

function neueVerstoesse(bekannt, kopf) {
  const zaehlen = (liste) => new Map([...new Set(liste)].map((verstoss) => [verstoss, 1]));
  return ohneUmzug(zaehlen(bekannt), zaehlen(kopf));
}

function geaenderteBereiche(basis) {
  let datei = null;
  return git(["diff", "-U0", basis, "--", "src"]).split("\n").flatMap((zeile) => {
    if (zeile.startsWith("+++ ")) datei = zeile.startsWith(NEUE_DATEI) && CODE.test(zeile) ? zeile.slice(NEUE_DATEI.length) : null;
    const [, von, anzahl = "1"] = HUNK.exec(zeile) ?? [];
    return von === undefined || datei === null || anzahl === "0" ? [] : [{ datei, von: Number(von), bis: Number(von) + Number(anzahl) - 1 }];
  });
}

function mitStartkanten(nutzer) {
  for (const pfad of git(["ls-files", "test"]).split("\n").filter((datei) => CODE.test(datei))) {
    for (const [, name, voll] of readFileSync(pfad, "utf8").matchAll(STARTPFAD)) {
      const ziel = voll ?? `src/${name}`;
      nutzer.set(ziel, [...(nutzer.get(ziel) ?? []), pfad]);
    }
  }
  return nutzer;
}

function einbettungen() {
  return git(["ls-files", "src"]).split("\n").filter((datei) => CODE.test(datei)).flatMap((pfad) =>
    [...readFileSync(pfad, "utf8").matchAll(EINBETTUNG)].map(([, verweis]) => ({ pfad, ziel: join(dirname(pfad), verweis) })));
}

function mitEinbettungen(nutzer, kanten) {
  for (const { pfad, ziel } of kanten) nutzer.set(ziel, [...(nutzer.get(ziel) ?? []), pfad]);
  return nutzer;
}

function nennendeTests(ziel, nutzer) {
  const stamm = basename(ziel, extname(ziel));
  const globale = new Set([...readFileSync(ziel, "utf8").matchAll(GLOBAL_GESETZT)].map(([, global]) => global));
  const nennt = (pfad) => {
    const text = readFileSync(pfad, "utf8");
    return pfad.includes(stamm) || text.includes(stamm) || (text.match(WORT) ?? []).some((wort) => globale.has(wort));
  };
  const testcode = git(["ls-files", "test"]).split("\n").filter((datei) => CODE.test(datei));
  return new Set(testTiefen(testcode.filter(nennt), nutzer).keys());
}

function erreichendeTests(dateien, nutzer, eingebettet) {
  const tiefen = testTiefen(dateien.filter((pfad) => !eingebettet.has(pfad)), nutzer);
  for (const ziel of dateien.filter((pfad) => eingebettet.has(pfad))) {
    const nennend = nennendeTests(ziel, nutzer);
    for (const [pfad, tiefe] of testTiefen([ziel], nutzer)) {
      if (nennend.has(pfad)) tiefen.set(pfad, Math.min(tiefe, tiefen.get(pfad) ?? tiefe));
    }
  }
  return tiefen;
}

function mutationTests(bereiche) {
  const kanten = einbettungen();
  const nutzer = mitEinbettungen(mitStartkanten(graph()), kanten);
  const tiefen = erreichendeTests([...new Set(bereiche.map(({ datei }) => datei))], nutzer, new Set(kanten.map(({ ziel }) => ziel)));
  const zeilen = bereiche.flatMap(({ datei, von, bis }) => readFileSync(datei, "utf8").split("\n").slice(von - 1, bis));
  const merkmale = [...new Set([...zeilen.join("\n").matchAll(MERKMAL)].map(([, text, name]) => text ?? name))];
  const treffer = new Map([...tiefen.keys()].map((pfad) => [pfad, readFileSync(pfad, "utf8")]).map(([pfad, text]) => [pfad, merkmale.filter((merkmal) => text.includes(merkmal)).length]));
  const direkt = (pfad) => Math.min(tiefen.get(pfad), 1);
  return [...tiefen.keys()].sort((links, rechts) => direkt(links) - direkt(rechts) || treffer.get(rechts) - treffer.get(links) || links.localeCompare(rechts));
}

function testdateiGruen(datei, mitMutant, { laeufe, abdeckung }) {
  const umgebung = { ...env, NODE_ENV: "test", TESTS_DATEIGRENZE_S: TESTFRIST_S, NODE_V8_COVERAGE: abdeckung, [MUTANT]: mitMutant ? env[MUTANT] : undefined, ...(mitMutant && { NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} ${MUTANT_VORLADEN}`.trim() }) };
  return starteLauf(["test/testbaenke-run.mjs", "regression", datei], { env: umgebung, stdio: "ignore" }, laeufe);
}

export function schutzOrte(dateien) {
  const orte = dateien.flatMap((datei) => [...readFileSync(datei, "utf8").matchAll(SCHUTZ)].map(({ 1: id, index }) => [id, { datei: resolve(datei), offset: index }]));
  return Object.fromEntries(orte.reverse());
}

export function ausgefuehrteMutanten(prozesse, orte) {
  const luecke = (offset) => ({ ranges }) => ranges.some(({ count, startOffset, endOffset }) => count === 0 && startOffset <= offset && offset < endOffset);
  return Object.entries(orte)
    .filter(([, { datei, offset }]) => prozesse.some((skripte) => skripte.some(({ url, functions }) => url.replace(/[?#].*$/, "") === pathToFileURL(datei).href && !functions.some(luecke(offset)))))
    .map(([id]) => id);
}

async function ausfuehrung(plan, datei, lauf) {
  if (plan.abdeckung === undefined) return null;
  const pfad = join(plan.abdeckung, `${plan.tests.indexOf(datei)}.json`);
  if (existsSync(pfad)) return JSON.parse(readFileSync(pfad, "utf8"));
  const ordner = `${pfad}.v8`;
  const gruen = await testdateiGruen(datei, false, { ...lauf, abdeckung: ordner });
  const ids = gruen && existsSync(ordner) ? ausgefuehrteMutanten(readdirSync(ordner).map((name) => JSON.parse(readFileSync(join(ordner, name), "utf8")).result), schutzOrte(plan.dateien)) : null;
  rmSync(ordner, { recursive: true, force: true });
  if (!lauf.beendet()) writeFileSync(pfad, JSON.stringify(ids));
  return ids;
}

async function mutantGegenTests(plan) {
  const basisRot = new Set(existsSync(plan.basisRot) ? JSON.parse(readFileSync(plan.basisRot, "utf8")) : []);
  const offen = plan.tests.filter((datei) => !basisRot.has(datei));
  const stand = { test: null, frist: false };
  const lauf = { laeufe: new Set(), beendet: () => stand.test !== null };
  const ende = Math.min(plan.frist, Date.now() + MUTANT_FRIST_MS);
  const eingebettet = (plan.eingebettet ?? []).includes(relative(process.cwd(), schutzOrte(plan.dateien ?? [])[env[MUTANT]]?.datei ?? ""));
  const fuehrtAus = async (datei) => {
    const ausgefuehrt = eingebettet ? null : await ausfuehrung(plan, datei, lauf);
    return ausgefuehrt === null || ausgefuehrt.includes(env[MUTANT]);
  };
  const pruefe = async (datei) => {
    if (!(await fuehrtAus(datei)) || stand.test !== null || (await testdateiGruen(datei, true, lauf)) || stand.test !== null) return;
    const basisGruen = await testdateiGruen(datei, false, lauf);
    if (stand.test !== null) return;
    if (!basisGruen) {
      basisRot.add(datei);
      return;
    }
    stand.test = datei;
    beendeRestlaeufe(lauf.laeufe);
  };
  const arbeiter = async () => {
    while (stand.test === null && offen.length > 0 && !stand.frist) {
      stand.frist = Date.now() > ende;
      if (!stand.frist) await pruefe(offen.shift());
    }
  };
  await Promise.all(Array.from({ length: MUTATION_PARALLEL }, arbeiter));
  writeFileSync(plan.basisRot, JSON.stringify([...basisRot]));
  if (stand.test !== null) return { ergebnis: GETOETET, test: stand.test };
  return { ergebnis: stand.frist ? "nicht geprüft (Frist)" : "überlebt" };
}

const teilNummer = () => Number(env.TEIL ?? 0);
const teilAnzahl = () => Number(env.TEILE ?? 1);
const eigenerMutant = (id) => Number(id) % teilAnzahl() === teilNummer();

async function mutantPruefen() {
  if (env[MUTANT] === undefined) return true;
  if (env[ZAEHLEN] !== undefined) return true;
  if (!eigenerMutant(env[MUTANT])) return false;
  const plan = JSON.parse(readFileSync(env[MUTATION_PLAN], "utf8"));
  const ergebnis = await mutantGegenTests(plan);
  appendFileSync(plan.protokoll, `${JSON.stringify({ id: env[MUTANT], ...ergebnis })}\n`);
  return ergebnis.ergebnis !== GETOETET;
}

function eigeneMutanten(bericht, protokoll) {
  const zeilen = existsSync(protokoll) ? readFileSync(protokoll, "utf8").trim().split("\n") : [];
  const ergebnisse = new Map(zeilen.map((zeile) => JSON.parse(zeile)).map(({ id, ...ergebnis }) => [id, ergebnis]));
  const alle = Object.entries(JSON.parse(readFileSync(bericht, "utf8")).files).flatMap(([datei, { mutants }]) => mutants.map((mutant) => ({ datei, ...mutant })));
  return alle.filter(({ id }) => eigenerMutant(id)).map(({ id, datei, mutatorName, replacement, location }) => ({
    schluessel: `${relative(process.cwd(), datei)}:${location.start.line}/${id}`,
    mutation: `${mutatorName}: ${replacement ?? ""}`.replaceAll(/\s+/g, " ").replaceAll(/[|`]/g, "'").slice(0, MUTATION_ANZEIGE),
    ...(ergebnisse.get(id) ?? { ergebnis: "ohne Ergebnis" }),
  }));
}

function teileSchreiben(bericht) {
  const anzahl = bericht === null ? 0 : Object.values(JSON.parse(readFileSync(bericht, "utf8")).files).reduce((summe, { mutants }) => summe + mutants.length, 0);
  const teile = Math.min(TEILE_HOECHSTENS, Math.max(1, Math.ceil(anzahl / MUTANTEN_JE_TEIL)));
  console.log(`${anzahl} Mutanten, ${teile} Teile`);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `teile=${JSON.stringify(Array.from({ length: teile }, (leer, index) => index + 1))}\n`);
  return true;
}

function mutationTeil(argv) {
  const zaehlen = argv.includes("--zaehlen");
  const bereiche = geaenderteBereiche(basisAus(argv));
  if (bereiche.length === 0) return zaehlen ? teileSchreiben(null) : mutationUrteil([], 0);
  const ordner = mkdtempSync(join(tmpdir(), "mutation-"));
  const [planDatei, bericht, konfiguration, protokoll] = ["plan.json", "bericht.json", "stryker.json", "protokoll.jsonl"].map((name) => join(ordner, name));
  const plan = { frist: Date.now() + MUTATION_FRIST_MS, tests: mutationTests(bereiche), protokoll, basisRot: join(ordner, "basis-rot.json"), abdeckung: join(ordner, "abdeckung"), dateien: [...new Set(bereiche.map(({ datei }) => datei))], eingebettet: einbettungen().map(({ ziel }) => ziel) };
  mkdirSync(plan.abdeckung);
  writeFileSync(planDatei, JSON.stringify(plan));
  const mutate = bereiche.map(({ datei, von, bis }) => `${datei}:${von}-${bis}`);
  writeFileSync(konfiguration, JSON.stringify({ testRunner: "command", commandRunner: { command: "node tools/pruefen.mjs mutant" }, inPlace: true, concurrency: 1, coverageAnalysis: "off", timeoutMS: MUTATION_FRIST_MS, mutate, reporters: ["json"], jsonReporter: { fileName: bericht }, logLevel: "warn" }));
  console.log(`${mutate.join(" ")}: ${plan.tests.length} Testdateien erreichen den Code, zuerst ${plan.tests.slice(0, ERSTE_DATEI).join(" ")}`);
  const start = Date.now();
  if (!lauf("npx", ["stryker", "run", konfiguration], { env: { ...env, [MUTATION_PLAN]: planDatei, ...(zaehlen && { [ZAEHLEN]: "1" }) } })) return false;
  if (zaehlen) return teileSchreiben(bericht);
  const mutanten = eigeneMutanten(bericht, protokoll);
  for (const mutant of mutanten) console.log(`${mutant.schluessel} ${mutant.mutation} → ${mutant.ergebnis} ${mutant.test ?? ""}`);
  return mutationUrteil(mutanten, (Date.now() - start) / MINUTE_MS);
}

function mutationUrteil(mutanten, minuten) {
  const abschnitt = (env.PR_TEXT ?? "").split(/^## /m).find((teil) => teil.startsWith("Überlebende Mutanten")) ?? "";
  const begruendet = new Map([...abschnitt.matchAll(BEGRUENDET)].map(([, schluessel, grund]) => [schluessel, grund.trim()]).filter(([, grund]) => grund.length >= BEGRUENDUNG_MINDESTENS));
  const lebend = mutanten.filter(({ ergebnis }) => ergebnis !== GETOETET);
  const offen = lebend.filter(({ schluessel }) => !begruendet.has(schluessel));
  const tabelle = lebend.map(({ schluessel, mutation, ergebnis }) => `| \`${schluessel}\` | \`${mutation}\` | ${ergebnis} | ${begruendet.get(schluessel)?.slice(0, MUTATION_ANZEIGE) ?? "–"} |`);
  const zaehlung = mutanten.length === 0 ? LEERER_LAUF : `${mutanten.length - lebend.length} von ${mutanten.length} Mutanten getötet, ${offen.length} von ${lebend.length} übrigen ohne Begründung, ${minuten.toFixed(1)} min.`;
  const kopf = `### Mutation ${teilNummer() + 1}/${teilAnzahl()} auf den geänderten Zeilen unter src/\n\n${zaehlung}\n`;
  const text = [kopf, ...(tabelle.length > 0 ? ["| Mutant | Mutation | Ergebnis | Begründung im PR-Text |", "|---|---|---|---|", ...tabelle, ""] : []), ...(offen.length > 0 ? [MUTATION_AUSWEG] : [])].join("\n");
  console.log(text);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
  return offen.length === 0;
}

const SCHRITTE = {
  lint(basis) {
    const dateien = geaendert(basis).filter((pfad) => CODE.test(pfad));
    return dateien.length === 0 || lauf("npx", ["eslint", ...dateien]);
  },
  bestaende(basis) {
    const gewachsen = BESTAENDE.flatMap((bestand) => {
      const neu = gewachseneEintraege(bestandAuf(basis, bestand), bestandAuf(null, bestand));
      return neu.map((eintrag) => `${bestand.datei}: neu oder öfter eingefroren: ${eintrag}`);
    });
    for (const zeile of gewachsen) console.log(zeile);
    if (gewachsen.length > 0) console.log("Eingefrorene Bestände dürfen nur schrumpfen: Behebe den Befund, statt ihn einzufrieren.");
    else console.log(`Eingefrorene Bestände: kein Eintrag neu oder gewachsen (${BESTAENDE.length} Dateien).`);
    return gewachsen.length === 0;
  },
  typen: () => lauf("npx", ["tsc", "--noEmit"]),
  architektur(basis) {
    const karte = bausteinkarteBefunde();
    for (const befund of karte) console.log(befund);
    const ordner = mkdtempSync(join(tmpdir(), "architektur-basis-"));
    try {
      git(["worktree", "add", "--detach", ordner, basis]);
      symlinkSync(join(process.cwd(), "node_modules"), join(ordner, "node_modules"));
      const bekannt = new Set(verstoesse(ordner));
      const neu = neueVerstoesse([...bekannt], verstoesse(process.cwd()));
      for (const verstoss of neu) console.log(`Neuer Architekturverstoß: ${verstoss}`);
      console.log(`Architektur: ${neu.length} neue Verstöße gegen .dependency-cruiser.cjs (${bekannt.size} auf der Basis).`);
      return neu.length === 0 && karte.length === 0;
    } finally {
      git(["worktree", "remove", "--force", ordner]);
      rmSync(ordner, { recursive: true, force: true });
    }
  },
  semgrep(basis) {
    const args = ["scan", ...SEMGREP_REGELN.flatMap((regel) => ["--config", regel]), "--baseline-commit", basis, "--error", "--metrics=off", "--quiet"];
    if (spawnSync("semgrep", ["--version"]).status === 0) return lauf("semgrep", args);
    console.log("Semgrep übersprungen: semgrep nicht installiert; die CI prüft es.");
    return true;
  },
  tests(basis) {
    const { direkt, alle } = betroffeneTests(geaendert(basis));
    const auswahl = direkt.slice(0, OHNE_LOKALE_SPERRE);
    console.log(`${alle.length - auswahl.length} weitere betroffene Tests laufen nur in der CI.`);
    return auswahl.length === 0 || lauf("npm", ["test", "--", ...auswahl, "--", LOKALE_PROZESSE]);
  },
  migrationen: migrationenPruefen,
  katalog: (basis) => lauf("node", ["tools/katalog-pruefen.mjs", "--basis", basis]),
  testschutz(basis) {
    const befunde = testschutzBefunde(basis);
    for (const befund of befunde) console.log(befund);
    if (befunde.length > 0) console.log(TESTSCHUTZ_AUSWEG);
    return befunde.length === 0;
  },
};

async function main() {
  const [, , gewuenscht] = process.argv;
  const mutation = { mutant: mutantPruefen, mutation: () => mutationTeil(process.argv) }[gewuenscht];
  if (mutation !== undefined) {
    if (!(await mutation())) process.exitCode = EXIT_ROT;
    return;
  }
  if (gewuenscht === "betroffen") {
    const dateien = process.argv.slice(ERSTE_DATEI);
    console.log(JSON.stringify(betroffeneTests(dateien), null, JSON_EINZUG));
    return;
  }
  const basis = basisAus(process.argv);
  const namen = gewuenscht && Object.hasOwn(SCHRITTE, gewuenscht) ? [gewuenscht] : LOKALE_SCHRITTE;
  const rot = namen.filter((name) => {
    console.log(`\n# ${name}`);
    return !SCHRITTE[name](basis);
  });
  console.log(rot.length === 0 ? "\nAlles grün." : `\nRot: ${rot.join(", ")}`);
  if (rot.length > 0) process.exitCode = EXIT_ROT;
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
