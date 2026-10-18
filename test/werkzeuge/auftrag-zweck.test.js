import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { GRUEN, ROT } from "../../tools/auftrag/bericht.mjs";
import { PHASE_PASST_NICHT, VERSTOSS, grenzBefunde } from "../../tools/auftrag/pruefungen.mjs";
import { fuehreRundenAus } from "../../tools/auftrag/runden.mjs";
import { GRUND, MELDUNG, PRUEFUNG, ohneZweck, zweckBlock, zweckIds } from "../../tools/auftrag/zweck.mjs";
import { BASIS, EXIT_ROT, UMBAU, starte } from "./auftrag-lauf-probe.js";
import { DESIGN, ersatzUmgebung, teamRepository } from "./neuschnitt-probe.js";
import { alsJson } from "./planung-probe.js";
import { ESLINT_BIN, PRUEFLEITER_TOOL, REPO_ROOT, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const ZWECK = JSON.parse(readFileSync(join(REPO_ROOT, "tools/auftrag/zweck.json"), "utf8"));
const FELDER = ["liste", "wozu", "behebung", "nichtAngenommen", "ausweg"];
const BLOCKFELDER = FELDER.filter((feld) => feld !== "liste");
const AUSSTIEGE = [
  "Auftrag passt nicht:",
  "Voraussetzung fehlt:",
  "Gleichwertig:",
  "Nötig:",
  "Alter Test hält altes Verhalten fest:",
  "Zerlegung passt nicht:",
  "Pitch ändern:",
  "Empfehlung:",
];
const ZU_VIELE_ZEILEN = 401;

function alleGrenzVerstoesse() {
  const auftrag = { bereich: "src/bereich.js", abnahme: "test/a.test.js", erwarteteDateien: ["test/hilfe.js"] };
  const muster = ["/src/geschuetzt.js"];
  const bau = grenzBefunde({ auftrag, rolle: "bau", muster }, [
    { pfad: "src/geschuetzt.js", zeilen: 1 },
    { pfad: "src/fremd.js", zeilen: ZU_VIELE_ZEILEN },
    { pfad: "test/b.test.js", zeilen: 1 },
  ]);
  const test = grenzBefunde({ auftrag, rolle: "test", muster }, [
    { pfad: "src/bereich.js", zeilen: 1 },
    { pfad: "test/fremd.test.js", zeilen: 1 },
    { pfad: "test/hilfe.js", zeilen: 1 },
  ]);
  return [...bau.verstoesse, ...test.verstoesse];
}

function erreichbareIds() {
  const zeilen = [...alleGrenzVerstoesse(), `${VERSTOSS}${PHASE_PASST_NICHT}`];
  const ausSchritten = Object.values(PRUEFUNG).flatMap((name) => zweckIds({ name, zeilen }));
  const allgemein = zweckIds({ name: PRUEFUNG.GRENZEN_BAU, zeilen: [] });
  return new Set([...ausSchritten, ...allgemein, ...Object.values(GRUND), ...Object.values(MELDUNG)]);
}

test("zweck.json hat für jede Prüfung des Auftragswegs alle Felder und keine ID, die der Code nicht kennt", () => {
  const ids = erreichbareIds();
  for (const id of ids) {
    const eintrag = ZWECK[id];
    assert.ok(eintrag, `zweck.json hat keinen Eintrag ${id}`);
    for (const feld of FELDER) assert.ok(typeof eintrag[feld] === "string" && eintrag[feld].trim() !== "", `${id}.${feld} ist leer`);
    assert.equal(zweckBlock(id).length, BLOCKFELDER.length, id);
  }
  assert.deepEqual(Object.keys(ZWECK).toSorted(), [...ids].toSorted());
  assert.throws(() => zweckBlock("gibt es nicht"), /gibt es nicht/);
});

test("kein Zweck-Text beginnt eine Zeile mit einer Ausstiegszeile, die das Skript als Antwort liest", () => {
  for (const [id, eintrag] of Object.entries(ZWECK)) {
    const zeilen = FELDER.flatMap((feld) => eintrag[feld].split("\n"));
    for (const zeile of [...zeilen, ...zweckBlock(id)]) {
      const treffer = AUSSTIEGE.find((praefix) => zeile.trimStart().startsWith(praefix));
      assert.equal(treffer, undefined, `${id}: ${zeile}`);
    }
  }
});

test("eine rote Grenzprüfung ohne erkannten Verstoß bekommt den allgemeinen Block der Grenzprüfung", () => {
  const zeilen = ["rot: 0 Dateien geändert, 0 neue Zeilen Produktcode, Rolle bau.", `${VERSTOSS}eine Art, die es noch nicht gibt`];
  assert.deepEqual(zweckIds({ name: PRUEFUNG.GRENZEN_BAU, zeilen }), ["grenzen"]);
  assert.deepEqual(zweckIds({ name: PRUEFUNG.GRENZEN_TEST, zeilen: [] }), ["grenzen"]);
});

test("jede Verstoßart der Grenzprüfung, auch eine nicht mehr passende Phasendatei, bekommt eine eigene ID mit Text", (context) => {
  const repo = probeRepository(context, { "phase.json": JSON.stringify({ phase: "probe", entwurf: {}, auftraege: [] }) });
  const lauf = runIn(repo, process.execPath, [join(REPO_ROOT, "tools/auftrag.mjs"), "grenzen", "phase.json", "A1", "--rolle", "bau", "--basis", "HEAD"]);
  assert.notEqual(lauf.status, 0);
  const meldungen = [...alleGrenzVerstoesse(), ...lauf.stdout.split("\n").filter((zeile) => zeile.startsWith(VERSTOSS))];
  const ids = meldungen.map((zeile) => zweckIds({ name: PRUEFUNG.GRENZEN_BAU, zeilen: [zeile] }));
  assert.ok(ids.every((liste) => liste.length === 1 && liste[0] !== "grenzen" && zweckBlock(liste[0]).length > 0), JSON.stringify({ meldungen, ids }));
  assert.equal(new Set(ids.flat()).size, meldungen.length, JSON.stringify(ids));
  assert.deepEqual(ids.at(-1), ["grenzen/phasendatei"]);
});

function ersteRundeRot(context, name) {
  const root = probeRepository(context, { "a.txt": "a\n" });
  const vorgeschichten = [];
  const runde = ({ vorgeschichte }) => {
    vorgeschichten.push(vorgeschichte);
    if (vorgeschichten.length > 1) return { ergebnis: GRUEN };
    return { ergebnis: ROT, runde: 1, grund: `${name} endete mit Exit 1.`, basis: "HEAD", agenten: [], pruefungen: [{ name, exitCode: 1, zeilen: ["Befund"] }] };
  };
  const kontext = { phase: { phase: "probe" }, auftrag: { id: "A1" }, root };
  return () => ({ ergebnis: fuehreRundenAus(kontext, runde), vorgeschichte: vorgeschichten.at(-1) });
}

test("eine rote Prüfung ohne Eintrag in zweck.json bricht die Fehlerausgabe laut ab, statt den Zweck wegzulassen", (context) => {
  const bekannt = ersteRundeRot(context, PRUEFUNG.LINT)();
  assert.equal(bekannt.ergebnis, GRUEN);
  assert.ok(bekannt.vorgeschichte.includes(`Befund\nWozu: ${ZWECK.lint.wozu}\n`), bekannt.vorgeschichte);
  assert.throws(ersteRundeRot(context, "neue prüfung"), /Kein Zweck-Text für die Prüfung neue prüfung/);
});

const LINT_ROT = {
  "lint.mjs": 'console.log("src/text.js\\n  2:14  error  Name zu kurz  id-length");\nprocess.exitCode = 1;\n',
  "package.json": BASIS["package.json"].replace('"lint":"node -e 0"', '"lint":"node lint.mjs"'),
};
const GEAENDERT = { "src/text.js": "export function gross(wort) {\n  return wort.toUpperCase();\n}\n" };
const AUSWEG_SCHLUSS = "Hältst du eine dieser Prüfungen hier für falsch";

function roterLauf(context, { auftrag, drehbuch, dateien }) {
  const { werkzeug, lauf } = starte(context, { auftrag, drehbuch, dateien });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  return (name) => readFileSync(join(werkzeug, name), "utf8");
}

function zweiteRunde(context, lauf) {
  return roterLauf(context, lauf)("prompt-bau.txt");
}

test("scheitert Runde 1 an lint, bekommt Runde 2 nach den Belegzeilen Zweck und Ausweg der Prüfung", (context) => {
  const prompt = zweiteRunde(context, { auftrag: UMBAU, drehbuch: { bau: GEAENDERT }, dateien: LINT_ROT });
  const teile = ["Fehlerausgabe der vorigen Runde", "\nlint:\n", "Name zu kurz", `\nWozu: ${ZWECK.lint.wozu}\n`, `\nAusweg: ${ZWECK.lint.ausweg}\n`, `\n${AUSWEG_SCHLUSS}`];
  const stellen = teile.map((teil) => prompt.indexOf(teil));
  assert.ok(stellen.every((stelle, index) => stelle > (stellen[index - 1] ?? -1)), prompt);
  assert.match(prompt, /wörtlich an den Planer oder an Antonio/);
});

const NUR_UMGEBAUT = {
  auftrag: {
    ...UMBAU,
    art: "funktion",
    bereich: "src/rechnen.js",
    erwarteteDateien: ["src/rechnen.js", "test/text.test.js", "test/rechnen.test.js"],
    abnahme: "test/rechnen.test.js",
    erwarteterFehler: "2 !== 4",
    wasDarfNiePassieren: { wiederholung: "-", gleichzeitig: "-", zeitueberschreitung: "-", abbruch: "-" },
  },
  drehbuch: {
    test: {
      "test/text.test.js": BASIS["test/text.test.js"].replace('"A"));', '"A", "gross"));'),
      "test/rechnen.test.js": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { verdopple } from "../src/rechnen.js";\ntest("verdoppelt", () => assert.equal(verdopple(2), 4));\n',
    },
  },
};

test("baut der Test-Agent einen geplanten Test nur um, bekommt seine Runde 2 nach den Belegzeilen den Zweck der geänderten Fälle", (context) => {
  const { werkzeug, lauf } = starte(context, NUR_UMGEBAUT);
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /Kein Zweck-Text/);
  const prompt = readFileSync(join(werkzeug, "prompt-test.txt"), "utf8");
  const eintrag = ZWECK[PRUEFUNG.GEAENDERTE_FAELLE];
  const teile = ["Fehlerausgabe der vorigen Runde", "\ngeänderte fälle:\n", "„gross“ ist gegen den unveränderten Produktcode grün", `\nWozu: ${eintrag?.wozu}\n`, `\nAusweg: ${eintrag?.ausweg}\n`, `\n${AUSWEG_SCHLUSS}`];
  const stellen = teile.map((teil) => prompt.indexOf(teil));
  assert.ok(stellen.every((stelle, index) => stelle > (stellen[index - 1] ?? -1)), prompt);
});

