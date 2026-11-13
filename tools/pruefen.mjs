import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import process, { env } from "node:process";
import { setTimeout as warte } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

import { expectedBlocks, FOLDER_INSTRUCTIONS, withBlock } from "./anweisungen-karte.mjs";
import { bausteinBefunde } from "./bausteine.mjs";
import { beendeRestlaeufe, starteLauf } from "./mutation-laeufe.mjs";
import { pruefeTiefe } from "./schwerlauf/sperre.mjs";
import { testschutzBefunde, TESTSCHUTZ_AUSWEG } from "./testschutz.mjs";

const REMOTES = ["hermes/master", "upstream/master", "origin/master"];
const CODE = /\.(?:[cm]?js|ts)$/;
const TESTDATEI = /^test\/.*\.test\.[cm]?[jt]s$/;
const WIDGET_LADER = "test/gemeinsam/ausgelieferte-widgets.js";
const AUSGELIEFERT = /^src\/ui\//;
const OHNE_LOKALE_SPERRE = 20;
const LOKALE_SCHRITTE = ["lint", "bestaende", "typen", "architektur", "katalog", "testschutz", "tests"];
const LOKALE_PROZESSE = "--test-concurrency=2";
export const SEMGREP_REGELN = ["p/javascript", "p/typescript", "p/nodejsscan", "p/expressjs"];
export const BESTAENDE = [
  { datei: "eslint-suppressions.json" },
  { datei: "tools/bausteine.json", feld: "altlast" },
  { datei: "tools/basis/lieferkette-ausnahmen.json" },
  ...["fester-importpfad", "keine-speicher-attrappe", "quelltext-als-text", "selbstpruefung", "zeitglieder-bestand"].map((name) => ({ datei: `tools/basis/${name}.json` })),
];
const MIGRATIONEN = "src/db/migrations";
const MIGRATE_DATEI = "src/db/migrate.js";
const MIGRATIONSNAME = /["'](\d{4}_[a-z0-9_]+\.sql)["']/g;
const SQUAWK_AUSSCHLUSS = /squawk-ignore/i;
const SQUAWK_ENDUNG = /\.sql$/i;
const WERKZEUGE = dirname(dirname(fileURLToPath(import.meta.url)));
const DEPCRUISE = "node_modules/.bin/depcruise";
const ARCHITEKTUR_ORDNER = ["src", "test"];
const BAUSTEINKARTE = "tools/bausteine.json";
const EXIT_ROT = 1;
const GROSSE_AUSGABE = 268_435_456;
const ERSTE_DATEI = 3;
const JSON_EINZUG = 2;
const NUMMER_STELLEN = 4;
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
const ABDECKUNG = "MUTATION_ABDECKUNG";
const WERKZEUG_STEUERUNG = [MUTANT, MUTATION_PLAN, ZAEHLEN, ABDECKUNG, "TEIL", "TEILE"];
const SEKUNDE_MS = 1000;
const MINUTE_MS = 60_000;
const SPERRDATEI = "/tmp/hermes-pruefen.lock";
const SPERRE_VERMERK = "HERMES_PRUEFEN_SPERRE";
const SPERRE_WARTEN_MIN = 30;
const SPERRE_TAKT_MS = 500;
const EXIT_SIGNAL = 128;
const SIGNALE = { SIGINT: 2, SIGTERM: 15, SIGHUP: 1 };
const FRIST_MINUTEN = 45;
const MUTATION_FRIST_MS = FRIST_MINUTEN * MINUTE_MS;
const MUTANT_FRIST_MINUTEN = 25;
const MUTANT_FRIST_MS = MUTANT_FRIST_MINUTEN * MINUTE_MS;
const KONTROLLLAEUFE = 2;
const SCHUTZ = /stryMutAct_\w+\("(\d+)"\)/g;
const BEGRUENDUNG_MINDESTENS = 20;
const MUTATION_ANZEIGE = 80;
const GETOETET = "getötet";
const STARTPFAD = /["'`]src["'`]\s*,\s*["'`]([\w.-]+\.m?js)["'`]|["'`](src\/[\w./-]+\.m?js)["'`]/g;
const EINBETTUNG = /new URL\(\s*["'`](\.{1,2}\/[\w./-]+\.m?js)["'`]\s*,\s*import\.meta\.url\s*\)/g;
const GLOBAL_GESETZT = /\b(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g;
const WORT = /[\w$]+/g;
const STRYKER_AUFRUF = /\bstry\w+(?:\([^()]*\))?|(["'`])\1/g;
const MERKMAL = /["'`]([^"'`\n]{4,})["'`]|\b([A-Za-z_$][\w$]{5,})\b/g;
const TS_ENDUNG = /(?<=\w)\.ts(?!\w)/g;
const TESTORDNER_UMZUG = /(?<![\w/.-])test\/[\w-]+\/([\w-]+\.\w+)(?![\w/])/g;
const HUNK = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const NEUE_DATEI = "+++ b/";
const BEGRUENDET = /`([^`\s]+:\d+\/\d+)`[^\S\n]*[:–—-]?(.*)/g;
const GETOETET_VON = /`([^`\s]+:\d+\/(\d+))`[^\S\n]+wird getötet von[^\S\n]+`([^`\s]+\.test\.[cm]?[jt]s)`/g;
const AEQUIVALENTE = "test/gemeinsam/aequivalente-mutanten.json";
const SCHLUESSEL_IM_TEXT = /[\w./-]+\.m?[jt]s:\d+(?:\/\d+)?/;
const FORM_BEISPIEL = "`src/datei.js:zeile/id` wird getötet von `test/datei.test.js`  oder  `src/datei.js:zeile/id`: Grund, warum der Mutant äquivalent ist (mindestens 20 Zeichen)";
const LEERER_LAUF = "Leerer Lauf: keine Mutanten auf geänderten Zeilen unter src/, nichts geprüft.";
const MUTATION_AUSWEG = "Rot: Jeder nicht getötete Mutant braucht einen Test, der ihn tötet; nur ein überlebender kann stattdessen unter „## Überlebende Mutanten“ im PR-Text eine Zeile mit seinem Schlüssel in Backticks und dem Grund, warum er äquivalent ist, bekommen. Danach diesen Job neu starten.";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: GROSSE_AUSGABE }).trim();
}

function lauf(befehl, args, optionen = {}) {
  return spawnSync(befehl, args, { stdio: "inherit", ...optionen }).status === 0;
}

export function basisAus(argv) {
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

function migrationsNamenAusListe(text) {
  return [...text.matchAll(MIGRATIONSNAME)].map((treffer) => treffer[1]);
}

function migrationsNamenImOrdner() {
  return existsSync(MIGRATIONEN) ? readdirSync(MIGRATIONEN).filter((name) => SQUAWK_ENDUNG.test(name)) : null;
}

function nummernBefunde(namen) {
  const nummern = namen.map((name) => Number(name.slice(0, NUMMER_STELLEN)));
  const doppelt = nummern.filter((nummer, stelle) => nummern.indexOf(nummer) !== stelle).map((nummer) => `Nummer ${String(nummer).padStart(NUMMER_STELLEN, "0")} kommt doppelt vor`);
  const fehlend = Array.from({ length: Math.max(0, ...nummern) }, (leer, stelle) => stelle + 1).filter((nummer) => !nummern.includes(nummer));
  return [...doppelt, ...fehlend.map((nummer) => `Nummer ${String(nummer).padStart(NUMMER_STELLEN, "0")} fehlt in der Nummerierung ab 0001`)];
}

function abgleichBefunde(liste, ordner) {
  if (liste.length === 0) return [`${MIGRATE_DATEI}: enthält keinen Migrationsnamen`];
  const ordnerBefund = ordner === null ? [`${MIGRATIONEN}: Ordner fehlt`] : [];
  const imOrdner = ordner ?? [];
  const ohneListe = imOrdner.filter((name) => !liste.includes(name)).map((name) => `${name}: liegt im Ordner, steht aber nicht in ${MIGRATE_DATEI}`);
  const ohneDatei = liste.filter((name) => !imOrdner.includes(name)).map((name) => `${name}: steht in ${MIGRATE_DATEI}, aber die Datei fehlt im Ordner`);
  return [...ordnerBefund, ...ohneListe, ...ohneDatei, ...nummernBefunde(liste)];
}

function migrationenAbgleich() {
  if (!existsSync(MIGRATE_DATEI)) {
    console.log("Migrationen: kein src/db/migrate.js, kein Abgleich.");
    return true;
  }
  const befunde = abgleichBefunde(migrationsNamenAusListe(readFileSync(MIGRATE_DATEI, "utf8")), migrationsNamenImOrdner());
  for (const befund of befunde) console.log(befund);
  return befunde.length === 0;
}

function migrationenPruefen(basis) {
  const abgleichGruen = migrationenAbgleich();
  const dateien = geaenderteMigrationen(basis);
  if (dateien.length === 0) {
    console.log("Migrationen: keine geänderte Migration.");
    return abgleichGruen;
  }
  const befunde = migrationsBefunde(dateien);
  for (const befund of befunde) console.log(befund);
  const squawk = squawkLaeuft(dateien.filter((pfad) => SQUAWK_ENDUNG.test(pfad)));
  return abgleichGruen && befunde.length === 0 && squawk;
}

function abhaengigkeiten(wurzel) {
  const { stdout } = spawnSync(join(process.cwd(), DEPCRUISE), [...ARCHITEKTUR_ORDNER, "--config", ".dependency-cruiser.cjs", "--output-type", "json"], {
    cwd: wurzel,
    encoding: "utf8",
    maxBuffer: GROSSE_AUSGABE,
  });
  return JSON.parse(stdout);
}

export function verstoesseAus(graph) {
  return graph.summary.violations.flatMap(({ rule, from, to, cycle = [] }) => (rule.name === "keine-ordnerzyklen" ? [from, to, ...cycle.map(({ name }) => name)].map((ordner) => `${rule.name}: ${ordner}`) : [`${rule.name}: ${from} → ${to}`]));
}

function bausteinkarteBefunde(graph = abhaengigkeiten(process.cwd())) {
  const { zuordnung, eingaenge, richtung, zusammenfassung } = bausteinBefunde(graph.modules);
  const veraltet = [...expectedBlocks(process.cwd())]
    .filter(([ordner, block]) => {
      const pfad = join(ordner, FOLDER_INSTRUCTIONS);
      const text = existsSync(pfad) ? readFileSync(pfad, "utf8") : "";
      return withBlock(text, block) !== text;
    })
    .map(([ordner]) => `${ordner}${FOLDER_INSTRUCTIONS} passt nicht mehr zu tools/bausteine.json: npm run hinweise ausführen.`);
  return { befunde: [...zuordnung, ...eingaenge, ...richtung, ...veraltet], zusammenfassung };
}

function betrifftDatei(befund, datei) {
  return befund.startsWith(`${datei} → `) || (!befund.includes(" → ") && befund.includes(` ${datei} `));
}

function basisVerstoesse(basis, zwischenspeichern) {
  const ablage = join(tmpdir(), `architektur-basis-${git(["rev-parse", basis])}.json`);
  if (zwischenspeichern && existsSync(ablage)) return JSON.parse(readFileSync(ablage, "utf8"));
  const ordner = mkdtempSync(join(tmpdir(), "architektur-basis-"));
  try {
    git(["worktree", "add", "--quiet", "--detach", ordner, basis]);
    symlinkSync(join(process.cwd(), "node_modules"), join(ordner, "node_modules"));
    const bekannt = verstoesseAus(abhaengigkeiten(ordner));
    if (!zwischenspeichern) return bekannt;
    const entwurf = `${ablage}.${process.pid}`;
    writeFileSync(entwurf, JSON.stringify(bekannt));
    renameSync(entwurf, ablage);
    return bekannt;
  } finally {
    git(["worktree", "remove", "--force", ordner]);
    rmSync(ordner, { recursive: true, force: true });
  }
}

export function architekturBefunde(basis, datei) {
  const graph = datei === undefined ? undefined : abhaengigkeiten(process.cwd());
  const karte = bausteinkarteBefunde(graph);
  const bekannt = basisVerstoesse(basis, graph !== undefined);
  const neu = neueVerstoesse(bekannt, verstoesseAus(graph ?? abhaengigkeiten(process.cwd())));
  if (datei === undefined) return { neu, karte: karte.befunde, bekannt: bekannt.length, zusammenfassung: karte.zusammenfassung };
  return { neu: neu.filter((verstoss) => verstoss.includes(`: ${datei} → `)), karte: datei === BAUSTEINKARTE ? karte.befunde : karte.befunde.filter((befund) => betrifftDatei(befund, datei)), bekannt: bekannt.length };
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

function mitWidgetLader(nutzer, dateien) {
  for (const pfad of dateien.filter((datei) => AUSGELIEFERT.test(datei))) nutzer.set(pfad, [...(nutzer.get(pfad) ?? []), WIDGET_LADER]);
  return nutzer;
}

export function betroffeneTests(dateien) {
  const tiefen = testTiefen(dateien, mitWidgetLader(graph(), dateien));
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

export function bestandAuf(stand, { datei, feld }) {
  const text = stand === null ? (existsSync(datei) ? readFileSync(datei, "utf8") : "") : spawnSync("git", ["show", `${stand}:${datei}`], { encoding: "utf8" }).stdout;
  if (!text) return new Map();
  const inhalt = JSON.parse(text);
  return eintraege(feld === undefined ? inhalt : inhalt[feld]);
}

function teilersetzungen(text, muster, ersatz) {
  let staende = [{ aus: "", ende: 0 }];
  for (const fund of text.matchAll(muster)) {
    const nach = fund.index + fund[0].length;
    staende = staende.flatMap(({ aus, ende }) => {
      const davor = aus + text.slice(ende, fund.index);
      return [{ aus: davor + fund[0], ende: nach }, { aus: davor + ersatz(fund), ende: nach }];
    });
  }
  return staende.map(({ aus, ende }) => aus + text.slice(ende));
}

function vorherformen(name) {
  const ohneTs = teilersetzungen(name, TS_ENDUNG, () => ".js");
  return new Set(ohneTs.flatMap((text) => teilersetzungen(text, TESTORDNER_UMZUG, (fund) => `test/${fund[1]}`)));
}

function ohneUmzug(vorher, jetzt) {
  const verschwunden = new Map([...vorher].map(([name, anzahl]) => [name, anzahl - (jetzt.get(name) ?? 0)]));
  return [...jetzt].filter(([name, anzahl]) => {
    const kandidaten = [...vorherformen(name)].filter((alt) => alt !== name);
    let offen = anzahl - (vorher.get(name) ?? 0);
    while (offen > 0 && !vorher.has(name)) {
      const alt = kandidaten.find((kandidat) => !jetzt.has(kandidat) && (verschwunden.get(kandidat) ?? 0) > 0);
      if (alt === undefined) break;
      verschwunden.set(alt, verschwunden.get(alt) - 1);
      offen -= 1;
    }
    return offen > 0;
  }).map(([name]) => name);
}

export function gewachseneEintraege(vorher, jetzt) {
  return ohneUmzug(vorher, jetzt).map((name) => name.slice(1));
}

export function neueVerstoesse(bekannt, kopf) {
  return ohneUmzug(...[bekannt, kopf].map((liste) => new Map([...new Set(liste)].map((verstoss) => [verstoss, 1]))));
}

const ESC = "\u001B";
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");
const NEU_UMGEZOGEN = `${ESC}[34m+`;
const ALT_UMGEZOGEN = `${ESC}[36m-`;
const UMZUG_FARBEN = [
  "color.diff.new=green",
  "color.diff.old=red",
  ...["newMoved", "newMovedAlternative", "newMovedDimmed", "newMovedAlternativeDimmed"].map((name) => `color.diff.${name}=blue`),
  ...["oldMoved", "oldMovedAlternative", "oldMovedDimmed", "oldMovedAlternativeDimmed"].map((name) => `color.diff.${name}=cyan`),
].flatMap((wert) => ["-c", wert]);

function zeileEintragen(bereiche, datei, zeilennummer) {
  const letzter = bereiche.at(-1);
  if (letzter?.datei === datei && letzter.bis === zeilennummer - 1) letzter.bis = zeilennummer;
  else bereiche.push({ datei, von: zeilennummer, bis: zeilennummer });
}

function kopfzeile(zustand, zeile) {
  const kopf = HUNK.exec(zeile);
  if (kopf) return { ...zustand, offen: Number(kopf[1] ?? 1) + Number(kopf[3] ?? 1), nummer: Number(kopf[2]) };
  if (!zeile.startsWith("+++ ")) return zustand;
  return { ...zustand, datei: zeile.startsWith(NEUE_DATEI) && CODE.test(zeile) ? zeile.slice(NEUE_DATEI.length) : null };
}

function inhaltszeile(zustand, roh, ergebnis) {
  const zeile = roh.replace(ANSI, "");
  const text = zeile.slice(1);
  const neu = zeile.startsWith("+");
  if (neu && zustand.datei !== null) ergebnis.neue.push({ datei: zustand.datei, nummer: zustand.nummer, text, umgezogen: roh.startsWith(NEU_UMGEZOGEN) });
  if (!neu && roh.startsWith(ALT_UMGEZOGEN)) ergebnis.verschwunden.set(text, (ergebnis.verschwunden.get(text) ?? 0) + 1);
  return { ...zustand, offen: zustand.offen - 1, nummer: zustand.nummer + Number(neu) };
}

function diffZeilen(basis) {
  const ergebnis = { neue: [], verschwunden: new Map() };
  const rohdiff = git([...UMZUG_FARBEN, "diff", "-U0", "--no-ext-diff", "--color=always", "--color-moved=blocks", "--color-moved-ws=no", basis, "--", "src"]);
  rohdiff.split("\n").reduce((zustand, roh) => {
    const zeile = roh.replace(ANSI, "");
    if (zustand.offen === 0) return kopfzeile(zustand, zeile);
    return zeile.startsWith("+") || zeile.startsWith("-") ? inhaltszeile(zustand, roh, ergebnis) : zustand;
  }, { datei: null, nummer: 0, offen: 0 });
  return ergebnis;
}

export function geaenderteBereiche(basis) {
  const { neue, verschwunden } = diffZeilen(basis);
  const bereiche = [];
  for (const { datei, nummer, text, umgezogen } of neue) {
    if (umgezogen && (verschwunden.get(text) ?? 0) > 0) verschwunden.set(text, verschwunden.get(text) - 1);
    else zeileEintragen(bereiche, datei, nummer);
  }
  return bereiche;
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

function einbettungsErreichung(dateien) {
  const kanten = einbettungen();
  const ziele = dateien.filter((datei) => kanten.some(({ ziel }) => ziel === datei));
  const nutzer = ziele.length > 0 ? mitEinbettungen(mitStartkanten(graph()), kanten) : null;
  return ziele.map((ziel) => ({ ziel, erreichend: [...testTiefen([ziel], nutzer).keys()], nennende: nennendeTests(ziel, nutzer) }));
}

function eingebetteteTests(dateien) {
  return Object.fromEntries(einbettungsErreichung(dateien).map(({ ziel, erreichend, nennende }) => [ziel, erreichend.filter((pfad) => nennende.has(pfad))]));
}

export function nachgereichteTests(dateien, neu) {
  return Object.fromEntries(einbettungsErreichung(dateien).map(({ ziel, erreichend, nennende }) => [ziel, erreichend.filter((pfad) => neu.includes(pfad) && !nennende.has(pfad))]));
}

function mutationTests(basis) {
  const geaendert = new Set(git(["diff", "--name-only", "--diff-filter=AMR", basis, "--", "test"]).split("\n"));
  const neu = new Set(git(["diff", "--name-only", "--diff-filter=A", basis, "--", "test"]).split("\n"));
  const tests = git(["ls-files", "test"]).split("\n").filter((pfad) => TESTDATEI.test(pfad)).sort();
  return { tests, geaendert: tests.filter((pfad) => geaendert.has(pfad)), neu: tests.filter((pfad) => neu.has(pfad)) };
}

export function mutantReihenfolge({ tests, geaendert = [] }, zeile) {
  const merkmale = [...new Set([...zeile.replaceAll(STRYKER_AUFRUF, "").matchAll(MERKMAL)].map(([, text, name]) => text ?? name))];
  const treffer = new Map(tests.map((pfad) => [pfad, existsSync(pfad) ? readFileSync(pfad, "utf8") : ""]).map(([pfad, text]) => [pfad, merkmale.filter((merkmal) => text.includes(merkmal)).length]));
  return [...tests].sort((links, rechts) => Number(geaendert.includes(rechts)) - Number(geaendert.includes(links)) || treffer.get(rechts) - treffer.get(links) || links.localeCompare(rechts));
}

function ohneWerkzeugSteuerung(quelle) {
  return Object.fromEntries(Object.entries(quelle).filter(([name]) => !WERKZEUG_STEUERUNG.includes(name)));
}

function testdateiGruen(datei, mitMutant, lauf) {
  const { laeufe, abdeckung, gestartet } = lauf;
  gestartet.push(datei);
  const umgebung = { ...ohneWerkzeugSteuerung(env), NODE_ENV: "test", NODE_V8_COVERAGE: abdeckung, [MUTANT]: mitMutant ? env[MUTANT] : undefined, ...(mitMutant && { NODE_OPTIONS: `${env.NODE_OPTIONS ?? ""} ${MUTANT_VORLADEN}`.trim() }) };
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

async function abdeckungMessen(plan) {
  const orte = schutzOrte(plan.dateien);
  const { eingebettete } = plan;
  const eingebettet = (datei) => Object.entries(eingebettete).filter(([, tests]) => tests.includes(datei)).flatMap(([ziel]) => Object.keys(orte).filter((id) => relative(process.cwd(), orte[id].datei) === ziel));
  const offen = plan.tests.filter((datei, index) => index % teilAnzahl() === teilNummer());
  const abdeckung = {};
  const messen = async () => {
    for (let datei = offen.shift(); datei !== undefined; datei = offen.shift()) {
      const ordner = join(mkdtempSync(join(tmpdir(), "abdeckung-")), "v8");
      const gruen = await testdateiGruen(datei, false, { laeufe: new Set(), abdeckung: ordner, gestartet: [] });
      const prozesse = gruen && existsSync(ordner) ? readdirSync(ordner).map((name) => JSON.parse(readFileSync(join(ordner, name), "utf8")).result) : null;
      abdeckung[datei] = prozesse && [...new Set([...ausgefuehrteMutanten(prozesse, orte), ...eingebettet(datei)])];
      rmSync(dirname(ordner), { recursive: true, force: true });
    }
  };
  await Promise.all(Array.from({ length: MUTATION_PARALLEL }, messen));
  mkdirSync(env[ABDECKUNG], { recursive: true });
  writeFileSync(join(env[ABDECKUNG], `${teilNummer()}.json`), JSON.stringify(abdeckung));
}

const abdeckungLaden = () => Object.assign({}, ...(existsSync(env[ABDECKUNG] ?? "") ? readdirSync(env[ABDECKUNG]).map((name) => JSON.parse(readFileSync(join(env[ABDECKUNG], name), "utf8"))) : []));

function mutantenZeile({ datei, offset }) {
  const text = `${readFileSync(datei, "utf8")}\n`;
  return text.slice(text.lastIndexOf("\n", offset) + 1, text.indexOf("\n", offset));
}

export function basisRotZeilen({ schluessel, ausgeschlossen = [] }) {
  return ausgeschlossen.map((datei) => `Basis rot: ${datei} war bei ${schluessel} zweimal ohne Mutant rot und ist für den Rest des Jobs ausgeschlossen`);
}

async function mutantGegenTests(plan) {
  const start = Date.now();
  const basisRot = new Set(existsSync(plan.basisRot) ? JSON.parse(readFileSync(plan.basisRot, "utf8")) : []);
  const ort = schutzOrte(plan.dateien)[env[MUTANT]];
  const kandidat = (datei) => (plan.abdeckung[datei] ?? [env[MUTANT]]).includes(env[MUTANT]);
  const nachgereicht = plan.nachgereicht?.[ort === undefined ? "" : relative(process.cwd(), ort.datei)] ?? [];
  const offen = [...mutantReihenfolge({ ...plan, tests: plan.tests.filter(kandidat) }, ort === undefined ? "" : mutantenZeile(ort)), ...nachgereicht].filter((datei, stelle, liste) => !basisRot.has(datei) && liste.indexOf(datei) === stelle);
  const ausgeschlossen = [];
  const stand = { test: null, frist: false };
  const lauf = { laeufe: new Set(), gestartet: [] };
  const ende = Math.min(plan.frist, start + MUTANT_FRIST_MS);
  const pruefe = async (datei) => {
    if (stand.test !== null || (await testdateiGruen(datei, true, lauf)) || stand.test !== null) return;
    let basisGruen = false;
    for (let kontrolle = 0; kontrolle < KONTROLLLAEUFE && !basisGruen && stand.test === null; kontrolle += 1) basisGruen = await testdateiGruen(datei, false, lauf);
    if (stand.test !== null) return;
    if (!basisGruen) {
      basisRot.add(datei);
      ausgeschlossen.push(datei);
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
  const urteil = stand.test === null ? { ergebnis: stand.frist ? "nicht geprüft (Frist)" : "überlebt" } : { ergebnis: GETOETET, test: stand.test };
  return { ...urteil, ...(ausgeschlossen.length > 0 && { ausgeschlossen }), dauer: Math.round((Date.now() - start) / SEKUNDE_MS), laeufe: lauf.gestartet.length };
}

const teilNummer = () => Number(env.TEIL ?? 0);
const teilAnzahl = () => Number(env.TEILE ?? 1);
const eigenerMutant = (id) => Number(id) % teilAnzahl() === teilNummer();

async function mutantPruefen() {
  if (env[MUTANT] === undefined) {
    if (env[ZAEHLEN] !== undefined && env[ABDECKUNG] !== undefined) await abdeckungMessen(JSON.parse(readFileSync(env[MUTATION_PLAN], "utf8")));
    return true;
  }
  if (env[ZAEHLEN] !== undefined) return true;
  if (!eigenerMutant(env[MUTANT])) return false;
  const plan = JSON.parse(readFileSync(env[MUTATION_PLAN], "utf8"));
  const ergebnis = await mutantGegenTests(plan);
  appendFileSync(plan.protokoll, `${JSON.stringify({ id: env[MUTANT], ...ergebnis })}\n`);
  return ergebnis.ergebnis !== GETOETET;
}

function quellzeile(datei, nummer) {
  const zeilen = readFileSync(datei, "utf8").split("\n");
  return zeilen[nummer - 1].trim();
}

function eigeneMutanten(bericht, protokoll) {
  const zeilen = existsSync(protokoll) ? readFileSync(protokoll, "utf8").trim().split("\n") : [];
  const ergebnisse = new Map(zeilen.map((zeile) => JSON.parse(zeile)).map(({ id, ...ergebnis }) => [id, ergebnis]));
  const alle = Object.entries(JSON.parse(readFileSync(bericht, "utf8")).files).flatMap(([datei, { mutants }]) => mutants.map((mutant) => ({ datei, ...mutant })));
  return alle.filter(({ id }) => eigenerMutant(id)).map(({ id, datei, mutatorName, replacement, location }) => ({
    schluessel: `${relative(process.cwd(), datei)}:${location.start.line}/${id}`,
    datei: relative(process.cwd(), datei),
    zeile: quellzeile(datei, location.start.line),
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

function einbettungenAufUnveraendertenQuellen(zaehlen, dateien) {
  return zaehlen && env[ABDECKUNG] !== undefined ? { eingebettete: eingebetteteTests(dateien) } : {};
}

function mutationTeil(argv) {
  const zaehlen = argv.includes("--zaehlen");
  const basis = basisAus(argv);
  const bereiche = geaenderteBereiche(basis);
  if (bereiche.length === 0) return zaehlen ? teileSchreiben(null) : mutationUrteil([], 0);
  const ordner = mkdtempSync(join(tmpdir(), "mutation-"));
  const [planDatei, bericht, konfiguration, protokoll] = ["plan.json", "bericht.json", "stryker.json", "protokoll.jsonl"].map((name) => join(ordner, name));
  const dateien = [...new Set(bereiche.map(({ datei }) => datei))];
  const tests = mutationTests(basis);
  const plan = { frist: Date.now() + MUTATION_FRIST_MS, ...tests, protokoll, basisRot: join(ordner, "basis-rot.json"), dateien, abdeckung: abdeckungLaden(), ...einbettungenAufUnveraendertenQuellen(zaehlen, dateien), ...(zaehlen ? {} : { nachgereicht: nachgereichteTests(dateien, tests.neu) }) };
  writeFileSync(planDatei, JSON.stringify(plan));
  const mutate = bereiche.map(({ datei, von, bis }) => `${datei}:${von}-${bis}`);
  writeFileSync(konfiguration, JSON.stringify({ testRunner: "command", commandRunner: { command: "node tools/pruefen.mjs mutant" }, inPlace: true, concurrency: 1, coverageAnalysis: "off", timeoutMS: MUTATION_FRIST_MS, dryRunTimeoutMinutes: FRIST_MINUTEN, mutate, reporters: ["json"], jsonReporter: { fileName: bericht }, logLevel: "warn" }));
  console.log(`${mutate.join(" ")}: ${Object.keys(plan.abdeckung).length} von ${plan.tests.length} Testdateien mit Abdeckung, zuerst die im PR geänderten: ${plan.geaendert.join(" ")}`);
  const start = Date.now();
  if (!lauf("npx", ["stryker", "run", konfiguration], { env: { ...env, [MUTATION_PLAN]: planDatei, ...(zaehlen && { [ZAEHLEN]: "1" }) } })) return false;
  if (zaehlen) return teileSchreiben(bericht);
  const mutanten = eigeneMutanten(bericht, protokoll);
  for (const mutant of mutanten) console.log([`${mutant.schluessel} ${mutant.mutation} → ${mutant.ergebnis} ${mutant.test ?? ""}${mutant.dauer === undefined ? "" : ` (${mutant.dauer} s, ${mutant.laeufe} Läufe)`}`, ...basisRotZeilen(mutant)].join("\n"));
  return mutationUrteil(mutanten, (Date.now() - start) / MINUTE_MS);
}

function ueberlebendeAbschnitt(prText) {
  return (prText ?? "").split(/^## /m).find((teil) => teil.startsWith("Überlebende Mutanten")) ?? "";
}

export function gruenAufMaster(prText) {
  return [...ueberlebendeAbschnitt(prText).matchAll(GETOETET_VON)].map(([, schluessel, id, datei]) => ({ schluessel, id, datei }));
}

export function prTextFormfehler(prText, vorhanden = existsSync) {
  const zeilen = ueberlebendeAbschnitt(prText).split("\n").slice(1).filter((zeile) => SCHLUESSEL_IM_TEXT.test(zeile) || /getötet/.test(zeile));
  return zeilen.flatMap((zeile) => {
    const [, , , datei] = [...zeile.matchAll(GETOETET_VON)][0] ?? [];
    const begruendet = [...zeile.matchAll(BEGRUENDET)][0];
    if (datei !== undefined) return vorhanden(datei) ? [] : [`Unter „## Überlebende Mutanten“ nennt \`${datei}\` eine Testdatei, die es nicht gibt: ${zeile.trim()}`];
    if (begruendet !== undefined && begruendet[2].trim().length >= BEGRUENDUNG_MINDESTENS && !/getötet/.test(zeile)) return [];
    return [`Unter „## Überlebende Mutanten“ hat diese Zeile nicht die vorgeschriebene Form (${FORM_BEISPIEL}): ${zeile.trim()}`];
  });
}

function prTextPruefen(argv) {
  const pfad = argv[ERSTE_DATEI];
  const roh = readFileSync(pfad, "utf8");
  const text = pfad.endsWith(".json") ? JSON.parse(roh).body : roh;
  const fehler = prTextFormfehler(text);
  for (const eintrag of fehler) console.log(`Rot: ${eintrag}`);
  return fehler.length === 0;
}

export function aequivalenteLaden(pfad = AEQUIVALENTE) {
  return existsSync(pfad) ? JSON.parse(readFileSync(pfad, "utf8")) : [];
}

export function mutationUrteil(mutanten, minuten, aequivalente = aequivalenteLaden()) {
  const abschnitt = ueberlebendeAbschnitt(env.PR_TEXT);
  const genannt = gruenAufMaster(env.PR_TEXT);
  const gruen = (env.ROTPROBE_GRUEN ?? "").split(/\s+/).filter(Boolean);
  const ohneEintrag = gruen.filter((datei) => !genannt.some((eintrag) => eintrag.datei === datei)).map((datei) => ({ schluessel: "ohne Eintrag", datei }));
  const unbelegt = [...ohneEintrag, ...genannt.filter(({ schluessel, id, datei }) => eigenerMutant(id) && !mutanten.some((mutant) => mutant.schluessel === schluessel && mutant.ergebnis === GETOETET && mutant.test === datei))];
  const begruendet = new Map([...abschnitt.matchAll(BEGRUENDET)].map(([, schluessel, grund]) => [schluessel, grund.trim()]).filter(([, grund]) => grund.length >= BEGRUENDUNG_MINDESTENS));
  const lebend = mutanten.filter(({ ergebnis }) => ergebnis !== GETOETET);
  const ausListe = ({ datei, mutation, zeile }) => aequivalente.find((eintrag) => eintrag.datei === datei && eintrag.mutation === mutation && eintrag.zeile === zeile && (eintrag.grund ?? "").length >= BEGRUENDUNG_MINDESTENS)?.grund;
  const grund = (mutant) => (mutant.ergebnis === "überlebt" ? begruendet.get(mutant.schluessel) ?? ausListe(mutant) : undefined);
  const offen = lebend.filter((mutant) => !grund(mutant));
  const tabelle = lebend.map((mutant) => `| \`${mutant.schluessel}\` | \`${mutant.mutation}\` | ${mutant.ergebnis} | ${grund(mutant)?.slice(0, MUTATION_ANZEIGE) ?? "–"} |`);
  const zaehlung = mutanten.length === 0 ? LEERER_LAUF : `${mutanten.length - lebend.length} von ${mutanten.length} Mutanten getötet, ${offen.length} von ${lebend.length} übrigen ohne Begründung, ${minuten.toFixed(1)} min.`;
  const kopf = `### Mutation ${teilNummer() + 1}/${teilAnzahl()} auf den geänderten Zeilen unter src/\n\n${zaehlung}\n`;
  const unbelegtZeilen = unbelegt.map(({ schluessel, datei }) => `Rot: \`${datei}\` ist auf master grün; ${schluessel === "ohne Eintrag" ? "der PR-Text nennt sie nicht unter „## Überlebende Mutanten“" : `der PR-Text nennt \`${schluessel}\`, die Mutation tötet ihn aber nicht mit genau diesem Test`}.`);
  const text = [kopf, ...unbelegtZeilen, ...(tabelle.length > 0 ? ["| Mutant | Mutation | Ergebnis | Begründung im PR-Text |", "|---|---|---|---|", ...tabelle, ""] : []), ...(offen.length > 0 ? [MUTATION_AUSWEG] : [])].join("\n");
  console.log(text);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
  return offen.length === 0 && unbelegt.length === 0;
}

function rotprobeAusnahmenAusgeben() {
  for (const { datei } of gruenAufMaster(env.PR_TEXT)) console.log(datei);
  return true;
}

function lebt(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (fehler) {
    return fehler.code === "EPERM";
  }
}

function sperrHalter(datei) {
  try {
    const pid = Number(readFileSync(datei, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : 0;
  } catch {
    return null;
  }
}

function sperreLegen(datei) {
  const eigene = `${datei}.${process.pid}`;
  writeFileSync(eigene, String(process.pid));
  try {
    linkSync(eigene, datei);
    return true;
  } catch (fehler) {
    if (fehler.code !== "EEXIST") throw fehler;
    return false;
  } finally {
    rmSync(eigene, { force: true });
  }
}

function verwaisteSperreRaeumen(datei) {
  const raeumen = `${datei}.raeumen`;
  if (!sperreLegen(raeumen)) {
    if (halterVerschwunden(sperrHalter(raeumen))) rmSync(raeumen, { force: true });
    return;
  }
  try {
    const pid = sperrHalter(datei);
    if (pid !== null && halterVerschwunden(pid)) rmSync(datei, { force: true });
  } finally {
    rmSync(raeumen, { force: true });
  }
}

function haeltElternlauf(datei) {
  const vermerk = Number(env[SPERRE_VERMERK]);
  return vermerk > 0 && vermerk === sperrHalter(datei) && lebt(vermerk);
}

function halterVerschwunden(pid) {
  return pid === null || pid === 0 || !lebt(pid);
}

async function sperreAbwarten({ datei, warteMs, taktMs }) {
  const frist = Date.now() + warteMs;
  let gemeldet = false;
  while (!sperreLegen(datei)) {
    const pid = sperrHalter(datei);
    if (halterVerschwunden(pid)) {
      verwaisteSperreRaeumen(datei);
      continue;
    }
    if (!gemeldet) console.log(`pruefen: warte auf anderen Prüflauf (PID ${pid})`);
    gemeldet = true;
    if (Date.now() >= frist) throw new Error(`pruefen: Abbruch, der Prüflauf mit PID ${pid} hält die Sperre ${datei} länger als ${SPERRE_WARTEN_MIN} Minuten. Lebt er noch, warte oder beende ihn; sonst starte neu.`);
    await warte(taktMs);
  }
}

export async function nimmPruefsperre({ datei = SPERRDATEI, warteMs = SPERRE_WARTEN_MIN * MINUTE_MS, taktMs = SPERRE_TAKT_MS } = {}) {
  if (haeltElternlauf(datei)) return () => {};
  await sperreAbwarten({ datei, warteMs, taktMs });
  env[SPERRE_VERMERK] = String(process.pid);
  const frei = () => {
    if (sperrHalter(datei) === process.pid) rmSync(datei, { force: true });
  };
  process.on("exit", frei);
  for (const [signal, nummer] of Object.entries(SIGNALE)) process.on(signal, () => process.exit(EXIT_SIGNAL + nummer));
  return frei;
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
  architektur(basis, argv) {
    const stelle = argv.indexOf("--datei");
    const { neu, karte, bekannt, zusammenfassung } = architekturBefunde(basis, stelle === -1 ? undefined : argv[stelle + 1]);
    if (zusammenfassung !== undefined) console.log(zusammenfassung);
    for (const befund of karte) console.log(befund);
    for (const verstoss of neu) console.log(`Neuer Architekturverstoß: ${verstoss}`);
    console.log(`Architektur: ${neu.length} neue Verstöße gegen .dependency-cruiser.cjs (${bekannt} auf der Basis).`);
    return neu.length === 0 && karte.length === 0;
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
  pruefeTiefe("tools/pruefen.mjs");
  const [, , gewuenscht] = process.argv;
  const mutation = { mutant: mutantPruefen, mutation: () => mutationTeil(process.argv), "rotprobe-ausnahmen": rotprobeAusnahmenAusgeben, "pr-text": () => prTextPruefen(process.argv) }[gewuenscht];
  if (mutation !== undefined) {
    if (!(await mutation())) process.exitCode = EXIT_ROT;
    return;
  }
  if (gewuenscht === "betroffen") {
    const dateien = process.argv.slice(ERSTE_DATEI);
    console.log(JSON.stringify(betroffeneTests(dateien), null, JSON_EINZUG));
    return;
  }
  if (env.GITHUB_ACTIONS !== "true") await nimmPruefsperre();
  const basis = basisAus(process.argv);
  const namen = gewuenscht && Object.hasOwn(SCHRITTE, gewuenscht) ? [gewuenscht] : LOKALE_SCHRITTE;
  const rot = namen.filter((name) => {
    console.log(`\n# ${name}`);
    return !SCHRITTE[name](basis, process.argv);
  });
  console.log(rot.length === 0 ? "\nAlles grün." : `\nRot: ${rot.join(", ")}`);
  if (rot.length > 0) process.exitCode = EXIT_ROT;
}

if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
