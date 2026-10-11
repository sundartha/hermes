import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const AUSFUEHRBAR = 0o755;
const EXIT_ROT = 1;
const ISSUE = 54;
const PROBE = "probe@example.invalid";
const ORDNER = "plaene/P-001-probe";
const PHASENDATEI = `${ORDNER}/phase.json`;
const S1 = "Gegeben die Zahl 2\nWenn ein Agent `verdopple` mit 2 aufruft\nDann ist die Antwort `4`";
const VERBOT = "Eine negative Zahl wird nie positiv.";
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

const PITCH = ["# P-001 Probe", "", "## Anforderungen", "", "### Regel R1: Zahlen werden verdoppelt.", "", "#### Szenario S1: Verdoppeln", S1, "", "## Nicht-Ziele", ""].join("\n");
const SICHERHEIT = ["# P-001 Probe: Sicherheitsprüfung", "", "## 2. Angriffswege", "Keine Angriffswege gefunden, weil nichts Neues erreichbar ist.", "", "## 3. Lückenprüfung", ""].join("\n");

function funktion(id, aenderung = {}) {
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

function phase(auftraege, rahmen = {}) {
  return `${JSON.stringify({ phase: "P-001-probe", issue: ISSUE, entwurf: { "src/rechnen.js": "Entwurf.", "src/text.js": "Entwurf Text." }, ...rahmen, auftraege }, null, 2)}\n`;
}

const REPO = {
  "package.json": JSON.stringify({ type: "module", scripts: { test: "node --test --test-reporter=tap", lint: "node -e 0", "test:betroffen": "node -e 0 --" } }),
  ".gitignore": ".fortschritt/\n",
  "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl;\n}\n",
  "src/text.js": "export function gross(text) {\n  return text.toUpperCase();\n}\n",
  "test/text.test.js": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { gross } from "../src/text.js";\ntest("gross", () => assert.equal(gross("a"), "A"));\n',
  [`${ORDNER}/pitch.md`]: PITCH,
  [`${ORDNER}/sicherheit.md`]: SICHERHEIT,
  [PHASENDATEI]: phase([funktion("a1")]),
};

const TEST = { dateien: { "test/rechnen.test.js": ROTER_TEST } };
const OHNE_FIX = { antwort: "Ich finde keinen Weg im Bereich." };
const MIT_FIX = { dateien: { "src/rechnen.js": "export function verdopple(zahl) {\n  return zahl * 2;\n}\n" }, antwort: "Fertig." };
const UMBAU_FERTIG = { dateien: { "src/text.js": "export function gross(wort) {\n  return wort.toUpperCase();\n}\n" }, antwort: "Fertig." };
const NEUSCHNITT = { dateien: { [PHASENDATEI]: phase([funktion("a1-n1", { ziel: "Verdopple Zahlen in rechnen.js" })]) }, antwort: "a1-n1: Verdopple Zahlen in rechnen.js" };

const ERSATZ = { HERMES_CLAUDE: "claude.mjs", HERMES_GH: "gh.mjs", ERSATZ_DREHBUCH: "drehbuch.json", ERSATZ_GH: "gh.log" };
const IDENTITAET = { GIT_AUTHOR_NAME: "Probe", GIT_AUTHOR_EMAIL: PROBE, GIT_COMMITTER_NAME: "Probe", GIT_COMMITTER_EMAIL: PROBE };

function lauf(context, drehbuch, { dateien = {}, phasendatei = PHASENDATEI, umgebung = {} } = {}) {
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

test("ein Auftrag aus einem Pitch bleibt zweimal rot, der Planer schneidet ihn neu und der Lauf wird ohne Entscheidungsnotiz grün", (context) => {
  const drehbuch = { test: [TEST], bau: [OHNE_FIX, OHNE_FIX, MIT_FIX], planung: [NEUSCHNITT] };
  const { ergebnis, beleg, git, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  assert.deepEqual([datei("anzahl-planung"), datei("anzahl-notiz"), datei("gh.log")], ["1", "", ""]);
  const prompt = datei("prompt-planung.txt");
  assert.match(prompt, /^\n## Neuschnitt\n\nAuftrag a1 der Phase P-001-probe ist nach 2 roten Runden gestoppt\./);
  for (const teil of ["Runde 1: abnahme endete mit Exit 1.", "Runde 2: abnahme endete mit Exit 1.", "Hinweise des Bau-Agenten:\n> Ich finde keinen Weg im Bereich.", `Freigegebene Dokumente: ${ORDNER}/pitch.md, ${ORDNER}/sicherheit.md`, `Phasendatei: ${PHASENDATEI}`, '"id": "a1"']) {
    assert.ok(prompt.includes(teil), teil);
  }
  assert.ok(datei("argumente-planung.txt").startsWith('["-p","--agent","planung","--settings","{\\"disableAllHooks\\":true}"'), datei("argumente-planung.txt"));
  assert.equal(git("log", "--format=%s", "-2"), "Verdopple Zahlen in rechnen.js\nSchneide den Auftrag a1 neu\n");
  assert.match(git("log", "-1", "--format=%B", "HEAD~1"), /\n\nWarum: Auftrag a1 der Phase P-001-probe ist nach 2 roten Runden gestoppt\.\nDer Planer ersetzt ihn durch a1-n1; pruefe und die Abdeckungsprüfung sind grün\.\n\nAuftrag: P-001-probe\/a1\n/);
  assert.ok(git("log", "-1", "--format=%B", "HEAD~1").endsWith("\n\nAuftrag: P-001-probe/a1\n\n"), git("log", "-1", "--format=%B", "HEAD~1"));
  assert.ok(ergebnis.stdout.includes("Auftrag a1: neu geschnitten, weiter mit den Aufträgen des Neuschnitts.\n"), ergebnis.stdout);
  assert.equal(beleg("a1-n1").ergebnis, "grün");
  assert.equal(beleg("a1-neuschnitt").ergebnis, "grün");
  assert.equal(git("status", "--porcelain"), "");
});

test("nach „Auftrag passt nicht“ bekommt der Planer den Grund wörtlich und der Lauf geht mit dem Neuschnitt weiter", (context) => {
  const grund = "Der Abnahmetest verlangt ein Verhalten, das der Entwurf ausschließt.";
  const drehbuch = { test: [TEST], bau: [{ antwort: `Ich höre auf.\nAuftrag passt nicht: ${grund}` }, MIT_FIX], planung: [NEUSCHNITT] };
  const { ergebnis, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, 0, ergebnis.stdout + ergebnis.stderr);
  const prompt = datei("prompt-planung.txt");
  assert.ok(prompt.includes(`\nAuftrag passt nicht: ${grund}\n`), prompt);
  assert.ok(prompt.includes(`Hinweise des Bau-Agenten:\n> Ich höre auf.\n> Auftrag passt nicht: ${grund}`), prompt);
  assert.deepEqual([datei("anzahl-bau"), datei("anzahl-planung"), datei("gh.log")], ["2", "1", ""]);
});

test("ein Neuschnitt, der den Szenariotext in der Phasendatei ändert, wird abgelehnt und endet nach dem zweiten Versuch als Entscheidungsnotiz", (context) => {
  const geaendert = { dateien: { [PHASENDATEI]: phase([funktion("a1-n1", { szenarien: { S1: S1.replace("`4`", "`4` oder mehr") } })]) } };
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planung: [geaendert], notiz: [{ antwort: "1. Pitch prüfen" }] };
  const { ergebnis, beleg, git, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.equal(datei("anzahl-planung"), "2");
  const [erster] = beleg("a1-neuschnitt").versuche;
  assert.ok(erster.befunde.some((befund) => befund.startsWith('a1-n1: szenarien["S1"] ist nicht wörtlich der Text aus pitch.md')), erster.befunde.join("\n"));
  assert.match(datei("prompt-planung.txt"), /## Befunde zu deinem vorigen Neuschnitt[\s\S]*ist nicht wörtlich/);
  assert.equal(git("show", `HEAD:${PHASENDATEI}`), REPO[PHASENDATEI]);
  assert.equal(git("status", "--porcelain"), "");
  assert.match(datei("gh.log"), /"comment","54".*nicht so neu geschnitten.*Pitch prüfen/);
});

test("ein Neuschnitt, der Szenario und Pitch zugleich ändert, wird abgelehnt und der Pitch bleibt, wie er war", (context) => {
  const anders = S1.replace("`4`", "`5`");
  const beides = { dateien: { [`${ORDNER}/pitch.md`]: PITCH.replace(S1, anders), [PHASENDATEI]: phase([funktion("a1-n1", { szenarien: { S1: anders } })]) } };
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planung: [beides], notiz: [{ antwort: "1. Pitch prüfen" }] };
  const { ergebnis, beleg, repo } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.deepEqual(beleg("a1-neuschnitt").versuche[0].befunde, [`Der Planer darf nur ${PHASENDATEI} ändern, nicht ${ORDNER}/pitch.md.`]);
  assert.equal(readFileSync(join(repo, ORDNER, "pitch.md"), "utf8"), PITCH);
});

test("ein Neuschnitt, der einen Satz aus wasDarfNiePassieren weglässt, wird abgelehnt", (context) => {
  const ohne = { dateien: { [PHASENDATEI]: phase([funktion("a1-n1", { wasDarfNiePassieren: [] })]) } };
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planung: [ohne], notiz: [{ antwort: "1. Pitch prüfen" }] };
  const { ergebnis, beleg } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.deepEqual(beleg("a1-neuschnitt").versuche[0].befunde, [`Kein neuer Auftrag mit eigenem Abnahmetest übernimmt aus a1 wörtlich: ${VERBOT}`]);
});

test("meldet der Planer, dass sich ein Szenario ändern müsste, entsteht eine Entscheidungsnotiz mit genau dieser Frage", (context) => {
  const frage = "Soll S1 auch für negative Zahlen gelten? (pitch.md, Szenario S1)";
  const empfehlung = "Nein, weil das Nicht-Ziel sonst wegfällt.";
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planung: [{ antwort: `Pitch ändern: ${frage}\nEmpfehlung: ${empfehlung}` }] };
  const { ergebnis, beleg, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  const { text } = beleg("a1").entscheidung;
  assert.ok(text.startsWith("## Entscheidung nötig\n\nDer Planer kann den Auftrag a1 der Phase P-001-probe nur neu schneiden, wenn sich der Pitch ändert."), text);
  assert.ok(text.includes(`\nPitch ändern: ${frage}\nEmpfehlung: ${empfehlung}\n`), text);
  assert.ok(datei("gh.log").includes(`Pitch ändern: ${frage}`));
  assert.ok(datei("gh.log").includes(`"edit","${ISSUE}","--add-label","entscheidung"`));
  assert.deepEqual([datei("anzahl-planung"), datei("anzahl-notiz")], ["1", ""]);
});

test("bleibt ein Auftrag aus einem Neuschnitt wieder zweimal rot, startet der Planer nicht noch einmal und es entsteht eine Entscheidungsnotiz", (context) => {
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planung: [NEUSCHNITT], notiz: [{ antwort: "1. Szenario prüfen" }] };
  const { ergebnis, beleg, git, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.deepEqual([datei("anzahl-planung"), datei("anzahl-bau"), datei("anzahl-notiz")], ["1", "4", "1"]);
  assert.match(beleg("a1-n1").entscheidung.text, /Der Auftrag stammt schon aus einem Neuschnitt; höchstens 1 Neuschnitt je Auftrag, danach entscheidet der Nutzer\./);
  assert.match(datei("gh.log"), /"comment","54".*stammt schon aus einem Neuschnitt.*Szenario prüfen/);
  assert.equal(git("log", "--format=%s", "-1"), "Schneide den Auftrag a1 neu\n");
});

function umbau(id, aenderung = {}) {
  const { szenarien, erwarteterFehler, ...rest } = funktion(id);
  assert.ok(szenarien && erwarteterFehler);
  return { ...rest, art: "umbau", bereich: "src/text.js", erwarteteDateien: ["src/text.js"], abnahme: "test/text.test.js", prueft: UMBAU_AUSWEG, ...aenderung };
}

function ersterVersuch(context, planung, { dateien, bau = [OHNE_FIX], umgebung } = {}) {
  const drehbuch = { test: [TEST], bau, planung, notiz: [{ antwort: "1. Pitch prüfen" }] };
  const ergebnis = lauf(context, drehbuch, { dateien, umgebung });
  assert.equal(ergebnis.ergebnis.status, EXIT_ROT);
  const { versuche } = ergebnis.beleg("a1-neuschnitt");
  return { ...ergebnis, versuche, befunde: versuche[0].befunde };
}

test("ein Neuschnitt, der den Satz aus wasDarfNiePassieren nur einem Umbau gibt, wird abgelehnt", (context) => {
  const auftraege = [umbau("a1-n1", { wasDarfNiePassieren: [VERBOT] }), funktion("a1-n2", { wasDarfNiePassieren: [], abhaengigVon: ["a1-n1"] })];
  const { befunde } = ersterVersuch(context, [{ dateien: { [PHASENDATEI]: phase(auftraege) } }]);
  assert.deepEqual(befunde, [`Kein neuer Auftrag mit eigenem Abnahmetest übernimmt aus a1 wörtlich: ${VERBOT}`]);
});

test("ein Neuschnitt, den der Planer selbst committet, wird abgelehnt und auf den Stand vor ihm zurückgesetzt", (context) => {
  const { befunde, git } = ersterVersuch(context, [{ ...NEUSCHNITT, commit: true }]);
  assert.deepEqual(befunde, ["Der Planer darf nicht committen; der Lauf setzt auf den Stand vor ihm zurück."]);
  assert.equal(git("show", `HEAD:${PHASENDATEI}`), REPO[PHASENDATEI]);
  assert.equal(git("log", "--format=%s", "-1"), "Basis\n");
});

test("ein Planer, der Belege unter .fortschritt ändert, wird abgelehnt", (context) => {
  const { befunde } = ersterVersuch(context, [{ dateien: { ...NEUSCHNITT.dateien, ".fortschritt/P-001-probe/a1.json": "{}" } }]);
  assert.deepEqual(befunde, ["Der Planer hat .fortschritt/ verändert."]);
});

test("ein Neuschnitt darf andere Aufträge, ihren Entwurf, Vorgänger und den Rahmen der Phasendatei nicht ändern", (context) => {
  const vorher = JSON.parse(phase([umbau("a0"), funktion("a1", { abhaengigVon: ["a0"] }), umbau("a2", { abhaengigVon: ["a1"] })]));
  const nachher = { ...vorher, issue: ISSUE + 1, entwurf: { ...vorher.entwurf, "src/text.js": "Anders." } };
  nachher.auftraege = [umbau("a0", { ziel: "Anders" }), funktion("a1"), funktion("a1-x"), umbau("a2", { abhaengigVon: ["a1"] })];
  const datei = (inhalt) => `${JSON.stringify(inhalt, null, 2)}\n`;
  const { befunde, git } = ersterVersuch(context, [{ dateien: { [PHASENDATEI]: datei(nachher) } }], { dateien: { [PHASENDATEI]: datei(vorher) }, bau: [UMBAU_FERTIG, OHNE_FIX] });
  assert.equal(git("log", "--format=%s", "-1"), "Verdopple Zahlen\n");
  for (const befund of [
    "a1 steht noch in der Phasendatei; der Neuschnitt ersetzt ihn.",
    "a1-x: neue Aufträge heißen a1-n1, a1-n2 und so weiter.",
    "a0 hat sich geändert; ein Neuschnitt ersetzt nur a1.",
    "a1 hing von a0 ab; das muss auch ein neuer Auftrag in abhaengigVon nennen.",
    "Der Entwurf für src/text.js gehört auch anderen Aufträgen und bleibt, wie er ist.",
    "Außer auftraege und entwurf bleibt die Phasendatei, wie sie ist.",
  ]) {
    assert.ok(befunde.includes(befund), `${befund}\n${befunde.join("\n")}`);
  }
});

test("antwortet der Planer „Zerlegung passt nicht“, schreibt der Notiz-Agent die Entscheidungsnotiz mit diesem Grund", (context) => {
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planung: [{ antwort: "Zerlegung passt nicht: Design Doc und Code widersprechen sich." }], notiz: [{ antwort: "1. Design Doc prüfen" }] };
  const { ergebnis, beleg, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.deepEqual([datei("anzahl-planung"), datei("anzahl-notiz")], ["1", "1"]);
  assert.match(datei("prompt-notiz.txt"), /Neuschnitt 1: Zerlegung passt nicht: Design Doc und Code widersprechen sich\./);
  assert.match(beleg("a1").entscheidung.text, /dass sich der Auftrag mit den freigegebenen Dokumenten nicht neu schneiden lässt/);
});

test("eine Frage an den Nutzer ohne Empfehlung zählt als abgelehnter Neuschnitt", (context) => {
  const { befunde, datei } = ersterVersuch(context, [{ antwort: "Pitch ändern: Soll S1 wegfallen?" }]);
  assert.deepEqual(befunde, ["Zu „Pitch ändern: …“ fehlt die Zeile „Empfehlung: …“."]);
  assert.equal(datei("anzahl-planung"), "2");
});

function ohne(objekt, ...felder) {
  return Object.fromEntries(Object.entries(objekt).filter(([name]) => !felder.includes(name)));
}

function nummerierteNamen(...kennungen) {
  return kennungen.map((kennung) => `${kennung}: neue Aufträge heißen a1-n1, a1-n2 und so weiter.`);
}

function prompts(text) {
  return `\n${text}`.split("\n\n## Neuschnitt\n\n").slice(1);
}

const UMBAU_ZWEI = { dateien: { "src/text.js": "export function gross(eingabe) {\n  return eingabe.toUpperCase();\n}\n" }, antwort: "Fertig." };
const BEHALTEN = "a1 steht noch in der Phasendatei; der Neuschnitt ersetzt ihn.";
const KEIN_NEUER = "Der Neuschnitt nennt keinen neuen Auftrag statt a1.";
const OHNE_EMPFEHLUNG = "Zu „Pitch ändern: …“ fehlt die Zeile „Empfehlung: …“.";
const GESTOPPT = "Auftrag a1 der Phase P-001-probe ist nach 2 roten Runden gestoppt.";

test("ohne vollständigen Plan aus einem Pitch im Repo oder nach einem Neuschnitt startet der Planer nicht und es entsteht gleich eine Entscheidungsnotiz", (context) => {
  const aussen = probeDirectory(context, { "plan/pitch.md": PITCH, "plan/sicherheit.md": SICHERHEIT, "plan/phase.json": REPO[PHASENDATEI] });
  const faelle = [
    { dateien: { [`${ORDNER}/pitch.md`]: undefined } },
    { dateien: { [`${ORDNER}/sicherheit.md`]: undefined } },
    { dateien: { [PHASENDATEI]: phase([funktion("a1")], { phase: "alt-P-001" }) } },
    { dateien: { [`${ORDNER}/phase-neu.json`]: REPO[PHASENDATEI] }, phasendatei: `${ORDNER}/phase-neu.json` },
    { phasendatei: join(aussen, "plan/phase.json") },
    { dateien: { [PHASENDATEI]: phase([funktion("a1-n12")]) } },
  ];
  for (const { dateien, phasendatei } of faelle) {
    const { ergebnis, datei } = lauf(context, { test: [TEST], bau: [OHNE_FIX], notiz: [{ antwort: "1. Plan prüfen" }] }, { dateien, phasendatei });
    const fall = JSON.stringify({ dateien, phasendatei });
    assert.equal(ergebnis.status, EXIT_ROT, fall + ergebnis.stdout + ergebnis.stderr);
    assert.deepEqual([datei("anzahl-planung"), datei("anzahl-notiz")], ["", "1"], fall);
  }
});

test("ein Neuschnitt nach zwei fertigen Aufträgen mit zwei Nachfolgern, neuen Vorgängern eines späteren Auftrags und eigenem Entwurf wird mit Paket in der Commit-Nachricht übernommen", (context) => {
  const rahmen = { paket: "V4" };
  const vorher = [ohne(umbau("a0"), "abhaengigVon"), umbau("a0b"), funktion("a1", { abhaengigVon: ["a0"] }), umbau("a2", { abhaengigVon: ["a0", "a1"] })];
  const nachher = [
    vorher[0],
    vorher[1],
    umbau("a1-n2", { abhaengigVon: ["a1-n1"] }),
    funktion("a1-n1", { abhaengigVon: ["a0"], wasDarfNiePassieren: { N1: VERBOT } }),
    umbau("a2", { abhaengigVon: ["a1-n2", "a1-n1", "a0"] }),
  ];
  const geschnitten = phase(nachher, { ...rahmen, entwurf: { "src/rechnen.js": "Entwurf nach dem Neuschnitt.", "src/text.js": "Entwurf Text." } });
  const drehbuch = { test: [TEST], bau: [UMBAU_FERTIG, UMBAU_ZWEI, OHNE_FIX], planung: [{ dateien: { [PHASENDATEI]: geschnitten } }], notiz: [{ antwort: "1. Szenario prüfen" }] };
  const { ergebnis, beleg, git, datei } = lauf(context, drehbuch, { dateien: { [PHASENDATEI]: phase(vorher, rahmen) } });
  assert.equal(ergebnis.status, EXIT_ROT, ergebnis.stdout + ergebnis.stderr);
  assert.ok(ergebnis.stdout.includes("Auftrag a1: neu geschnitten, weiter mit den Aufträgen des Neuschnitts.\n"), ergebnis.stdout);
  assert.ok(datei("prompt-planung.txt").includes("\nSchon übernommen: a0, a0b\n"), datei("prompt-planung.txt"));
  assert.deepEqual(beleg("a1-neuschnitt").versuche, [{ neu: [{ id: "a1-n2", bereich: "src/text.js" }, { id: "a1-n1", bereich: "src/rechnen.js" }] }]);
  const nachricht = [
    "Schneide den Auftrag a1 neu",
    "",
    `Warum: ${GESTOPPT}`,
    "Der Planer ersetzt ihn durch a1-n2, a1-n1; pruefe und die Abdeckungsprüfung sind grün.",
    "",
    "Auftrag: P-001-probe/a1",
    "Paket: V4",
    "",
  ].join("\n");
  assert.equal(git("log", "-1", "--format=%B"), `${nachricht}\n`);
  assert.equal(git("show", `HEAD:${PHASENDATEI}`), geschnitten);
  assert.equal(datei("anzahl-planung"), "1");
});

test("ein Neuschnitt mit Nachfolgern, die nicht genau Kennung-n und eine Zahl heißen, oder mit ungültiger Phasendatei wird abgelehnt", (context) => {
  const falscheNamen = phase([funktion("a1-n01"), umbau("a1-n1x"), umbau("b1-n5")]);
  const falscheArt = phase([funktion("a1-n1", { art: "falsch" })]);
  const { versuche } = ersterVersuch(context, [{ dateien: { [PHASENDATEI]: falscheNamen } }, { dateien: { [PHASENDATEI]: falscheArt } }]);
  assert.deepEqual(versuche, [{ befunde: nummerierteNamen("a1-n01", "a1-n1x", "b1-n5") }, { befunde: ["a1-n1: art muss eine von funktion, fehlerbehebung, umbau sein", "a1-n1: ein Umbau braucht einen bestehenden Verhaltenstest, test/rechnen.test.js fehlt"] }]);
});

test("Pitch- und Zerlegungszeilen zählen nur am Zeilenanfang und ein Umbau ohne Verbote und Vorgänger bekommt die Befunde wörtlich im nächsten Prompt und in der Notiz", (context) => {
  const mittendrin = { antwort: "Vorschlag: Pitch ändern: Soll S1 wegfallen?\nNotiz: Zerlegung passt nicht: Der Entwurf fehlt.\nEmpfehlung: Nein." };
  const halb = { antwort: "Pitch ändern: Soll S1 wegfallen?\nMeine Empfehlung: Nein." };
  const dateien = { [PHASENDATEI]: phase([ohne(umbau("a1"), "wasDarfNiePassieren", "abhaengigVon")]) };
  const { versuche, datei } = ersterVersuch(context, [mittendrin, halb], { dateien });
  const ohneAbdeckung = [BEHALTEN, KEIN_NEUER, `rot: 1 Befunde in ${ORDNER}.`, "S1 gehört keinem Auftrag"];
  assert.deepEqual(versuche, [{ befunde: ohneAbdeckung }, { befunde: [OHNE_EMPFEHLUNG] }]);
  const [erster, zweiter] = prompts(datei("prompt-planung.txt"));
  const kopf = [GESTOPPT, "", `Phasendatei: ${PHASENDATEI}`, `Freigegebene Dokumente: ${ORDNER}/pitch.md, ${ORDNER}/sicherheit.md`, "Schon übernommen: keiner", "Die neuen Aufträge heißen a1-n1, a1-n2 und so weiter.", "", "## Auftrag", ""].join("\n");
  assert.ok(erster.startsWith(kopf), erster);
  assert.ok(erster.includes("\n## Verlauf\n\n```\nRunde 1: "), erster);
  assert.ok(erster.endsWith("> Ich finde keinen Weg im Bereich.\n```\n"), erster);
  const befunde = ["```", "", "", "## Befunde zu deinem vorigen Neuschnitt", "", "```", ...ohneAbdeckung, "```", "", "Die Phasendatei steht wieder wie vor diesem Neuschnitt.", "", ""].join("\n");
  assert.ok(zweiter.endsWith(`> Ich finde keinen Weg im Bereich.\n${befunde}`), zweiter);
  assert.ok(datei("prompt-notiz.txt").includes(["Neuschnitt 1: abgelehnt", ...ohneAbdeckung, "Neuschnitt 2: abgelehnt", OHNE_EMPFEHLUNG, "```"].join("\n")), datei("prompt-notiz.txt"));
});

test("eine Frage an den Nutzer ohne Leerzeichen nach den Doppelpunkten wird trotzdem zur Entscheidungsnotiz", (context) => {
  const drehbuch = { test: [TEST], bau: [OHNE_FIX], planung: [{ antwort: "Pitch ändern:Soll S1 wegfallen?\nEmpfehlung:Nein." }] };
  const { ergebnis, beleg, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.ok(beleg("a1").entscheidung.text.includes("\nPitch ändern: Soll S1 wegfallen?\nEmpfehlung: Nein.\n"), beleg("a1").entscheidung.text);
  assert.deepEqual([datei("anzahl-planung"), datei("anzahl-notiz")], ["1", ""]);
});

test("steigt der Bau-Agent nach einer roten Runde aus, sehen Planer und Notiz-Agent beide Runden und der Notiz-Agent den Anlass", (context) => {
  const grund = "Der Abnahmetest verlangt ein Verhalten, das der Entwurf ausschließt.";
  const ausstieg = `Auftrag passt nicht: ${grund}`;
  const drehbuch = { test: [TEST], bau: [OHNE_FIX, { antwort: ausstieg }], planung: [{ antwort: "Zerlegung passt nicht:Der Entwurf widerspricht dem Test." }], notiz: [{ antwort: "1. Entwurf prüfen" }] };
  const { ergebnis, datei } = lauf(context, drehbuch);
  assert.equal(ergebnis.status, EXIT_ROT);
  assert.deepEqual([datei("anzahl-planung"), datei("anzahl-notiz")], ["1", "1"]);
  assert.ok(datei("prompt-planung.txt").includes("\n## Verlauf\n\n```\nRunde 1: abnahme endete mit Exit 1."), datei("prompt-planung.txt"));
  const notiz = datei("prompt-notiz.txt");
  assert.ok(notiz.includes(`\nDer Agent ist ausgestiegen: ${ausstieg} Schreib eine Entscheidungsnotiz`), notiz);
  assert.ok(notiz.includes("\n## Verlauf\n\n```\nRunde 1: abnahme endete mit Exit 1."), notiz);
  assert.ok(notiz.includes(`\n${ausstieg}\nNeuschnitt 1: Zerlegung passt nicht: Der Entwurf widerspricht dem Test.\n\`\`\`\n`), notiz);
});

test("ein Planer, der im Stillstand abgebrochen wird oder mit einem Fehler endet, liefert genau diesen Grund als Befund", (context) => {
  const lesen = { type: "assistant", message: { content: [{ type: "tool_use", id: "w1", name: "Read", input: { file_path: "x" } }] } };
  const antwort = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "w1", content: "gleich" }] } };
  const { versuche } = ersterVersuch(context, [{ zeilen: [lesen, antwort, antwort, antwort] }, { exit: 3 }]);
  assert.deepEqual(versuche, [
    { befunde: ['Stillstand: Read lief dreimal mit derselben Eingabe und lieferte dasselbe Ergebnis: {"file_path":"x"}'] },
    { befunde: ["Der Planer endete mit Exit 3."] },
  ]);
});