test("nach zwei roten Runden nennt der Prompt des Notiz-Agenten den Zweck des Stopps", (context) => {
  const notiz = roterLauf(context, { auftrag: UMBAU, drehbuch: { bau: GEAENDERT }, dateien: LINT_ROT })("prompt-notiz.txt");
  assert.ok(notiz.includes(`\nWozu: ${ZWECK.stopp.wozu}\nEchte Behebung: ${ZWECK.stopp.behebung}\n`), notiz);
});

test("ändert der Bau-Agent nichts, bekommt Runde 2 den Zweck von keine änderung, obwohl kein Prüfschritt rot ist", (context) => {
  const prompt = zweiteRunde(context, { auftrag: UMBAU, drehbuch: { bau: {} } });
  const stellen = [`\nWozu: ${ZWECK["keine änderung"].wozu}\n`, `\nAusweg: ${ZWECK["keine änderung"].ausweg}\n`, `\n${AUSWEG_SCHLUSS}`].map((teil) => prompt.indexOf(teil));
  assert.ok(stellen.every((stelle, index) => stelle > (stellen[index - 1] ?? -1)), prompt);
});

test("ein Bau außerhalb des Bereichs und an einer geschützten Datei bekommt genau die Blöcke dieser beiden Grenzen", (context) => {
  const auftrag = { ...UMBAU, bereich: "src/text.js", erwarteteDateien: ["src/text.js"] };
  const bau = { "src/app.js": "export const NEU = 1;\n", "src/geschuetzt.js": "export const WERT = 2;\n" };
  const prompt = zweiteRunde(context, { auftrag, drehbuch: { bau } });
  const ids = ["grenzen/bereich", "grenzen/geschützt", "grenzen/zeilen", "grenzen/test-im-bau", "grenzen/produkt-im-test", "grenzen/fremder-test", "grenzen"];
  const gezeigt = ids.map((id) => prompt.includes(`Wozu: ${ZWECK[id].wozu}`));
  assert.deepEqual(gezeigt, [true, true, false, false, false, false, false], prompt);
});

