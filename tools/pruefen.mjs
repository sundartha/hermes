import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expectedBlocks, FOLDER_INSTRUCTIONS, withBlock } from "./anweisungen-karte.mjs";
import { bausteinBefunde } from "./bausteine.mjs";
import { testschutzBefunde, TESTSCHUTZ_AUSWEG } from "./testschutz.mjs";

const REMOTES = ["hermes/master", "upstream/master", "origin/master"];
const CODE = /\.(?:[cm]?js|ts)$/;
const TESTDATEI = /^test\/.*\.test\.[cm]?[jt]s$/;
const OHNE_LOKALE_SPERRE = 20;
const SEMGREP_IMAGE = "semgrep/semgrep:1.177.0@sha256:acaac22ffc7b7cc5926de0751b223bce0b2491c33d18422fa72f632c78d81198";
const SEMGREP_REGELN = ["p/javascript", "p/typescript", "p/nodejsscan", "p/expressjs"];
const BESTAENDE = [
  { datei: "eslint-suppressions.json" },
  { datei: "tools/bausteine.json", feld: "altlast" },
  ...["anfrage-mit-frist", "fester-importpfad", "keine-speicher-attrappe", "quelltext-als-text", "selbstpruefung", "zeitglieder-bestand"].map((name) => ({ datei: `tools/basis/${name}.json` })),
];
const DEPCRUISE = "node_modules/.bin/depcruise";
const ARCHITEKTUR_ORDNER = ["src", "test"];
const EXIT_ROT = 1;
const GROSSE_AUSGABE = 268_435_456;
const ERSTE_DATEI = 3;
const JSON_EINZUG = 2;

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

export function betroffeneTests(dateien) {
  const nutzer = graph();
  const direkt = new Set(dateien.filter((pfad) => TESTDATEI.test(pfad)));
  const alle = new Set(direkt);
  const gesehen = new Set(dateien);
  let rand = dateien;
  for (let tiefe = 0; rand.length > 0; tiefe += 1) {
    const naechste = rand.flatMap((pfad) => nutzer.get(pfad) ?? []).filter((pfad) => !gesehen.has(pfad));
    for (const pfad of naechste) {
      gesehen.add(pfad);
      if (!TESTDATEI.test(pfad)) continue;
      alle.add(pfad);
      if (tiefe === 0) direkt.add(pfad);
    }
    rand = naechste;
  }
  return { direkt: [...direkt].sort(), alle: [...alle].sort() };
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

export function gewachseneEintraege(vorher, jetzt) {
  return [...jetzt].filter(([name, anzahl]) => anzahl > (vorher.get(name) ?? 0)).map(([name]) => name.slice(1));
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
      const neu = [...new Set(verstoesse(process.cwd()))].filter((verstoss) => !bekannt.has(verstoss));
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
    if (spawnSync("docker", ["--version"]).status !== 0) {
      console.log("Semgrep übersprungen: weder semgrep noch docker installiert; die CI prüft es.");
      return true;
    }
    const wurzel = process.cwd();
    return lauf("docker", ["run", "--rm", "-v", `${wurzel}:${wurzel}`, "-w", wurzel, "-e", "GIT_CONFIG_COUNT=1", "-e", "GIT_CONFIG_KEY_0=safe.directory", "-e", "GIT_CONFIG_VALUE_0=*", SEMGREP_IMAGE, "semgrep", ...args]);
  },
  tests(basis) {
    const { direkt, alle } = betroffeneTests(geaendert(basis));
    if (alle.length === 0) return true;
    const auswahl = alle.length <= OHNE_LOKALE_SPERRE ? alle : direkt.slice(0, OHNE_LOKALE_SPERRE);
    if (auswahl.length < alle.length) console.log(`${alle.length} betroffene Tests; lokal laufen ${auswahl.length} mit direktem Import, alle laufen in der CI.`);
    return auswahl.length === 0 || lauf("npm", ["test", "--", ...auswahl]);
  },
  katalog: (basis) => lauf("node", ["tools/katalog-pruefen.mjs", "--basis", basis]),
  testschutz(basis) {
    const befunde = testschutzBefunde(basis);
    for (const befund of befunde) console.log(befund);
    if (befunde.length > 0) console.log(TESTSCHUTZ_AUSWEG);
    return befunde.length === 0;
  },
};

function main() {
  const [, , gewuenscht] = process.argv;
  if (gewuenscht === "betroffen") {
    const dateien = process.argv.slice(ERSTE_DATEI);
    console.log(JSON.stringify(betroffeneTests(dateien), null, JSON_EINZUG));
    return;
  }
  const basis = basisAus(process.argv);
  const namen = gewuenscht && Object.hasOwn(SCHRITTE, gewuenscht) ? [gewuenscht] : Object.keys(SCHRITTE);
  const rot = namen.filter((name) => {
    console.log(`\n# ${name}`);
    return !SCHRITTE[name](basis);
  });
  console.log(rot.length === 0 ? "\nAlles grün." : `\nRot: ${rot.join(", ")}`);
  if (rot.length > 0) process.exitCode = EXIT_ROT;
}

main();