test("ein Neuschnitt, der einen anderen Auftrag weglässt oder mehrere andere Dateien anlegt, wird abgelehnt", (context) => {
  const dateien = { [PHASENDATEI]: phase([funktion("a1"), umbau("a2")]) };
  const ohneA2 = { dateien: { [PHASENDATEI]: phase([funktion("a1-n1")]) } };
  const fremd = { dateien: { [PHASENDATEI]: phase([funktion("a1-n1"), umbau("a2")]), [`${ORDNER}/design.md`]: "# Design\n", "notiz.txt": "Notiz\n" } };
  const { versuche } = ersterVersuch(context, [ohneA2, fremd], { dateien });
  assert.deepEqual(versuche, [
    { befunde: ["a2 fehlt; ein Neuschnitt ersetzt nur a1."] },
    { befunde: [`Der Planer darf nur ${PHASENDATEI} ändern, nicht notiz.txt, ${ORDNER}/design.md.`] },
  ]);
});

test("ein Neuschnitt mit unlesbarer Phasendatei oder roter Abdeckungsprüfung wird mit genau diesen Befunden abgelehnt", (context) => {
  const anders = phase([funktion("a1-n1", { prueft: ["B1"], szenarien: { B1: S1 } })]);
  const { versuche } = ersterVersuch(context, [{ dateien: { [PHASENDATEI]: "{" } }, { dateien: { [PHASENDATEI]: anders } }]);
  const [unlesbar, abdeckung] = versuche;
  assert.equal(unlesbar.befunde.length, 1, unlesbar.befunde.join("\n"));
  assert.ok(unlesbar.befunde[0].startsWith(`${PHASENDATEI} ist nicht lesbar: `), unlesbar.befunde[0]);
  assert.deepEqual(abdeckung.befunde, [`rot: 2 Befunde in ${ORDNER}.`, "S1 gehört keinem Auftrag", "a1-n1: B1 steht weder in pitch.md noch unter „2. Angriffswege“ in sicherheit.md"]);
});

test("scheitert der Commit des Neuschnitts, wird er mit der Fehlerausgabe abgelehnt und zurückgesetzt", (context) => {
  const haken = probeDirectory(context, { "commit-msg": '#!/bin/sh\ncase "$(head -n 1 "$1")" in\n  Schneide*) echo "Neuschnitt abgelehnt" >&2; exit 1 ;;\nesac\n' });
  chmodSync(join(haken, "commit-msg"), AUSFUEHRBAR);
  const umgebung = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.hooksPath", GIT_CONFIG_VALUE_0: haken };
  const { versuche, git } = ersterVersuch(context, [NEUSCHNITT], { umgebung });
  assert.deepEqual(versuche.map(({ befunde }) => befunde), [["git commit des Neuschnitts endete mit Exit 1: Neuschnitt abgelehnt"], ["git commit des Neuschnitts endete mit Exit 1: Neuschnitt abgelehnt"]]);
  assert.equal(git("show", `HEAD:${PHASENDATEI}`), REPO[PHASENDATEI]);
  assert.equal(git("status", "--porcelain"), "");
});