test("macht der Bau die Phasendatei ungültig, bleibt Runde 1 eine belegte rote Runde und Runde 2 bekommt den Block der Phasendatei", (context) => {
  const bau = { ".github/CODEOWNERS": "/src/geschuetzt.js @probe\n/src/ @probe\n" };
  const { werkzeug, lauf, beleg } = starte(context, { auftrag: UMBAU, drehbuch: { bau } });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  assert.doesNotMatch(lauf.stderr, /Abbruch/);
  assert.match(beleg.runden[0], /^Runde 1: grenzen bau endete mit Exit 1\./);
  const prompt = readFileSync(join(werkzeug, "prompt-bau.txt"), "utf8");
  assert.ok(prompt.includes(`\nWozu: ${ZWECK["grenzen/phasendatei"].wozu}\n`), prompt);
});

test("fällt der Zeilen-Verstoß aus den gekürzten Belegzeilen, bekommt Runde 2 trotzdem den Block der Zeilengrenze", (context) => {
  const auftrag = { ...UMBAU, bereich: "src/text.js", erwarteteDateien: ["src/text.js"] };
  const viele = Array.from({ length: 21 }, (_, nummer) => [`src/fremd-${nummer}.js`, "export const WERT = 1;\n".repeat(nummer === 0 ? ZU_VIELE_ZEILEN : 1)]);
  const prompt = zweiteRunde(context, { auftrag, drehbuch: { bau: Object.fromEntries(viele) } });
  assert.doesNotMatch(prompt, /Verstoß: \d+ neue Zeilen Produktcode/);
  const gezeigt = ["grenzen/zeilen", "grenzen/bereich"].map((id) => prompt.includes(`Wozu: ${ZWECK[id].wozu}`));
  assert.deepEqual(gezeigt, [true, true], prompt);
});

