import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

export const AUSFUEHRBAR = 0o755;
export const EXIT_ROT = 1;
export const ISSUE = 54;
const PROBE = "probe@example.invalid";
export const ORDNER = "plaene/P-001-probe";
export const PHASENDATEI = `${ORDNER}/phase.json`;
export const S1 = "Gegeben die Zahl 2\nWenn ein Agent `verdopple` mit 2 aufruft\nDann ist die Antwort `4`";
export const VERBOT = "Eine negative Zahl wird nie positiv.";
const UMBAU_AUSWEG = "keiner, weil Umbau: bestehende Tests bleiben unverändert grün";

const CLAUDE = `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const ort = dirname(process.env.ERSATZ_DREHBUCH);
const rolle = process.env.HERMES_ROLLE;
const zaehler = join(ort, "anzahl-" + rolle);
const nummer = existsSync(zaehler) ? Number(readFileSync(zaehler, "utf8")) : 0;
writeFileSync(zaehler, String(nummer + 1));
const liste = JSON.parse(readFileSync(process.env.ERSATZ_DREHBUCH, "utf8"))[rolle] ?? [{}];
const einsatz = liste[Math.min(nummer, liste.length - 1)];
appendFileSync(join(ort, "prompt-" + rolle + ".txt"), readFileSync(0, "utf8") + "\\n");
appendFileSync(join(ort, "argumente-" + rolle + ".txt"), JSON.stringify(process.argv.slice(2)) + "\\n");
for (const [pfad, inhalt] of Object.entries(einsatz.dateien ?? {})) {
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, inhalt);
}
if (einsatz.commit) execFileSync("git", ["commit", "-qam", "Planer"]);
for (const zeile of einsatz.zeilen ?? []) process.stdout.write(JSON.stringify(zeile) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: einsatz.antwort ?? "fertig" }) + "\\n");
process.exitCode = einsatz.exit ?? 0;
`;

