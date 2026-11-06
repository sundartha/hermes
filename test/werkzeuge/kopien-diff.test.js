import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, commitAll, gitAusgabe, probeRepository, runIn, writeFiles } from "./probe-repo.js";
import { MELDUNG, zweckBlock } from "../../tools/auftrag/zweck.mjs";
import { candidatesAmong, newAmongCandidates, newClones } from "../../tools/kopien-diff.mjs";

const TOOL = join(REPO_ROOT, "tools/kopien-diff.mjs");
const EXIT_GRUEN = 0;
const EXIT_NEUE_KOPIE = 1;
const JSCPD_CONFIG = readFileSync(join(REPO_ROOT, ".jscpd.json"), "utf8");

function preis(zeile) {
  return [
    "export function summe(posten) {",
    "  let gesamt = 0;",
    "  for (const eintrag of posten) {",
    "    if (!Number.isFinite(eintrag.menge)) throw new Error(`Menge fehlt bei ${eintrag.name}`);",
    "    gesamt += eintrag.menge * eintrag.einzelpreis;",
    "  }",
    zeile,
    "  return Math.round(gesamt * 100) / 100;",
    "}",
    "",
  ].join("\n");
}

function andereLogik() {
  return [
    "export function lauteWoerter(satz) {",
    "  const woerter = String(satz).trim().split(/\\s+/);",
    "  if (woerter.length === 1 && woerter[0] === '') return [];",
    "  return woerter.map((wort, stelle) => `${stelle + 1}: ${wort.toUpperCase()}`);",
    "}",
    "",
  ].join("\n");
}

function repoMit(context, dateien) {
  return probeRepository(context, { ".jscpd.json": JSCPD_CONFIG, ...dateien });
}

function pruefe(repo, basis) {
  return runIn(repo, process.execPath, [TOOL, "--basis", basis]);
}

function pruefeNachSchreiben(context, vorher, neu) {
  const repo = repoMit(context, vorher);
  const basis = gitAusgabe(repo, "rev-parse", "HEAD");
  writeFiles(repo, neu);
  return pruefe(repo, basis);
}

test("neue Kopie einer vorhandenen Funktion in einer neuen Datei: rot, die Meldung nennt beide Stellen", (context) => {
  const lauf = pruefeNachSchreiben(context, { "src/a.js": preis("  gesamt += 0;") }, { "src/b.js": preis("  gesamt += 0;") });
  assert.equal(lauf.status, EXIT_NEUE_KOPIE, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /src\/a\.js:\d+-\d+ gleicht src\/b\.js:\d+-\d+/);
});

test("Kopie mit einer geänderten Zeile gilt auch als neue Kopie", (context) => {
  const lauf = pruefeNachSchreiben(context, { "src/a.js": preis("  gesamt += 0;") }, { "src/b.js": preis("  gesamt += 1;") });
  assert.equal(lauf.status, EXIT_NEUE_KOPIE, lauf.stdout + lauf.stderr);
});

test("bestehende Kopie in eine andere Datei verschoben: grün, ohne dass eine Liste sie kennt", (context) => {
  const repo = repoMit(context, { "src/a.js": preis("  gesamt += 0;"), "src/b.js": preis("  gesamt += 0;") });
  const basis = gitAusgabe(repo, "rev-parse", "HEAD");
  mkdirSync(join(repo, "src/neu"));
  gitAusgabe(repo, "mv", "src/b.js", "src/neu/b.js");
  const lauf = pruefe(repo, basis);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
  assert.match(lauf.stdout, /0 neue Kopien/);
});

test("eine dritte Kopie einer schon doppelten Funktion ist neu, auch wenn die ersten zwei auf der Basis stehen", (context) => {
  const repo = repoMit(context, { "src/a.js": preis("  gesamt += 0;"), "src/b.js": preis("  gesamt += 0;") });
  const basis = gitAusgabe(repo, "rev-parse", "HEAD");
  writeFiles(repo, { "src/c.js": preis("  gesamt += 0;") });
  const lauf = pruefe(repo, basis);
  assert.equal(lauf.status, EXIT_NEUE_KOPIE, lauf.stdout + lauf.stderr);
});

test("eine dritte Kopie ist neu, auch wenn jscpd sie vor dem unveränderten alten Paar meldet", (context) => {
  const repo = repoMit(context, { "src/a.js": preis("  gesamt += 0;"), "src/b.js": preis("  gesamt += 0;") });
  const basis = gitAusgabe(repo, "rev-parse", "HEAD");
  writeFiles(repo, { "src/aa.js": preis("  gesamt += 0;") });
  const lauf = pruefe(repo, basis);
  assert.equal(lauf.status, EXIT_NEUE_KOPIE, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /src\/aa\.js/);
});

test("Diff ohne Kopie, auch neben einer Datei mit Kopie auf der Basis: grün", (context) => {
  const repo = repoMit(context, { "src/a.js": preis("  gesamt += 0;"), "src/b.js": preis("  gesamt += 0;") });
  const basis = gitAusgabe(repo, "rev-parse", "HEAD");
  writeFiles(repo, { "src/c.js": andereLogik() });
  commitAll(repo, "Andere Logik");
  const lauf = pruefe(repo, basis);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
});