test("ein roter Prüfleiter nennt seinen Zweck auf stderr, stdout behält nur die Befunde", (context) => {
  const repo = probeRepository(context, {
    "package.json": JSON.stringify({ type: "module", scripts: { lint: `node ${JSON.stringify(ESLINT_BIN)} .` } }),
    "eslint.config.js": 'export default [{ rules: { "no-debugger": "error" } }];\n',
    "src/basis.js": "debugger;\n",
  });
  const lauf = runIn(repo, process.execPath, [PRUEFLEITER_TOOL, "--basis", "HEAD"]);
  assert.notEqual(lauf.status, 0);
  assert.equal(lauf.stderr, `${zweckBlock(MELDUNG.PRUEFLEITER).join("\n")}\n`);
  assert.match(lauf.stdout, /src\/basis\.js:1/);
  assert.doesNotMatch(lauf.stdout, /Wozu: /);
});

const UEBERLEBT_IMMER = 'if (!process.argv.includes("--alter-stand")) process.exitCode = 1;\nconsole.log(process.exitCode ? "Verstoß: Mutant überlebt: src/text.js:2:10 MethodExpression → text" : "grün: keiner überlebt");\n';
const MIT_MUTATION = {
  "mutation.mjs": UEBERLEBT_IMMER,
  "package.json": BASIS["package.json"].replace('"lint"', '"test:mutation":"node mutation.mjs","lint"'),
};
const STREICHEN = /^Streich.*$/m;

test("die Bau-Nachrunde nennt den Zweck der Mutation und erst Nötig, dann Streichen nur unter der Bedingung gleicher Ergebnisse", (context) => {
  const { werkzeug } = starte(context, { auftrag: UMBAU, drehbuch: { bau: GEAENDERT }, dateien: MIT_MUTATION });
  const prompt = readFileSync(join(werkzeug, "prompt-bau-nachrunde.txt"), "utf8");
  assert.ok(prompt.includes(`\nWozu: ${ZWECK.mutation.wozu}\n`), prompt);
  const streichen = STREICHEN.exec(prompt);
  assert.ok(streichen?.[0].includes("jede Eingabe, auch Fehlerfall und leerer Wert"), prompt);
  const noetig = prompt.indexOf("\nNötig: <Mutant>");
  assert.ok(noetig !== -1 && noetig < streichen.index, prompt);
});

