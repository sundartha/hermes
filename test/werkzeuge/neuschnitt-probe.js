import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { alsJson } from "./planung-probe.js";
import { mitErsatzWerkzeugen } from "./ersatz-werkzeuge.js";
import { REPO_ROOT, commitAll, isolatedEnvironment, probeDirectory, runIn } from "./probe-repo.js";

export const AUSFUEHRBAR = 0o755;
export const EXIT_ROT = 1;
export const ISSUE = 54;
const PROBE = "probe@example.invalid";
export const ORDNER = "plaene/P-001-probe";
export const PHASENDATEI = `${ORDNER}/phase.json`;
export const S1 = "Gegeben die Zahl 2\nWenn ein Agent `verdopple` mit 2 aufruft\nDann ist die Antwort `4`";
export const VERBOT = "Eine negative Zahl wird nie positiv.";
const UMBAU_AUSWEG = "keiner, weil Umbau: bestehende Tests bleiben unverändert grün";
export const ABNAHME = "test/rechnen/verdoppeln.test.js";
export const TEXT_TEST = "test/text/gross.test.js";
export const RECHNEN_BESTAND = "test/rechnen/null.test.js";
export const TEXT_BESTAND = "test/text/leer.test.js";
const TEAM_DATEIEN = [".claude/agents/planer.md", ".claude/agents/erkunder.md", ".claude/agents/pruefer-planung.md", ".claude/agents/entwurf.md", ".claude/skills/pitch/phase-vorlage.md"];
const BEREICHE = [
  ["rechnen", "^src/rechnen\\.js$"],
  ["text", "^src/text\\.js$"],
].map(([bereich, muster]) => ({ bereich, quellen: [muster], eingaenge: [], fachlogik: [] }));

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
const eingabe = readFileSync(0, "utf8");
appendFileSync(join(ort, "prompt-" + rolle + ".txt"), eingabe + "\\n");
appendFileSync(join(ort, "argumente-" + rolle + ".txt"), JSON.stringify(process.argv.slice(2)) + "\\n");
for (const [pfad, inhalt] of Object.entries(einsatz.dateien ?? {})) {
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, inhalt);
}
if (einsatz.commit) execFileSync("git", ["commit", "-qam", "Planer"]);
const zeilen = (eingabe.split("### Zeilen deiner Prüfliste")[1] ?? "").split("\\n").filter((zeile) => zeile.startsWith("- ")).map((zeile) => zeile.slice(2));
const pruefliste = zeilen.map((schluessel) => ({ schluessel, ergebnis: "erfüllt", fundstelle: "src/rechnen.js:1", ...(einsatz.befunde?.[schluessel] ? { ergebnis: "befund", befund: einsatz.befunde[schluessel] } : {}) }));
const antwort = einsatz.pruefliste ? "Geprüft.\\n\\n\`\`\`json\\n" + JSON.stringify({ pruefliste }) + "\\n\`\`\`" : einsatz.antwort ?? "fertig";
for (const zeile of einsatz.zeilen ?? []) process.stdout.write(JSON.stringify(zeile) + "\\n");
process.stdout.write(JSON.stringify({ type: "result", is_error: false, result: antwort }) + "\\n");
process.exitCode = einsatz.exit ?? 0;
`;

const KIND = `import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const zaehler = join(dirname(process.env.ERSATZ_DREHBUCH), "anzahl-kind");
const nummer = existsSync(zaehler) ? Number(readFileSync(zaehler, "utf8")) : 0;
writeFileSync(zaehler, String(nummer + 1));
const liste = JSON.parse(readFileSync(process.env.ERSATZ_DREHBUCH, "utf8")).kind;
const { ergebnis = { exitCode: 0, antwort: "neu geschnitten", sitzungen: [] }, ...dateien } = liste[Math.min(nummer, liste.length - 1)];
for (const [pfad, inhalt] of Object.entries(dateien)) {
  mkdirSync(dirname(pfad), { recursive: true });
  writeFileSync(pfad, inhalt);
}
writeFileSync(join(process.argv[2], "ergebnis.json"), JSON.stringify(ergebnis));
`;

const GH = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
const eingabe = process.argv.includes("-") ? readFileSync(0, "utf8") : "";
appendFileSync(process.env.ERSATZ_GH, JSON.stringify([...process.argv.slice(2), eingabe]) + "\\n");
`;

const ROTER_TEST = [
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  'import { verdopple } from "../../src/rechnen.js";',
  'test("verdoppelt", () => assert.equal(verdopple(2), 4));',
  "",
].join("\n");