const SCHRITTE = `jobs:
  pruefen:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          persist-credentials: false
      - name: Node 22
        uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020
        with:
          node-version: 22
      - name: Abhaengigkeiten
        run: npm ci --ignore-scripts
      - name: Pruefen
        run: node tools/pruefen.mjs --kopf "$KOPF" --aus "$RUNNER_TEMP/pruefung"
`;
const BETRIEBSTEXT = `# Betrieb

1. Pruefen: Im Dashboard steht unter \`Anrufe\`, ob ein Gespraech laeuft.
2. Sperren: \`OUTBOUND_FROZEN=true\` setzen und im Render-Dashboard speichern.
3. Warten: Erst wenn \`GET /healthz\` meldet, dass kein Anruf offen ist, geht es weiter.
4. Neu starten: Im Render-Dashboard auf \`Manual Deploy\` klicken und das Protokoll lesen.
5. Pruefen: Im Protokoll steht nach dem Start \`Hermes laeuft\`, sonst zurueckrollen.
6. Freigeben: \`OUTBOUND_FROZEN\` wieder entfernen und einen Testanruf machen.
7. Melden: Das Ergebnis mit Uhrzeit und Commit in den Betriebskanal schreiben.
`;
const ANDERER_TEXT = "# Anderes\n\nHier steht etwas ganz anderes, das mit dem Betrieb nichts zu tun hat und lang genug ist.\n";

test("neue Kopie in einem Workflow ist mit der Konfiguration des Repos rot", (context) => {
  const repo = repoMit(context, { ".github/workflows/eins.yml": SCHRITTE, ".github/workflows/zwei.yml": "name: Anderes\n" });
  const basis = gitAusgabe(repo, "rev-parse", "HEAD");
  writeFiles(repo, { ".github/workflows/drei.yml": SCHRITTE });
  const lauf = pruefe(repo, basis);
  assert.equal(lauf.status, EXIT_NEUE_KOPIE, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /\.github\/workflows\/drei\.yml/);
});

test("neue Kopie in einem Markdown-Text ist mit der Konfiguration des Repos rot", (context) => {
  const repo = repoMit(context, { "docs/eins.md": BETRIEBSTEXT, "docs/zwei.md": ANDERER_TEXT });
  const basis = gitAusgabe(repo, "rev-parse", "HEAD");
  writeFiles(repo, { "docs/drei.md": BETRIEBSTEXT });
  const lauf = pruefe(repo, basis);
  assert.equal(lauf.status, EXIT_NEUE_KOPIE, lauf.stdout + lauf.stderr);
  assert.match(lauf.stderr, /docs\/drei\.md/);
});

test("die Meldung nennt Zweck, echte Behebung, Umgehungsverbot und Ausweg aus zweck.json", (context) => {
  const lauf = pruefeNachSchreiben(context, { "src/a.js": preis("  gesamt += 0;") }, { "src/b.js": preis("  gesamt += 0;") });
  for (const zeile of zweckBlock(MELDUNG.JSCPD)) assert.ok(lauf.stderr.includes(zeile), lauf.stderr);
});

test("Zeilen vor einer bestehenden Kopie einzufügen macht keine neue Kopie", (context) => {
  const repo = repoMit(context, { "src/a.js": preis("  gesamt += 0;"), "src/b.js": preis("  gesamt += 0;") });
  const basis = gitAusgabe(repo, "rev-parse", "HEAD");
  writeFiles(repo, { "src/a.js": `// Kopf\n\n\n${preis("  gesamt += 0;")}`, "src/b.js": `// Kopf\n\n\n${preis("  gesamt += 0;")}` });
  const lauf = pruefe(repo, basis);
  assert.equal(lauf.status, EXIT_GRUEN, lauf.stdout + lauf.stderr);
});

const KOPIE = (fingerprint, dateien) => ({ fingerprint, files: dateien, location: dateien.join(" ~ ") });

test("newClones zählt je Fingerabdruck nur den Überschuss gegenüber der Basis", () => {
  const faelle = [
    { name: "gleich viele", jetzt: ["x", "x"], vorher: ["x", "x"], neu: 0 },
    { name: "eine mehr", jetzt: ["x", "x", "x"], vorher: ["x", "x"], neu: 1 },
    { name: "anderer Inhalt", jetzt: ["y"], vorher: ["x"], neu: 1 },
    { name: "weniger als vorher", jetzt: ["x"], vorher: ["x", "x"], neu: 0 },
    { name: "leere Basis", jetzt: ["x", "y"], vorher: [], neu: 2 },
  ];
  for (const { name, jetzt, vorher, neu } of faelle) {
    const gefunden = newClones(
      jetzt.map((key) => KOPIE(key, ["a.js", "b.js"])),
      vorher.map((key) => KOPIE(key, ["a.js", "b.js"])),
    );
    assert.equal(gefunden.length, neu, name);
  }
});

test("newAmongCandidates rechnet die Basis zuerst gegen unveränderte Kopien, auch wenn der Kandidat im Bericht davor steht", () => {
  const kandidat = KOPIE("x", ["a.js", "aa.js"]);
  const unveraendert = KOPIE("x", ["a.js", "b.js"]);
  assert.deepEqual(newAmongCandidates([kandidat, unveraendert], [kandidat], [KOPIE("x", ["a.js", "b.js"])]), [kandidat]);
  assert.deepEqual(newAmongCandidates([unveraendert, kandidat], [kandidat], [KOPIE("x", ["a.js", "b.js"])]), [kandidat]);
  assert.deepEqual(newAmongCandidates([unveraendert], [], [KOPIE("x", ["a.js", "b.js"])]), []);
});

test("candidatesAmong nimmt Kopien, die eine geänderte Datei berühren, bei geänderter Konfiguration alle", () => {
  const kopien = [KOPIE("x", ["a.js", "b.js"]), KOPIE("y", ["c.js", "d.js"])];
  assert.deepEqual(candidatesAmong(kopien, new Set(["b.js"]), false), [kopien[0]]);
  assert.deepEqual(candidatesAmong(kopien, new Set(), false), []);
  assert.deepEqual(candidatesAmong(kopien, new Set(), true), kopien);
});