test("abdeckung-pruefen nennt bei Befunden den Zweck auf stdout, stderr bleibt die Befundliste, der Neuschnitt filtert den Block heraus", (context) => {
  const ordner = "P-001-probe";
  const wurzel = probeDirectory(context, { [`${ordner}/pitch.md`]: "# P-001\n", [`${ordner}/sicherheit.md`]: "# P-001\n", [`${ordner}/phase.json`]: "{" });
  const lauf = runIn(wurzel, process.execPath, [join(REPO_ROOT, "tools/abdeckung-pruefen.mjs"), ordner]);
  assert.equal(lauf.status, EXIT_ROT, lauf.stderr);
  assert.match(lauf.stderr, /^phase\.json ist nicht lesbar: [^\n]+\n$/);
  const block = zweckBlock(MELDUNG.ABDECKUNG);
  assert.ok(lauf.stdout.includes(`rot: 1 Befunde in ${ordner}.\n${block.join("\n")}\n`), lauf.stdout);
  const ausgabe = `${lauf.stdout}\n${lauf.stderr}`.split("\n").filter((zeile) => zeile.trim() !== "");
  assert.deepEqual(ohneZweck(ausgabe), [`rot: 1 Befunde in ${ordner}.`, lauf.stderr.trim()]);
});

const EXIT_SCHNITT_BEFUNDE = 4;

test("die Schnittprüfung nennt bei Befunden den Zweck nach der roten Zeile, die Befunde bleiben auf stderr", (context) => {
  const ordner = "P-001-probe";
  const wurzel = probeRepository(context, {
    "tools/bereiche.json": readFileSync(join(REPO_ROOT, "tools/bereiche.json"), "utf8"),
    [`${ordner}/pitch.md`]: "# P-001\n\n## Szenario S1: Anruf\nWenn x\nDann y\n",
    [`${ordner}/sicherheit.md`]: "# P-001\n\n## 2. Angriffswege\n\nkeine Angriffswege gefunden\n",
  });
  mkdirSync(join(wurzel, ordner, "planung"));
  writeFileSync(join(wurzel, ordner, "planung/schnitt.json"), JSON.stringify({ annahmen: [], fehlendeSzenarien: [], ownerAufgaben: [], gemeinsameNamen: [], auftraege: [] }));
  const lauf = runIn(wurzel, process.execPath, [join(REPO_ROOT, "tools/auftrag.mjs"), "schnitt", ordner]);
  assert.equal(lauf.status, EXIT_SCHNITT_BEFUNDE, lauf.stderr + lauf.stdout);
  const block = zweckBlock(MELDUNG.SCHNITT).join("\n");
  assert.ok(lauf.stdout.endsWith(`${block}\n`), lauf.stdout);
  assert.match(lauf.stdout.slice(0, -(block.length + 1)), /(?:^|\n)rot: \d+ Befunde in [^\n]+\n$/);
  assert.doesNotMatch(lauf.stderr, /Wozu: /);
});

const PLAN = "plaene/P-001-probe";
const PLAN_PHASE = `${PLAN}/phase.json`;
const S1 = "Gegeben die Zahl 2\nWenn ein Agent `verdopple` mit 2 aufruft\nDann ist die Antwort `4`";
const UMBAU_AUSWEG = "keiner, weil Umbau: bestehende Tests bleiben unverändert grün";
const KEIN_WEG = { antwort: "Ich finde keinen Weg." };
const NUR_UMBAU = {
  phase: "P-001-probe",
  issue: 54,
  entwurf: { "src/text.js": "Entwurf." },
  auftraege: [{ ...UMBAU, id: "a2", bereich: "src/text.js", prueft: UMBAU_AUSWEG }],
};
const OHNE_ABDECKUNG = alsJson({
  schnitt: { annahmen: [], fehlendeSzenarien: [], ownerAufgaben: [], gemeinsameNamen: [], auftraege: [{ ...NUR_UMBAU.auftraege[0], id: "a2-n1", abhaengigVon: [] }] },
  aenderung: "a2 wird als kleinerer Umbau neu geschnitten.",
});
const TEXT_ENTWURF = alsJson({ entwurf: "Grundlage: pitch.md, Anforderungen\ngross bleibt, wie es ist.\nFehlerfälle: keine" });
const TEAM_OHNE_ABDECKUNG = { test: [KEIN_WEG], bau: [KEIN_WEG], notiz: [KEIN_WEG], planer: [{ antwort: OHNE_ABDECKUNG }], "pruefer-planung": [{ pruefliste: true }], entwurf: [{ antwort: TEXT_ENTWURF }] };