export const PITCH = ["# P-001 Probe", "", "## Anforderungen", "", "### Regel R1: Zahlen werden verdoppelt.", "", "#### Szenario S1: Verdoppeln", S1, "", "## Nicht-Ziele", "", VERBOT, ""].join("\n");
export const ANNAHME = "| `verdopple` gibt heute die Zahl unverändert zurück | `src/rechnen.js` | – |";
export const DESIGN = ["# P-001 Probe: Design Doc", "", "## Ausgangslage und Annahmen", "| Aussage | Beleg | Wenn sie nicht stimmt |", "|---|---|---|", ANNAHME, ""].join("\n");
export const SICHERHEIT = ["# P-001 Probe: Sicherheitsprüfung", "", "## 2. Angriffswege", "Keine Angriffswege gefunden, weil nichts Neues erreichbar ist.", "", "## 3. Lückenprüfung", ""].join("\n");

export function funktion(id, aenderung = {}) {
  return {
    id,
    art: "funktion",
    ziel: "Verdopple Zahlen",
    bereich: "src/rechnen.js",
    erwarteteDateien: ["src/rechnen.js", ABNAHME],
    vorbild: "src/text.js",
    abnahme: ABNAHME,
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

function gruenerTest(datei, name, pruefung) {
  return `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { ${name} } from "../../src/${datei}";\ntest("${name}", () => ${pruefung});\n`;
}

export const REPO = {
  "package.json": JSON.stringify({ type: "module", scripts: { test: "node --test --test-reporter=tap", lint: "node -e 0", "test:betroffen": "node -e 0 --" } }),
  ".gitignore": ".fortschritt/\n",
  "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl;\n}\n",
  "src/text.js": "export function gross(text) {\n  return text.toUpperCase();\n}\n",
  [TEXT_TEST]: gruenerTest("text.js", "gross", 'assert.equal(gross("a"), "A")'),
  [TEXT_BESTAND]: gruenerTest("text.js", "gross", 'assert.equal(gross(""), "")'),
  [RECHNEN_BESTAND]: gruenerTest("rechnen.js", "verdopple", "assert.equal(verdopple(0), 0)"),
  [`${ORDNER}/pitch.md`]: PITCH,
  [`${ORDNER}/sicherheit.md`]: SICHERHEIT,
  [`${ORDNER}/design.md`]: DESIGN,
  [PHASENDATEI]: phase([funktion("a1")]),
};

export const TEST = { dateien: { [ABNAHME]: ROTER_TEST } };
export const OHNE_FIX = { antwort: "Ich finde keinen Weg im Bereich." };
export const MIT_FIX = { dateien: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" }, antwort: "Fertig." };
export const UMBAU_FERTIG = { dateien: { "src/text.js": "export function gross(wort) {\n  return wort.toUpperCase();\n}\n" }, antwort: "Fertig." };
export const NEUSCHNITT = { dateien: { [PHASENDATEI]: phase([funktion("a1-n1", { ziel: "Verdopple Zahlen in rechnen.js" })]) }, antwort: "a1-n1: Verdopple Zahlen in rechnen.js" };

const STELLE = { datei: "src/rechnen.js", funktion: "verdopple", von: 1, bis: 3 };
const SCHEMA = { schema: { aenderung: false, fundstelle: "src/rechnen.js Zeile 1" }, codeowners: [], ownerEntscheidung: "keine, weil keine geschützte Datei betroffen ist" };
const NIE = [{ satz: VERBOT, quelle: "pitch.md", abschnitt: "## Nicht-Ziele" }];
export const ENTWURF_RECHNEN = "Grundlage: pitch.md, Szenario S1\nverdopple gibt das Doppelte zurück.\nFehlerfälle: keine";

function erkundung(weitere = []) {
  const weg = { weg: [{ rolle: "eingang", ...STELLE }, { rolle: "wirkung", ...STELLE }], aenderungen: [{ ...STELLE, neueZeilen: 1 }, ...weitere], tests: [RECHNEN_BESTAND], vorbild: "src/rechnen.js" };
  return { antwort: alsJson({ nummern: { S1: { ...weg, ...SCHEMA, eingangImTest: "erreichbar", widersprueche: [] } }, hinweise: [] }) };
}

export const MIT_TEXT = erkundung([{ datei: "src/text.js", funktion: "gross", von: 1, bis: 3, neueZeilen: 0 }]);

const TEAM = { erkunder: [erkundung()], "pruefer-planung": [{ pruefliste: true }], entwurf: [{ antwort: alsJson({ entwurf: ENTWURF_RECHNEN }) }] };

export function neu(id, aenderung = {}) {
  const { szenarien, ...rest } = funktion(id);
  if (szenarien === undefined) throw new Error(`${id}: funktion liefert keine szenarien`);
  return { ...rest, wasDarfNiePassieren: NIE, eingang: "erreicht", ...aenderung };
}

export function neuUmbau(id, aenderung = {}) {
  return umbau(id, { wasDarfNiePassieren: NIE, ...aenderung });
}

export function schneide(auftraege, aenderung = "a1 wird neu geschnitten.") {
  return { antwort: alsJson({ schnitt: { annahmen: [], fehlendeSzenarien: [], ownerAufgaben: [], gemeinsameNamen: [], auftraege }, aenderung }) };
}

export const SCHNITT = schneide([neu("a1-n1", { ziel: "Verdopple Zahlen in rechnen.js" })], "a1-n1: Verdopple Zahlen in rechnen.js");

const ERSATZ = { HERMES_CLAUDE: "claude.mjs", HERMES_GH: "gh.mjs", ERSATZ_DREHBUCH: "drehbuch.json", ERSATZ_GH: "gh.log" };
const IDENTITAET = { GIT_AUTHOR_NAME: "Probe", GIT_AUTHOR_EMAIL: PROBE, GIT_COMMITTER_NAME: "Probe", GIT_COMMITTER_EMAIL: PROBE };

export function teamRepository(context, dateien) {
  const repo = probeDirectory(context, { "eslint.config.js": 'export default [{ rules: { "no-var": "error" } }];\n', "tools/bereiche.json": JSON.stringify(BEREICHE), ...dateien });
  for (const pfad of TEAM_DATEIEN) {
    mkdirSync(dirname(join(repo, pfad)), { recursive: true });
    copyFileSync(join(REPO_ROOT, pfad), join(repo, pfad));
  }
  runIn(repo, "git", ["init", "-q"]);
  commitAll(repo, "Basis");
  return repo;
}

export function ersatzUmgebung(context, drehbuch) {
  const werkzeug = probeDirectory(context, { "claude.mjs": CLAUDE, "gh.mjs": GH, "kind.mjs": KIND, "drehbuch.json": JSON.stringify(drehbuch) });
  chmodSync(join(werkzeug, "claude.mjs"), AUSFUEHRBAR);
  chmodSync(join(werkzeug, "gh.mjs"), AUSFUEHRBAR);
  const ersatz = Object.entries(ERSATZ).map(([name, datei]) => [name, join(werkzeug, datei)]);
  const kind = drehbuch.kind ? { HERMES_NEUSCHNITT_START: join(werkzeug, "kind.mjs") } : {};
  return { werkzeug, env: { ...isolatedEnvironment(), ...Object.fromEntries(ersatz), ...kind, ...IDENTITAET, HOME: werkzeug, ...mitErsatzWerkzeugen(werkzeug) } };
}

export function lauf(context, drehbuch, { dateien = {}, phasendatei = PHASENDATEI, umgebung = {} } = {}) {
  const repo = teamRepository(context, Object.fromEntries(Object.entries({ ...REPO, ...dateien }).filter(([, inhalt]) => inhalt !== undefined)));
  const { werkzeug, env: ersatz } = ersatzUmgebung(context, { ...TEAM, ...drehbuch });
  const env = { ...ersatz, ...umgebung, HOME: werkzeug };
  const ergebnis = spawnSync(process.execPath, [join(REPO_ROOT, "tools/auftrag.mjs"), "lauf", phasendatei], { cwd: repo, encoding: "utf8", env });
  const lies = (pfad) => (existsSync(pfad) ? readFileSync(pfad, "utf8") : "");
  const beleg = (name) => JSON.parse(lies(join(repo, ".fortschritt/P-001-probe", `${name}.json`)) || "null");
  const git = (...argumente) => runIn(repo, "git", argumente).stdout;
  return { repo, ergebnis, beleg, git, datei: (name) => lies(join(werkzeug, name)) };
}

export function umbau(id, aenderung = {}) {
  const { szenarien, erwarteterFehler, ...rest } = funktion(id);
  assert.ok(szenarien && erwarteterFehler);
  return { ...rest, art: "umbau", bereich: "src/text.js", erwarteteDateien: ["src/text.js"], abnahme: TEXT_TEST, prueft: UMBAU_AUSWEG, ...aenderung };
}

export function ersterVersuch(context, rollen, { dateien, bau = [OHNE_FIX], umgebung } = {}) {
  const drehbuch = { test: [TEST], bau, ...rollen, notiz: [{ antwort: "1. Pitch prüfen" }] };
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

export const OHNE_EMPFEHLUNG = "Zu „Pitch ändern: …“ fehlt die Zeile „Empfehlung: …“.";

export const GESTOPPT = "Auftrag a1 der Phase P-001-probe ist nach 2 roten Runden gestoppt.";

function befundeWie(befunde, erwartet) {
  const gekuerzt = befunde.map((befund, stelle) => (erwartet[stelle]?.anfang === undefined ? befund : befund.slice(0, erwartet[stelle].anfang.length)));
  assert.deepEqual(gekuerzt, erwartet.map((eintrag) => eintrag.anfang ?? eintrag), befunde.join("\n"));
}

export function ohneTeam(context, faelle) {
  for (const { kind, dateien, bau, erwartet } of faelle) {
    const { befunde, datei } = ersterVersuch(context, { kind: [kind] }, { dateien, bau });
    befundeWie(befunde, erwartet);
    assert.deepEqual(["planer", "erkunder", "kind"].map((rolle) => datei(`anzahl-${rolle}`)), ["", "", "2"]);
  }
}