const GH = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const eingabe = process.argv.includes("-") ? readFileSync(0, "utf8") : "";
appendFileSync(process.env.ERSATZ_GH, JSON.stringify([...process.argv.slice(2), eingabe]) + "\\n");
`;

const ROTER_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { verdopple } from "../src/rechnen.js";',
  'test("verdoppelt", () => assert.equal(verdopple(2), 4));',
  "",
].join("\n");

export const PITCH = ["# P-001 Probe", "", "## Anforderungen", "", "### Regel R1: Zahlen werden verdoppelt.", "", "#### Szenario S1: Verdoppeln", S1, "", "## Nicht-Ziele", ""].join("\n");
export const SICHERHEIT = ["# P-001 Probe: Sicherheitsprüfung", "", "## 2. Angriffswege", "Keine Angriffswege gefunden, weil nichts Neues erreichbar ist.", "", "## 3. Lückenprüfung", ""].join("\n");

export function funktion(id, aenderung = {}) {
  return {
    id,
    art: "funktion",
    ziel: "Verdopple Zahlen",
    bereich: "src/rechnen.js",
    erwarteteDateien: ["src/rechnen.js", "test/rechnen.test.js"],
    vorbild: "src/text.js",
    abnahme: "test/rechnen.test.js",
    erwarteterFehler: "2 !== 4",
    wasDarfNiePassieren: [VERBOT],
    prueft: ["S1"],
    szenarien: { S1 },
    abhaengigVon: [],
    ...aenderung,
  };
}

export function phase(auftraege, rahmen = {}) {
  return `${JSON.stringify({ phase: "P-001-probe", issue: ISSUE, entwurf: { "src/rechnen.js": "Entwurf.", "src/text.js": "Entwurf Text." }, ...rahmen, auftraege }, null, 2)}\n`;
}

export const REPO = {
  "package.json": JSON.stringify({ type: "module", scripts: { test: "node --test --test-reporter=tap", lint: "node -e 0", "test:betroffen": "node -e 0 --" } }),
  ".gitignore": ".fortschritt/\n",
  "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl;\n}\n",
  "src/text.js": "export function gross(text) {\n  return text.toUpperCase();\n}\n",
  "test/text.test.js": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { gross } from "../src/text.js";\ntest("gross", () => assert.equal(gross("a"), "A"));\n',
  [`${ORDNER}/pitch.md`]: PITCH,
  [`${ORDNER}/sicherheit.md`]: SICHERHEIT,
  [PHASENDATEI]: phase([funktion("a1")]),
};

export const TEST = { dateien: { "test/rechnen.test.js": ROTER_TEST } };
export const OHNE_FIX = { antwort: "Ich finde keinen Weg im Bereich." };
export const MIT_FIX = { dateien: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" }, antwort: "Fertig." };
export const UMBAU_FERTIG = { dateien: { "src/text.js": "export function gross(wort) {\n  return wort.toUpperCase();\n}\n" }, antwort: "Fertig." };
export const NEUSCHNITT = { dateien: { [PHASENDATEI]: phase([funktion("a1-n1", { ziel: "Verdopple Zahlen in rechnen.js" })]) }, antwort: "a1-n1: Verdopple Zahlen in rechnen.js" };

const ERSATZ = { HERMES_CLAUDE: "claude.mjs", HERMES_GH: "gh.mjs", ERSATZ_DREHBUCH: "drehbuch.json", ERSATZ_GH: "gh.log" };
const IDENTITAET = { GIT_AUTHOR_NAME: "Probe", GIT_AUTHOR_EMAIL: PROBE, GIT_COMMITTER_NAME: "Probe", GIT_COMMITTER_EMAIL: PROBE };

export function lauf(context, drehbuch, { dateien = {}, phasendatei = PHASENDATEI, umgebung = {} } = {}) {
  const repo = probeRepository(context, Object.fromEntries(Object.entries({ ...REPO, ...dateien }).filter(([, inhalt]) => inhalt !== undefined)));
  const werkzeug = probeDirectory(context, { "claude.mjs": CLAUDE, "gh.mjs": GH, "drehbuch.json": JSON.stringify(drehbuch) });
  chmodSync(join(werkzeug, "claude.mjs"), AUSFUEHRBAR);
  chmodSync(join(werkzeug, "gh.mjs"), AUSFUEHRBAR);
  const ersatz = Object.entries(ERSATZ).map(([name, datei]) => [name, join(werkzeug, datei)]);
  const env = { ...isolatedEnvironment(), ...Object.fromEntries(ersatz), ...IDENTITAET, ...umgebung, HOME: werkzeug };
  const ergebnis = spawnSync(process.execPath, [join(REPO_ROOT, "tools/auftrag.mjs"), "lauf", phasendatei], { cwd: repo, encoding: "utf8", env });
  const lies = (pfad) => (existsSync(pfad) ? readFileSync(pfad, "utf8") : "");
  const beleg = (name) => JSON.parse(lies(join(repo, ".fortschritt/P-001-probe", `${name}.json`)) || "null");
  const git = (...argumente) => runIn(repo, "git", argumente).stdout;
  return { repo, ergebnis, beleg, git, datei: (name) => lies(join(werkzeug, name)) };
}

export function umbau(id, aenderung = {}) {
  const { szenarien, erwarteterFehler, ...rest } = funktion(id);
  assert.ok(szenarien && erwarteterFehler);
  return { ...rest, art: "umbau", bereich: "src/text.js", erwarteteDateien: ["src/text.js"], abnahme: "test/text.test.js", prueft: UMBAU_AUSWEG, ...aenderung };
}

export function ersterVersuch(context, planung, { dateien, bau = [OHNE_FIX], umgebung } = {}) {
  const drehbuch = { test: [TEST], bau, planung, notiz: [{ antwort: "1. Pitch prüfen" }] };
  const ergebnis = lauf(context, drehbuch, { dateien, umgebung });
  assert.equal(ergebnis.ergebnis.status, EXIT_ROT);
  const { versuche } = ergebnis.beleg("a1-neuschnitt");
  return { ...ergebnis, versuche, befunde: versuche[0].befunde };
}

export function ohne(objekt, ...felder) {
  return Object.fromEntries(Object.entries(objekt).filter(([name]) => !felder.includes(name)));
}

export function nummerierteNamen(...kennungen) {
  return kennungen.map((kennung) => `${kennung}: neue Aufträge heißen a1-n1, a1-n2 und so weiter.`);
}

export function prompts(text) {
  return `\n${text}`.split("\n\n## Neuschnitt\n\n").slice(1);
}

export const UMBAU_ZWEI = { dateien: { "src/text.js": "export function gross(eingabe) {\n  return eingabe.toUpperCase();\n}\n" }, antwort: "Fertig." };

export const BEHALTEN = "a1 steht noch in der Phasendatei; der Neuschnitt ersetzt ihn.";

export const KEIN_NEUER = "Der Neuschnitt nennt keinen neuen Auftrag statt a1.";

export const OHNE_EMPFEHLUNG = "Zu „Pitch ändern: …“ fehlt die Zeile „Empfehlung: …“.";

export const GESTOPPT = "Auftrag a1 der Phase P-001-probe ist nach 2 roten Runden gestoppt.";