function abschnittAus(text, titel) {
  const anfang = text.indexOf(`\n## ${titel}\n`);
  assert.notEqual(anfang, -1, text);
  const ende = text.indexOf("\n## ", anfang + 1);
  return text.slice(anfang, ende === -1 ? undefined : ende);
}

test("scheitert ein Neuschnitt an Schnitt und Abdeckung, nennt der nächste Prompt beide Zwecke je einmal und die Befunde ohne Zweck-Zeilen", (context) => {
  const repo = teamRepository(context, {
    ...BASIS,
    [`${PLAN}/pitch.md`]: `# P-001 Probe\n\n## Anforderungen\n\n### Regel R1: Zahlen werden verdoppelt.\n\n#### Szenario S1: Verdoppeln\n${S1}\n`,
    [`${PLAN}/sicherheit.md`]: "# P-001 Probe\n\n## 2. Angriffswege\nKeine Angriffswege gefunden, weil nichts Neues erreichbar ist.\n",
    [`${PLAN}/design.md`]: DESIGN,
    [PLAN_PHASE]: `${JSON.stringify(NUR_UMBAU, null, 2)}\n`,
  });
  const { werkzeug, env: umgebung } = ersatzUmgebung(context, TEAM_OHNE_ABDECKUNG);
  const lauf = spawnSync(process.execPath, [join(REPO_ROOT, "tools/auftrag.mjs"), "lauf", PLAN_PHASE], { cwd: repo, encoding: "utf8", env: umgebung });
  assert.equal(lauf.status, EXIT_ROT, lauf.stdout + lauf.stderr);
  const zweiter = readFileSync(join(werkzeug, "prompt-planer.txt"), "utf8").split("\n## Neuschnitt\n").at(-1);
  const zweck = abschnittAus(zweiter, "Wozu die Prüfungen da sind");
  for (const id of [MELDUNG.NEUSCHNITT, MELDUNG.ABDECKUNG]) {
    assert.equal(zweck.split(zweckBlock(id).join("\n")).length - 1, 1, `${id}\n${zweiter}`);
  }
  const befunde = abschnittAus(zweiter, "Befunde zu deinem vorigen Neuschnitt");
  assert.match(befunde, /S1 gehört keinem Auftrag/);
  assert.doesNotMatch(befunde, /^Wozu: /m);
});

const UNGUELTIG = { "phase.json": "{" };

test("pruefe nennt bei einer ungültigen Phasendatei nach der roten Zeile den Zweck der Phasendatei", (context) => {
  const repo = probeRepository(context, UNGUELTIG);
  const lauf = runIn(repo, process.execPath, [join(REPO_ROOT, "tools/auftrag.mjs"), "pruefe", "phase.json"]);
  assert.equal(lauf.status, EXIT_ROT, lauf.stderr);
  const block = zweckBlock(MELDUNG.PHASENDATEI).join("\n");
  assert.ok(lauf.stdout.endsWith(`\n${block}\n`), lauf.stdout);
  assert.match(lauf.stdout.slice(0, -(block.length + 1)), /^rot: \d+ Befunde in phase\.json\.\n$/);
});

test("lauf endet bei einer ungültigen Phasendatei auf stderr mit dem Zweck der Phasendatei", (context) => {
  const repo = probeRepository(context, UNGUELTIG);
  const lauf = runIn(repo, process.execPath, [join(REPO_ROOT, "tools/auftrag.mjs"), "lauf", "phase.json"]);
  assert.equal(lauf.status, EXIT_ROT, lauf.stderr);
  const block = `${zweckBlock(MELDUNG.PHASENDATEI).join("\n")}\n`;
  assert.ok(lauf.stderr.endsWith(block) && lauf.stderr.length > block.length, lauf.stderr);
});
