import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { UMBAU_AUSWEG } from "../../tools/auftrag/format.mjs";
import { fortsetzungen } from "../../tools/auftrag/planung/messung.mjs";
import { REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository, runIn } from "./probe-repo.js";

const AUFTRAG = join(REPO_ROOT, "tools/auftrag.mjs");
const SKILL = join(REPO_ROOT, ".claude/skills/pitch");
const KOPIEN = { "beispiel.md": "pitch.md", "design-beispiel.md": "design.md", "sicherheit-beispiel.md": "sicherheit.md" };
const TEAM_DATEIEN = [".claude/agents/planer.md", ".claude/agents/erkunder.md", ".claude/agents/pruefer-planung.md", ".claude/agents/entwurf.md", ".claude/skills/pitch/phase-vorlage.md"];
const KENNUNG = "P-001-eigene-nummer";
const ORDNER = `plaene/${KENNUNG}`;
const ROUTE = "src/routes/api-onboard.js";
const HINWEIS = "src/callee-is-owner.js";
const BESTEHENDER_TEST = "test/anrufe/anrufreserve.test.js";
const FUNDSTELLE = `${ROUTE}:1`;
const LOESUNG = "## Lösung";
const EXIT_GRUEN = 0;
const EXIT_ABBRUCH = 1;
const EXIT_AUFRUF = 2;
const EXIT_PASST_NICHT = 3;
const EXIT_BEFUNDE = 4;
const ABSTURZ_EXIT = 3;
const ABSTURZ_FEHLER = "Error: spawn claude ENOENT";
const LAUF_FRIST_MS = 240_000;
const WARTEN_MS = 1500;
const AUSFUEHRBAR = 0o755;

const ROUTE_QUELLE = `export function registriere(router) {
  router.post("/api/self-service/private-number", function hinterlege(anfrage) {
    return anfrage;
  });
  router.post("/api/self-service/private-number/confirm", function bestaetige(anfrage) {
    return anfrage;
  });
}

export function speichereStatus(status) {
  const werkzeug = "place_call";
  const kopie = { status, werkzeug };
  return kopie;
}
`;
const HINWEIS_QUELLE = `export function nimmAnruf(nummer) {
  const werkzeug = "place_call";
  return { werkzeug, nummer };
}

export function setzeHinweis(nummer) {
  const text = nummer;
  return text;
}
`;
const BEREICHE = [
  ["nummern", "^src/routes/"],
  ["anrufe", "^src/callee-is-owner\\.js$"],
].map(([bereich, muster]) => ({ bereich, quellen: [muster], eingaenge: [], fachlogik: [] }));
const PROBE_QUELLEN = {
  [ROUTE]: ROUTE_QUELLE,
  [HINWEIS]: HINWEIS_QUELLE,
  [BESTEHENDER_TEST]: `import { nimmAnruf } from "../../${HINWEIS}";\n\nnimmAnruf("x");\n`,
  "tools/bereiche.json": JSON.stringify(BEREICHE),
  ".github/CODEOWNERS": "/src/geschuetzt.js @owner\n",
  "CLAUDE.md": "# Probe\n",
  "eslint.config.js": 'export default [{ rules: { "no-var": "error" } }];\n',
  "package.json": JSON.stringify({ type: "module" }),
  ".gitignore": "node_modules\n.fortschritt/\n",
};
const GRUPPEN = [
  { nummern: ["S1", "S7", "T2"], eingang: "POST /api/self-service/private-number", ueberschriften: [LOESUNG], fragen: ["Wo wird die Nummer gespeichert?"] },
  { nummern: ["S2", "S3", "S6", "T1"], eingang: "POST /api/self-service/private-number/confirm", ueberschriften: [LOESUNG], fragen: [] },
  { nummern: ["S4", "S5", "B1"], eingang: "place_call", ueberschriften: ["## Fehlerfälle"], fragen: [] },
];
const ANRUF_NUMMERN = new Set(GRUPPEN[2].nummern);

const ERSATZ_CLAUDE = `#!${process.execPath}
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
const ort = dirname(process.argv[1]);
const argumente = process.argv.slice(2);
const wert = (schalter) => { const stelle = argumente.indexOf(schalter); return stelle === -1 ? undefined : argumente[stelle + 1]; };
const agent = wert("--agent");
const resume = wert("--resume");
const eingabe = readFileSync(0, "utf8");
const ueberschrift = eingabe.split("\\n")[0];
const merkmal = /^#### (\\S+) \\(/m.exec(eingabe)?.[1] ?? /^### Bereich\\n\\n(.+)$/m.exec(eingabe)?.[1] ?? "";
const marke = "### Zeilen deiner Prüfliste";
const sitzungsListe = join(ort, "pruefliste-" + String(resume ?? wert("--session-id")).replace(/[^A-Za-z0-9-]/g, "_") + ".txt");
if (eingabe.includes(marke) && !existsSync(sitzungsListe)) writeFileSync(sitzungsListe, eingabe);
const antworten = JSON.parse(readFileSync(join(ort, "antworten.json"), "utf8"));
const schluessel = antworten[agent + "|" + ueberschrift + "|" + merkmal] ? agent + "|" + ueberschrift + "|" + merkmal : agent + "|" + ueberschrift;
const folge = antworten[schluessel] ?? [];
let stelle = 0;
for (;;) { try { mkdirSync(join(ort, "zug-" + schluessel.replace(/[^A-Za-z0-9]/g, "_") + "-" + stelle)); break; } catch { stelle += 1; } }
const start = Date.now();
const eintrag = folge[stelle];
const art = typeof eintrag === "object" && eintrag !== null ? eintrag : { text: eintrag };
if (art.warte) await new Promise((fertig) => setTimeout(fertig, art.warte));
if (art.schreibe) writeFileSync(join(process.cwd(), art.schreibe), "geändert\\n");
appendFileSync(join(ort, "protokoll.jsonl"), JSON.stringify({ agent, sitzung: resume ?? wert("--session-id"), resume: resume !== undefined, ueberschrift, eingabe, start, ende: Date.now() }) + "\\n");
const melde = (zeile) => process.stdout.write(JSON.stringify(zeile) + "\\n");
if (eintrag === undefined) { process.stderr.write("keine weitere Antwort für " + schluessel); process.exit(1); }
if (art.absturz) { process.stderr.write(art.absturz.fehler); process.exit(art.absturz.exit); }
if (art.limit) {
  melde({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: Math.ceil(Date.now() / 1000) + 1 } });
  melde({ type: "result", is_error: true, result: "limit reached" });
  process.exit(1);
}
let text = art.text;
if (art.pruefliste) {
  const quelle = eingabe.includes(marke) ? eingabe : readFileSync(sitzungsListe, "utf8");
  const zeilen = quelle.split(marke)[1].split("\\n").filter((zeile) => zeile.startsWith("- ")).map((zeile) => zeile.slice(2));
  const liste = zeilen.filter((schluessel) => !(art.weglassen ?? []).includes(schluessel)).map((schluessel) => art.befunde?.[schluessel]
    ? { schluessel, ergebnis: "befund", befund: art.befunde[schluessel], fundstelle: art.fundstelle }
    : { schluessel, ergebnis: "erfüllt", fundstelle: art.fundstelle });
  text = "Geprüft.\\n\\n\`\`\`json\\n" + JSON.stringify({ pruefliste: liste }) + "\\n\`\`\`";
}
melde({ type: "assistant", message: { id: "m" + start, content: [{ type: "text", text }], usage: { input_tokens: 1 } } });
melde({ type: "result", result: text });
`;

function alsJson(wert) {
  return `Antwort.\n\n\`\`\`json\n${JSON.stringify(wert, null, 2)}\n\`\`\``;
}

function stelle(rolle, datei, ort) {
  return { rolle, datei, ...ort };
}

function angabenVon(nummer) {
  const anruf = ANRUF_NUMMERN.has(nummer);
  const eingang = anruf ? stelle("eingang", HINWEIS, { funktion: "nimmAnruf", von: 1, bis: 4 }) : stelle("eingang", ROUTE, GRUPPEN[0].nummern.includes(nummer) ? { funktion: "hinterlege", von: 2, bis: 4 } : { funktion: "bestaetige", von: 5, bis: 7 });
  const wirkung = anruf ? stelle("wirkung", HINWEIS, { funktion: "setzeHinweis", von: 6, bis: 9 }) : stelle("wirkung", ROUTE, { funktion: "speichereStatus", von: 10, bis: 14 });
  const { rolle, ...aenderung } = wirkung;
  return {
    weg: [eingang, wirkung],
    aenderungen: [{ ...aenderung, neueZeilen: 3 }],
    tests: [BESTEHENDER_TEST],
    vorbild: wirkung.datei,
    schema: { aenderung: false, fundstelle: `${wirkung.datei} Zeile 1` },
    codeowners: [],
    ownerEntscheidung: "keine, weil keine geschützte Datei betroffen ist",
    eingangImTest: "erreichbar",
    widersprueche: [],
    rolle,
  };
}

function angaben(nummer, ueberschrieben = {}) {
  const { rolle, ...rest } = angabenVon(nummer);
  return rolle === "wirkung" ? { ...rest, ...ueberschrieben } : rest;
}

function bericht(nummern, ueberschrieben = {}) {
  return alsJson({ nummern: Object.fromEntries(nummern.map((nummer) => [nummer, angaben(nummer, ueberschrieben[nummer])])), hinweise: [] });
}

function auftrag(id, bereich, { prueft, abnahme, abhaengigVon, ...zusatz }) {
  return { id, art: "funktion", ziel: `Ziel ${id}`, bereich, erwarteteDateien: [bereich, abnahme], vorbild: bereich, abnahme, erwarteterFehler: "bestaetigt", wasDarfNiePassieren: [], prueft, abhaengigVon, eingang: "erreicht", ...zusatz };
}

const UMBAU = { id: "a0", art: "umbau", ziel: "Zieh die Prüfung heraus", bereich: HINWEIS, abnahme: BESTEHENDER_TEST, vorbild: HINWEIS, prueft: UMBAU_AUSWEG, erwarteteDateien: [HINWEIS, BESTEHENDER_TEST], altfunktionen: [], abhaengigVon: [] };

function schnittliste({ umbau = {}, erster = {}, ...oben } = {}) {
  return {
    annahmen: [],
    fehlendeSzenarien: [],
    ownerAufgaben: [],
    gemeinsameNamen: [{ name: "bestaetigt", anbieter: ROUTE, nutzer: HINWEIS }],
    auftraege: [
      { ...UMBAU, ...umbau },
      auftrag("a1", ROUTE, { prueft: ["S1", "S7", "T2"], abnahme: "test/nummern/eigene-nummer-hinterlegen.test.js", abhaengigVon: [], ...erster }),
      auftrag("a2", ROUTE, { prueft: ["S2", "S3", "S6", "T1"], abnahme: "test/nummern/eigene-nummer-bestaetigen.test.js", abhaengigVon: [{ id: "a1", grund: "braucht den gespeicherten Code" }] }),
      auftrag("a3", HINWEIS, { prueft: ["S4", "S5", "B1"], abnahme: "test/anrufe/hinweis-eigene-nummer.test.js", abhaengigVon: [{ id: "a2", grund: "liest den Status bestaetigt" }, { id: "a0", grund: "nutzt die herausgezogene Prüfung" }] }),
    ],
    ...oben,
  };
}

const ENTWURF_ROUTE = alsJson({ entwurf: "Grundlage: design.md, Lösung\nStatus `bestaetigt` setzen.\nFehlerfälle: SMS-Fehler: Status bleibt" });
const ENTWURF_HINWEIS = alsJson({ entwurf: "Grundlage: design.md, Lösung\nliest bestaetigt\nFehlerfälle: keine" });
const GRUEN_PRUEFLISTE = { pruefliste: true, fundstelle: FUNDSTELLE };
const NACHFRAGEN_JE_FALL = 1;
const WEGPRUEFUNGEN = GRUPPEN.length + NACHFRAGEN_JE_FALL;

function antworten(ueberschrieben = {}) {
  return {
    "planer|## Gliederung": [alsJson({ gruppen: GRUPPEN })],
    "erkunder|## Erkundung|S1": [bericht(GRUPPEN[0].nummern)],
    "erkunder|## Erkundung|S2": [bericht(GRUPPEN[1].nummern)],
    "erkunder|## Erkundung|S4": [bericht(GRUPPEN[2].nummern)],
    "planer|## Zuschnitt": [alsJson({ schnitt: schnittliste() })],
    "pruefer-planung|## Wegprüfung": Array.from({ length: WEGPRUEFUNGEN }, () => GRUEN_PRUEFLISTE),
    "pruefer-planung|## Prüfung": jePruefer(GRUEN_PRUEFLISTE),
    "pruefer-planung|## Nachprüfung": [GRUEN_PRUEFLISTE],
    [`entwurf|## Entwurf|${ROUTE}`]: [ENTWURF_ROUTE],
    [`entwurf|## Entwurf|${HINWEIS}`]: [ENTWURF_HINWEIS],
    ...ueberschrieben,
  };
}

function planOrdner(context) {
  const wurzel = probeRepository(context, PROBE_QUELLEN);
  symlinkSync(join(REPO_ROOT, "node_modules"), join(wurzel, "node_modules"));
  const ordner = join(wurzel, ORDNER);
  mkdirSync(ordner, { recursive: true });
  for (const [quelle, ziel] of Object.entries(KOPIEN)) copyFileSync(join(SKILL, quelle), join(ordner, ziel));
  for (const pfad of TEAM_DATEIEN) {
    mkdirSync(dirname(join(wurzel, pfad)), { recursive: true });
    copyFileSync(join(REPO_ROOT, pfad), join(wurzel, pfad));
  }
  return wurzel;
}

function plane(context, ueberschrieben = {}, argumente = [ORDNER]) {
  const wurzel = planOrdner(context);
  const ersatz = probeDirectory(context, { "antworten.json": JSON.stringify(antworten(ueberschrieben)) });
  writeFileSync(join(ersatz, "claude.mjs"), ERSATZ_CLAUDE);
  chmodSync(join(ersatz, "claude.mjs"), AUSFUEHRBAR);
  const lauf = spawnSync(process.execPath, [AUFTRAG, "plane", ...argumente], { cwd: wurzel, encoding: "utf8", env: { ...isolatedEnvironment(), HERMES_CLAUDE: join(ersatz, "claude.mjs") }, timeout: LAUF_FRIST_MS });
  return { ...lauf, wurzel, ersatz };
}

function protokoll({ ersatz }) {
  const datei = join(ersatz, "protokoll.jsonl");
  return existsSync(datei) ? readFileSync(datei, "utf8").trim().split("\n").map((zeile) => JSON.parse(zeile)) : [];
}

function aufrufe(lauf, agent, ueberschrift) {
  return protokoll(lauf).filter((eintrag) => eintrag.agent === agent && (ueberschrift === undefined || eintrag.ueberschrift === ueberschrift));
}

function phaseDatei({ wurzel }) {
  return join(wurzel, ORDNER, "phase.json");
}

function planungsBericht({ wurzel }) {
  return JSON.parse(readFileSync(join(wurzel, ".fortschritt", KENNUNG, "planung.json"), "utf8"));
}

function werkzeug({ wurzel }, ...argumente) {
  return runIn(wurzel, process.execPath, argumente);
}

function exit(lauf, erwartet) {
  assert.equal(lauf.status, erwartet, `${lauf.stdout}\n${lauf.stderr}`);
}

test("plane: feste Antworten aller Rollen ergeben Exit 0 und eine phase.json, die pruefe und die Abdeckungsprüfung grün melden", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context);
  exit(lauf, EXIT_GRUEN);
  assert.equal(werkzeug(lauf, AUFTRAG, "pruefe", phaseDatei(lauf)).status, EXIT_GRUEN);
  assert.equal(werkzeug(lauf, join(REPO_ROOT, "tools/abdeckung-pruefen.mjs"), join(lauf.wurzel, ORDNER)).status, EXIT_GRUEN);
  assert.deepEqual(readdirSync(join(lauf.wurzel, ORDNER, "planung")).toSorted(), ["entwuerfe.json", "erkundung-g1.json", "erkundung-g2.json", "erkundung-g3.json", "gliederung.json", "pruefliste-aufteilung.json", "pruefliste.json", "schnitt.json", "wegpruefung-S1-1.json", "wegpruefung-S2-1.json", "wegpruefung-S4-1.json"]);
  assert.deepEqual(planungsBericht(lauf).auftraege.map(({ id }) => id), ["a0", "a1", "a2", "a3"]);
});

test("plane: „Zerlegung passt nicht“ mit gültigen Fundstellen endet mit Exit 3 ohne phase.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const zeile = `Zerlegung passt nicht: Dann widerspricht der Lösung (Fundstellen: pitch.md, ## Problem; design.md, ${LOESUNG})`;
  const lauf = plane(context, { "planer|## Gliederung": [zeile] });
  exit(lauf, EXIT_PASST_NICHT);
  assert.equal(existsSync(phaseDatei(lauf)), false);
  assert.equal(planungsBericht(lauf).grund, zeile);
});

test("plane: „Zerlegung passt nicht“ ohne gültige Fundstellen geht einmal an den Planer zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  const ungueltig = "Zerlegung passt nicht: passt nicht (Fundstellen: pitch.md, ## Gibt es nicht; src/fehlt.js:3)";
  const lauf = plane(context, { "planer|## Gliederung": [ungueltig], "planer|## Befunde": [alsJson({ gruppen: GRUPPEN })] });
  exit(lauf, EXIT_GRUEN);
  const [rueckgabe] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(rueckgabe.eingabe.includes("src/fehlt.js ist keine Datei im Repo"));
});

test("plane: eine Gliederung mit doppelter Nummer geht einmal an den Planer zurück, danach wird grün geplant", { timeout: LAUF_FRIST_MS }, (context) => {
  const doppelt = [{ ...GRUPPEN[0], nummern: ["S1", "S7", "T2", "S4"] }, GRUPPEN[1], GRUPPEN[2]];
  const lauf = plane(context, { "planer|## Gliederung": [alsJson({ gruppen: doppelt })], "planer|## Befunde": [alsJson({ gruppen: GRUPPEN })] });
  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "planer", "## Befunde").length, 1);
  assert.ok(aufrufe(lauf, "planer", "## Befunde")[0].eingabe.includes("S4 steht in 2 Gruppen statt in genau einer"));
});

test("plane: ein Erkunderbericht mit erfundener Funktion geht genau einmal an den Erkunder zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  const erfunden = bericht(GRUPPEN[0].nummern, { S1: { aenderungen: [{ datei: ROUTE, funktion: "gibtEsNicht", von: 10, bis: 14, neueZeilen: 3 }] } });
  const lauf = plane(context, { "erkunder|## Erkundung|S1": [erfunden], "erkunder|## Befunde": [bericht(GRUPPEN[0].nummern)] });
  exit(lauf, EXIT_GRUEN);
  const rueckgaben = aufrufe(lauf, "erkunder", "## Befunde");
  assert.equal(rueckgaben.length, 1);
  assert.ok(rueckgaben[0].eingabe.includes("Funktion gibtEsNicht fehlt in"));
  assert.equal(planungsBericht(lauf).ruecksendungen.erkunder, 1);
});

test("plane: ein Erkunderbericht, der seinen Befund behält, endet mit Exit 4 ohne phase.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const erfunden = bericht(GRUPPEN[0].nummern, { S1: { aenderungen: [{ datei: ROUTE, funktion: "gibtEsNicht", von: 10, bis: 14, neueZeilen: 3 }] } });
  const schnitt = alsJson({ schnitt: schnittliste(), antworten: [] });
  const lauf = plane(context, { "erkunder|## Erkundung|S1": [erfunden], "erkunder|## Befunde": [erfunden], "planer|## Befunde": [schnitt] });
  exit(lauf, EXIT_BEFUNDE);
  assert.equal(existsSync(phaseDatei(lauf)), false);
  assert.ok(aufrufe(lauf, "planer", "## Zuschnitt")[0].eingabe.includes("Funktion gibtEsNicht fehlt in"));
  assert.ok(planungsBericht(lauf).befunde.offen.some((befund) => befund.includes("Regel Erkundung")));
});

test("plane: eine Nachfrage ohne neue Stelle beendet die Nachfragen zu ihren Nummern", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, {
    "planer|## Zuschnitt": [alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo liegt der Hinweis?" }] }), alsJson({ schnitt: schnittliste() })],
    "erkunder|## Nachfrage|S4": [bericht(["S4"])],
  });
  exit(lauf, EXIT_GRUEN);
  const [nachfrage] = aufrufe(lauf, "erkunder", "## Nachfrage");
  assert.ok(nachfrage.eingabe.includes("Wo liegt der Hinweis?"));
  assert.equal(nachfrage.resume, false);
  assert.ok(aufrufe(lauf, "planer", "## Zuschnitt")[1].eingabe.includes("Nachfragen zu S4 enden; schneide mit einer Annahme."));
});

test("plane: eine erneute Nachfrage zu ausgeschöpften Nummern endet mit Exit 4", { timeout: LAUF_FRIST_MS }, (context) => {
  const nachfrage = alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo liegt der Hinweis?" }] });
  const lauf = plane(context, { "planer|## Zuschnitt": [nachfrage, nachfrage], "erkunder|## Nachfrage|S4": [bericht(["S4"])] });
  exit(lauf, EXIT_BEFUNDE);
  assert.equal(aufrufe(lauf, "erkunder", "## Nachfrage").length, 1);
  assert.equal(planungsBericht(lauf).grund, "Nachfragen ausgeschöpft: S4");
});

test("plane: eine Nachfrage mit neuer Stelle beendet die Nachfragen nicht", { timeout: LAUF_FRIST_MS }, (context) => {
  const nachfrage = alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo liegt der Hinweis?" }] });
  const anders = bericht(["S4"], { S4: { weg: [stelle("eingang", HINWEIS, { funktion: "nimmAnruf", von: 1, bis: 4 }), stelle("wirkung", ROUTE, { funktion: "speichereStatus", von: 10, bis: 14 })] } });
  const lauf = plane(context, { "planer|## Zuschnitt": [nachfrage, alsJson({ schnitt: schnittliste() })], "erkunder|## Nachfrage|S4": [anders] });
  exit(lauf, EXIT_GRUEN);
  assert.equal(aufrufe(lauf, "planer", "## Zuschnitt")[1].eingabe.includes("enden; schneide mit einer Annahme"), false);
});

test("plane: zwei Erkunder laufen gleichzeitig", { timeout: LAUF_FRIST_MS }, (context) => {
  const langsam = (nummern) => [{ text: bericht(nummern), warte: WARTEN_MS }];
  const lauf = plane(context, { "erkunder|## Erkundung|S1": langsam(GRUPPEN[0].nummern), "erkunder|## Erkundung|S2": langsam(GRUPPEN[1].nummern) });
  exit(lauf, EXIT_GRUEN);
  const langsame = aufrufe(lauf, "erkunder", "## Erkundung").filter(({ start, ende }) => ende - start >= WARTEN_MS);
  const [erster, zweiter] = langsame.toSorted((links, rechts) => links.start - rechts.start);
  assert.equal(langsame.length, 2);
  assert.ok(zweiter.start < erster.ende, `Startzeiten überlappen nicht: ${erster.start}-${erster.ende}, ${zweiter.start}`);
});

test("plane: der Zuschnitt setzt die Sitzung des Planers mit --resume fort, der Prüfer startet mit --session-id", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context);
  exit(lauf, EXIT_GRUEN);
  const [gliederung] = aufrufe(lauf, "planer", "## Gliederung");
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  const [pruefung] = aufrufe(lauf, "pruefer-planung", "## Prüfung");
  assert.equal(gliederung.resume, false);
  assert.equal(zuschnitt.resume, true);
  assert.equal(zuschnitt.sitzung, gliederung.sitzung);
  assert.equal(pruefung.resume, false);
  assert.notEqual(pruefung.sitzung, gliederung.sitzung);
});

test("plane: eine unvollständige Prüfliste geht genau einmal an den Prüfer zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer({ ...GRUEN_PRUEFLISTE, weglassen: ["gegenfrage:alle"] }), "pruefer-planung|## Befunde": [GRUEN_PRUEFLISTE] });
  exit(lauf, EXIT_GRUEN);
  const rueckgaben = aufrufe(lauf, "pruefer-planung", "## Befunde");
  assert.equal(rueckgaben.length, 1);
  assert.ok(rueckgaben[0].eingabe.includes("gegenfrage:alle: fehlt in der Prüfliste"));
});

test("plane: ein Prüferbefund ohne Antwort des Planers endet mit Exit 4", { timeout: LAUF_FRIST_MS }, (context) => {
  const befund = { ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a3": "a3 braucht den Status aus a2" } };
  const ohneAntwort = alsJson({ schnitt: schnittliste(), antworten: [] });
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(befund), "planer|## Befunde": [ohneAntwort, ohneAntwort] });
  exit(lauf, EXIT_BEFUNDE);
  assert.equal(existsSync(phaseDatei(lauf)), false);
  assert.ok(planungsBericht(lauf).befunde.offen.includes("allein-gruen:a3: Befund des Prüfers ohne Antwort des Planers"));
});

const A2_BEFUND = { ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a2": "a2 braucht den Code aus a1" } };
const A2_KORRIGIERT = { ziel: "Ziel a2 mit dem Code aus a1" };
const A2_ANTWORT = [{ schluessel: "allein-gruen:a2", antwort: "korrigiert: a2 liest den Code aus a1" }];

const ZUSATZ_TESTS = { a14: "rueckruf", a15: "ansage", a16: "sperre", a17: "notiz", a18: "zeitfenster", a19: "sprache", a20: "warteschlange", a21: "weiterleitung", a22: "mailbox", a23: "rueckfrage" };

function zusatz(id, prueft) {
  return auftrag(id, HINWEIS, { prueft, abnahme: `test/anrufe/hinweis-${ZUSATZ_TESTS[id]}.test.js`, abhaengigVon: [] });
}

function korrektur({ a2 = {}, a3 = {}, dazu = [] } = {}) {
  const schnitt = schnittliste();
  const geaendert = { a2, a3 };
  return { ...schnitt, auftraege: [...schnitt.auftraege.map((eintrag) => ({ ...eintrag, ...geaendert[eintrag.id] })), ...dazu] };
}

function antwortMit(schnitt, antworten = A2_ANTWORT) {
  return alsJson({ schnitt, antworten });
}

const OHNE_NUMMER = korrektur({ a2: A2_KORRIGIERT, dazu: [zusatz("a14", [])] });
const MIT_NUMMER = korrektur({ a2: A2_KORRIGIERT, a3: { prueft: ["S4", "B1"] }, dazu: [zusatz("a14", ["S5"])] });

test("plane: ein Skriptbefund nach der Korrektur geht an den Planer zurück und die Planung endet grün", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(OHNE_NUMMER), antwortMit(MIT_NUMMER)] });
  exit(lauf, EXIT_GRUEN);
  assert.equal(existsSync(phaseDatei(lauf)), true);
  const [, ruecksendung] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(ruecksendung.eingabe.includes("a14"), ruecksendung.eingabe);
  const { korrigiert } = planungsBericht(lauf).befunde;
  assert.equal(korrigiert.filter(({ schluessel }) => schluessel === "allein-gruen:a2").length, 1);
});

test("plane: ein Skriptbefund, der nach der Korrektur wiederkehrt, endet mit Exit 4 und planung/schnitt.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(OHNE_NUMMER), antwortMit(OHNE_NUMMER)] });
  exit(lauf, EXIT_BEFUNDE);
  assert.match(planungsBericht(lauf).grund, /wiederkehrend/u);
  assert.equal(existsSync(join(lauf.wurzel, ORDNER, "planung", "schnitt.json")), true);
  assert.equal(existsSync(phaseDatei(lauf)), false);
});

test("plane: endet die Korrektur mit Exit 4, stehen die Befunde des Prüfers mit der letzten Antwort des Planers je einmal unter offen", { timeout: LAUF_FRIST_MS }, (context) => {
  const zurueck = `trifft nicht zu, weil a3 den Status selbst setzt (${ROUTE}:5)`;
  const drei = { ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a2": "a2 braucht den Code aus a1", "nie-saetze:a3": "a3 nennt keinen Nie-Satz", "gegenfrage:alle": "S5 fehlt im Plan" } };
  const antworten = [...A2_ANTWORT, { schluessel: "nie-saetze:a3", antwort: zurueck }];
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(drei), "planer|## Befunde": [antwortMit(OHNE_NUMMER, antworten), antwortMit(OHNE_NUMMER, antworten)] });
  exit(lauf, EXIT_BEFUNDE);
  const { offen, korrigiert, zurueckgewiesen } = planungsBericht(lauf).befunde;
  const erwartet = [
    `allein-gruen:a2: a2 braucht den Code aus a1 (Fundstelle: ${FUNDSTELLE}) | korrigiert: a2 liest den Code aus a1`,
    `nie-saetze:a3: a3 nennt keinen Nie-Satz (Fundstelle: ${FUNDSTELLE}) | ${zurueck}`,
    `gegenfrage:alle: S5 fehlt im Plan (Fundstelle: ${FUNDSTELLE})`,
  ];
  for (const zeile of erwartet) assert.equal(offen.filter((eintrag) => eintrag === zeile).length, 1, `${zeile} nicht genau einmal in\n${offen.join("\n")}`);
  assert.ok(offen.includes("gegenfrage:alle: Befund des Prüfers ohne Antwort des Planers"), offen.join("\n"));
  assert.deepEqual([korrigiert, zurueckgewiesen], [[], []]);
});

test("plane: eine Korrektur ohne weniger Befunde endet mit Exit 4",{ timeout: LAUF_FRIST_MS }, (context) => {
  const anderer = korrektur({ a2: A2_KORRIGIERT, a3: { prueft: ["S4", "B1"] }, dazu: [zusatz("a14", ["S5"]), zusatz("a15", [])] });
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(OHNE_NUMMER), antwortMit(anderer)] });
  exit(lauf, EXIT_BEFUNDE);
  assert.match(planungsBericht(lauf).grund, /sank nicht/u);
});

test("plane: nach drei Rücksendungen endet die Schleife mit Exit 4", { timeout: LAUF_FRIST_MS }, (context) => {
  const ohneNummern = (...kennungen) => alsJson({ schnitt: korrektur({ dazu: kennungen.map((id) => zusatz(id, [])) }) });
  const lauf = plane(context, {
    "planer|## Zuschnitt": [ohneNummern("a14", "a15", "a16", "a17")],
    "planer|## Befunde": [ohneNummern("a18", "a19", "a20"), ohneNummern("a21", "a22"), ohneNummern("a23")],
  });
  exit(lauf, EXIT_BEFUNDE);
  assert.match(planungsBericht(lauf).grund, /nach 3 Rücksendungen$/u);
  assert.equal(aufrufe(lauf, "planer", "## Befunde").length, 3);
});

test("plane: Antwortbefund und Skriptbefund derselben Korrektur gehen zusammen zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  const zweiOhne = korrektur({ dazu: [zusatz("a14", []), zusatz("a15", [])] });
  const doppelt = korrektur({ a2: A2_KORRIGIERT, a3: { prueft: ["S4", "B1"] }, dazu: [zusatz("a14", ["S5"]), zusatz("a15", ["B1"])] });
  const sauber = korrektur({ a2: A2_KORRIGIERT, a3: { prueft: ["S4"] }, dazu: [zusatz("a14", ["S5"]), zusatz("a15", ["B1"])] });
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(zweiOhne, []), antwortMit(doppelt), antwortMit(sauber)] });
  exit(lauf, EXIT_GRUEN);
  const [, erste, zweite] = aufrufe(lauf, "planer", "## Befunde");
  for (const teil of ["allein-gruen:a2: Befund des Prüfers ohne Antwort des Planers", "a14: funktion ohne Nummer", "a15: funktion ohne Nummer"]) assert.ok(erste.eingabe.includes(teil), `${teil} fehlt in\n${erste.eingabe}`);
  assert.ok(zweite.eingabe.includes("B1 steht mehrfach"), zweite.eingabe);
  assert.equal(zweite.eingabe.includes("ohne Antwort des Planers"), false);
});

const UEBERGREIFENDER_PRUEFER = 1;

function jePruefer(eintrag) {
  return Array.from({ length: GRUPPEN.length + UEBERGREIFENDER_PRUEFER }, () => eintrag);
}

function auftragAus(schnitt, id, geaendert = {}) {
  return { ...schnitt.auftraege.find((eintrag) => eintrag.id === id), ...geaendert };
}

function geplanteListe({ wurzel }) {
  return JSON.parse(readFileSync(join(wurzel, ORDNER, "planung", "schnitt.json"), "utf8"));
}

test("plane: eine Änderung mit neuem Auftrag ohne Nummer geht als Skriptbefund zurück und endet nach der Korrektur grün", { timeout: LAUF_FRIST_MS }, (context) => {
  const ohneNummer = alsJson({ teilliste: { auftraege: [auftragAus(schnittliste(), "a2", A2_KORRIGIERT), zusatz("a14", [])] }, antworten: A2_ANTWORT });
  const mitNummer = alsJson({ teilliste: { auftraege: [auftragAus(schnittliste(), "a3", { prueft: ["S4", "B1"] }), zusatz("a14", ["S5"])] }, antworten: A2_ANTWORT });
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [ohneNummer, mitNummer] });
  exit(lauf, EXIT_GRUEN);
  const [, ruecksendung] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(ruecksendung.eingabe.includes("a14: funktion ohne Nummer"), ruecksendung.eingabe);
  assert.deepEqual(geplanteListe(lauf), MIT_NUMMER);
  const { korrigiert } = planungsBericht(lauf).befunde;
  assert.equal(korrigiert.filter(({ schluessel }) => schluessel === "allein-gruen:a2").length, 1);
  assert.equal(existsSync(phaseDatei(lauf)), true);
});

test("plane: schnitt und teilliste zugleich sind ein Befund", { timeout: LAUF_FRIST_MS }, (context) => {
  const beides = alsJson({ schnitt: schnittliste(), teilliste: { auftraege: [zusatz("a14", ["S5"])] } });
  const lauf = plane(context, { "planer|## Zuschnitt": [beides], "planer|## Befunde": [alsJson({ schnitt: schnittliste() })] });
  exit(lauf, EXIT_GRUEN);
  const [ruecksendung] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(ruecksendung.eingabe.includes("Regel Teilliste: schnitt und teilliste zugleich; schick eines"), ruecksendung.eingabe);
  assert.deepEqual(geplanteListe(lauf), schnittliste());
});

test("plane: eine teilliste vor der ersten Schnittliste ist ein Befund", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "planer|## Zuschnitt": [alsJson({ teilliste: { auftraege: [zusatz("a14", ["S5"])] } })], "planer|## Befunde": [alsJson({ schnitt: schnittliste() })] });
  exit(lauf, EXIT_GRUEN);
  const [ruecksendung] = aufrufe(lauf, "planer", "## Befunde");
  assert.ok(ruecksendung.eingabe.includes("Regel Teilliste: teilliste gibt es erst nach einer Schnittliste"), ruecksendung.eingabe);
});

test("plane: der Planer liest verdichtete Berichte, Prüfer und Entwurf-Schreiber den Volltext", { timeout: LAUF_FRIST_MS }, (context) => {
  const nachfrage = alsJson({ nachfragen: [{ nummern: ["S4"], frage: "Wo liegt der Hinweis?" }] });
  const lauf = plane(context, { "planer|## Zuschnitt": [nachfrage, alsJson({ schnitt: schnittliste() })], "erkunder|## Nachfrage|S4": [bericht(["S4"])] });
  exit(lauf, EXIT_GRUEN);
  const [zuschnitt, nachNachfrage] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(zuschnitt.eingabe.includes("### Erkundungsberichte (verdichtet)"), zuschnitt.eingabe);
  assert.ok(zuschnitt.eingabe.includes(`weg: eingang ${ROUTE} hinterlege 2–4 · wirkung ${ROUTE} speichereStatus 10–14`), zuschnitt.eingabe);
  assert.ok(nachNachfrage.eingabe.includes("Frage: Wo liegt der Hinweis?"), nachNachfrage.eingabe);
  assert.ok(nachNachfrage.eingabe.includes(`weg: eingang ${HINWEIS} nimmAnruf 1–4 · wirkung ${HINWEIS} setzeHinweis 6–9`), nachNachfrage.eingabe);
  for (const planer of [zuschnitt, nachNachfrage]) assert.equal(planer.eingabe.includes('"nummern": {'), false);
  const pruefungen = aufrufe(lauf, "pruefer-planung", "## Prüfung");
  for (const { nummern: [erste] } of GRUPPEN) {
    const pruefer = pruefungen.find((eintrag) => prueflisteZeilen(eintrag).includes(`weg:${erste}`));
    assert.ok(pruefer.eingabe.includes(`"${erste}": {`), `Volltext zu ${erste} fehlt beim Prüfer`);
  }
  for (const entwurf of aufrufe(lauf, "entwurf", "## Entwurf")) assert.ok(entwurf.eingabe.includes('"nummern": {'), entwurf.eingabe);
});

test("plane: der Erkunder bekommt das Gerüst und die Namen aus dem Wenn", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context);
  exit(lauf, EXIT_GRUEN);
  const erkundung = aufrufe(lauf, "erkunder", "## Erkundung").find(({ eingabe }) => eingabe.includes("#### S1 ("));
  const [, geruest] = erkundung.eingabe.split("### Gerüst deines Berichts");
  for (const nummer of GRUPPEN[0].nummern) assert.ok(geruest.includes(`"${nummer}": {`), geruest);
  assert.ok(geruest.includes('"vorbild": "<AUSFUELLEN>"'), geruest);
  const [, namen] = erkundung.eingabe.split("### Namen aus dem Wenn, die in deiner Eingangsdatei stehen müssen");
  assert.ok(namen.includes("- S1: `POST /api/self-service/private-number`\n"), namen);
  assert.ok(namen.includes("- T2: `POST /api/self-service/private-number`\n"), namen);
});

const WEGFEHLER = { ...GRUEN_PRUEFLISTE, befunde: { "weg:S7": "der Weg endet nicht in speichereStatus" } };
const WEG_ZEILE = `Weg S7: der Weg endet nicht in speichereStatus (Fundstelle: ${FUNDSTELLE})`;

function wegpruefungen(lauf, erste) {
  return aufrufe(lauf, "pruefer-planung", "## Wegprüfung").filter(({ eingabe }) => eingabe.includes(`#### ${erste} (`));
}

function offenePunkte({ eingabe }) {
  const [, offen] = eingabe.split("### Offene Punkte");
  return offen.split("\n### ")[0];
}

function wegfehlerLaufMitKorrektur(context, hinweis) {
  const korrigiert = alsJson({ nummern: Object.fromEntries(GRUPPEN[0].nummern.map((nummer) => [nummer, angaben(nummer)])), hinweise: [hinweis] });
  const lauf = plane(context, { "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER, GRUEN_PRUEFLISTE], "erkunder|## Befunde": [korrigiert] });
  exit(lauf, EXIT_GRUEN);
  return lauf;
}

test("plane: die Wegprüfung schickt einen Wegfehler an den Erkunder, der korrigierte Bericht erreicht den Planer, und weg bleibt in der Endprüfung", { timeout: LAUF_FRIST_MS }, (context) => {
  const hinweis = "S7 endet in speichereStatus";
  const lauf = wegfehlerLaufMitKorrektur(context, hinweis);
  const [rueckgabe, ...weitere] = aufrufe(lauf, "erkunder", "## Befunde");
  assert.equal(weitere.length, 0);
  assert.ok(rueckgabe.eingabe.includes(`weg:S7: der Weg endet nicht in speichereStatus (Fundstelle: ${FUNDSTELLE})`), rueckgabe.eingabe);
  const [erste, zweite] = wegpruefungen(lauf, "S1");
  assert.deepEqual([zweite.resume, zweite.sitzung], [true, erste.sitzung]);
  assert.ok(zweite.eingabe.includes(hinweis), zweite.eingabe);
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(zuschnitt.eingabe.includes(`hinweis: ${hinweis}`), zuschnitt.eingabe);
  assert.equal(offenePunkte(zuschnitt).includes("Weg S7"), false);
  const zeilen = aufrufe(lauf, "pruefer-planung", "## Prüfung").flatMap(prueflisteZeilen);
  for (const nummer of GRUPPEN.flatMap((gruppe) => gruppe.nummern)) assert.ok(zeilen.includes(`weg:${nummer}`), `weg:${nummer} fehlt in der Endprüfung`);
});

test("plane: die erste Wegprüfung bekommt Design Doc und Erkundungsbericht, die nach einer Korrektur nur den korrigierten Bericht", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = wegfehlerLaufMitKorrektur(context, "S7 endet in speichereStatus");
  const [erste, zweite] = wegpruefungen(lauf, "S1").map(({ eingabe }) => eingabe);
  const design = ["### Eingang laut Design Doc", "### Abschnitte des Design Docs"];
  for (const teil of [...design, "### Erkundungsbericht\n", "### Zeilen deiner Prüfliste"]) assert.ok(erste.includes(teil), teil);
  assert.equal(erste.includes("### Korrigierter Erkundungsbericht"), false, erste);
  for (const teil of ["### Korrigierter Erkundungsbericht\n", "### Zeilen deiner Prüfliste"]) assert.ok(zweite.includes(teil), teil);
  for (const teil of [...design, "### Erkundungsbericht\n"]) assert.equal(zweite.includes(teil), false, teil);
});

test("plane: ein Wegfehler, der bleibt, steht unter Offene Punkte und in planung.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER, WEGFEHLER], "erkunder|## Befunde": [bericht(GRUPPEN[0].nummern)] });
  exit(lauf, EXIT_GRUEN);
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(offenePunkte(zuschnitt).includes(`- ${WEG_ZEILE}`), zuschnitt.eingabe);
  const [erste] = wegpruefungen(lauf, "S1");
  const beleg = planungsBericht(lauf);
  assert.deepEqual(beleg.wegpruefungen.find(({ nummern }) => nummern[0] === "S1"), { nummern: GRUPPEN[0].nummern, sitzung: erste.sitzung, runden: 2, offen: [WEG_ZEILE] });
  assert.ok(beleg.schleifen.some(({ art, ende }) => art === "weg" && ende?.startsWith("wiederkehrend")), JSON.stringify(beleg.schleifen));
  assert.ok(lauf.stdout.includes(`Wegprüfungen: ${JSON.stringify(beleg.wegpruefungen)}`), lauf.stdout);
  assert.ok(aufrufe(lauf, "pruefer-planung", "## Prüfung").flatMap(prueflisteZeilen).includes("weg:S7"));
});

test("plane: fällt die Korrektur nach einem Wegfehler durch die Skriptprüfung, stehen ihre Befunde unter Offene Punkte und in planung.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const erfunden = bericht(GRUPPEN[0].nummern, { S1: { aenderungen: [{ datei: ROUTE, funktion: "gibtEsNicht", von: 10, bis: 14, neueZeilen: 3 }] } });
  const lauf = plane(context, { "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER], "erkunder|## Befunde": [erfunden, erfunden] });
  exit(lauf, EXIT_GRUEN);
  const verworfen = `Weg ${GRUPPEN[0].nummern.join(", ")}: Korrektur verworfen: `;
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  const zeilen = offenePunkte(zuschnitt).split("\n");
  assert.ok(zeilen.some((zeile) => zeile.startsWith(`- ${verworfen}`) && zeile.includes("gibtEsNicht")), zuschnitt.eingabe);
  assert.ok(zeilen.includes(`- ${WEG_ZEILE}`), zuschnitt.eingabe);
  const { offen } = planungsBericht(lauf).wegpruefungen.find(({ nummern }) => nummern[0] === "S1");
  assert.ok(offen.some((zeile) => zeile.startsWith(verworfen) && zeile.includes("gibtEsNicht")), JSON.stringify(offen));
});

test("plane: nach einer Nachfrage mit sauberer Wegprüfung steht der alte Wegfehler ihrer Nummer nicht mehr unter Offene Punkte", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, {
    "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER, WEGFEHLER],
    "erkunder|## Befunde": [bericht(GRUPPEN[0].nummern)],
    "planer|## Zuschnitt": [alsJson({ nachfragen: [{ nummern: ["S7"], frage: "Wo endet der Weg?" }] }), alsJson({ schnitt: schnittliste() })],
    "erkunder|## Nachfrage|S7": [bericht(["S7"])],
  });
  exit(lauf, EXIT_GRUEN);
  const [zuschnitt, nachNachfrage] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(offenePunkte(zuschnitt).includes(`- ${WEG_ZEILE}`), zuschnitt.eingabe);
  assert.equal(offenePunkte(nachNachfrage).includes("Weg S7"), false, nachNachfrage.eingabe);
  assert.deepEqual(planungsBericht(lauf).wegpruefungen.find(({ nummern }) => nummern[0] === "S1").offen, [WEG_ZEILE]);
});

test("plane: nennen zwei Nachfragen dieselbe Nummer, gehört der offene Wegfehler zum übernommenen Bericht, auch wenn die frühere Wegprüfung zuletzt endet", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, {
    "planer|## Zuschnitt": [alsJson({ nachfragen: [{ nummern: ["S7"], frage: "Wo endet der Weg?" }, { nummern: ["S1", "S7"], frage: "Wo beginnt der Weg?" }] }), alsJson({ schnitt: schnittliste() })],
    "erkunder|## Nachfrage|S7": [bericht(["S7"])],
    "erkunder|## Nachfrage|S1": [bericht(["S1", "S7"])],
    "erkunder|## Befunde": [bericht(["S7"])],
    "pruefer-planung|## Wegprüfung|S7": [WEGFEHLER, { ...WEGFEHLER, warte: WARTEN_MS }],
    "pruefer-planung|## Wegprüfung|S1": [GRUEN_PRUEFLISTE, GRUEN_PRUEFLISTE],
  });
  exit(lauf, EXIT_GRUEN);
  const erstAbS7 = wegpruefungen(lauf, "S7").filter(({ eingabe }) => !eingabe.includes("#### S1 ("));
  const frueher = erstAbS7.at(-1);
  const spaeter = wegpruefungen(lauf, "S1").at(-1);
  assert.equal(erstAbS7.length, 2);
  assert.ok(frueher.ende > spaeter.ende, `die Wegprüfung der früheren Nachfrage endet nicht zuletzt: ${frueher.ende}, ${spaeter.ende}`);
  const [, nachNachfrage] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.equal(offenePunkte(nachNachfrage).includes("Weg S7"), false, nachNachfrage.eingabe);
});

test("plane: eine Wegprüfliste, die nach der Rücksendung unvollständig bleibt, steht unter Offene Punkte", { timeout: LAUF_FRIST_MS }, (context) => {
  const ohneZeile = { ...GRUEN_PRUEFLISTE, weglassen: ["weg:S7"] };
  const lauf = plane(context, { "pruefer-planung|## Wegprüfung|S1": [ohneZeile], "pruefer-planung|## Befunde": [ohneZeile] });
  exit(lauf, EXIT_GRUEN);
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(offenePunkte(zuschnitt).includes("- Weg S1, S7, T2: weg:S7: fehlt in der Prüfliste"), zuschnitt.eingabe);
});

test("plane: eine fehlende Wegzeile bleibt nach einer sauberen Nachfrage zu einer anderen Nummer der Gruppe offen und fällt mit der sauberen Nachfrage zu ihrer Nummer weg", { timeout: LAUF_FRIST_MS }, (context) => {
  const ohneZeile = { ...GRUEN_PRUEFLISTE, weglassen: ["weg:S7"] };
  const fehlt = "- Weg S1, S7, T2: weg:S7: fehlt in der Prüfliste";
  const lauf = plane(context, {
    "pruefer-planung|## Wegprüfung|S1": [ohneZeile, GRUEN_PRUEFLISTE],
    "pruefer-planung|## Befunde": [ohneZeile],
    "planer|## Zuschnitt": [
      alsJson({ nachfragen: [{ nummern: ["S1"], frage: "Wo beginnt der Weg?" }] }),
      alsJson({ nachfragen: [{ nummern: ["S7"], frage: "Wo endet der Weg?" }] }),
      alsJson({ schnitt: schnittliste() }),
    ],
    "erkunder|## Nachfrage|S1": [bericht(["S1"])],
    "erkunder|## Nachfrage|S7": [bericht(["S7"])],
  });
  exit(lauf, EXIT_GRUEN);
  const [zuschnitt, nachS1, nachS7] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(offenePunkte(zuschnitt).includes(fehlt), zuschnitt.eingabe);
  assert.ok(offenePunkte(nachS1).includes(fehlt), nachS1.eingabe);
  assert.equal(offenePunkte(nachS7).includes("weg:S7: fehlt in der Prüfliste"), false, nachS7.eingabe);
});

test("plane: eine verworfene Korrektur der Gruppe fällt mit der sauberen Nachfrage zu einer ihrer Nummern weg, der Wegfehler einer anderen Nummer bleibt", { timeout: LAUF_FRIST_MS }, (context) => {
  const erfunden = bericht(GRUPPEN[0].nummern, { S1: { aenderungen: [{ datei: ROUTE, funktion: "gibtEsNicht", von: 10, bis: 14, neueZeilen: 3 }] } });
  const lauf = plane(context, {
    "pruefer-planung|## Wegprüfung|S1": [WEGFEHLER],
    "erkunder|## Befunde": [erfunden, erfunden],
    "planer|## Zuschnitt": [alsJson({ nachfragen: [{ nummern: ["T2"], frage: "Wo wird die Nummer gespeichert?" }] }), alsJson({ schnitt: schnittliste() })],
    "erkunder|## Nachfrage|T2": [bericht(["T2"])],
  });
  exit(lauf, EXIT_GRUEN);
  const [zuschnitt, nachNachfrage] = aufrufe(lauf, "planer", "## Zuschnitt");
  assert.ok(offenePunkte(zuschnitt).includes("Korrektur verworfen"), zuschnitt.eingabe);
  assert.equal(offenePunkte(nachNachfrage).includes("Korrektur verworfen"), false, nachNachfrage.eingabe);
  assert.ok(offenePunkte(nachNachfrage).includes(`- ${WEG_ZEILE}`), nachNachfrage.eingabe);
});

test("plane: ein Wegbefund in einer unvollständigen Wegprüfliste steht unter Offene Punkte und in planung.json", { timeout: LAUF_FRIST_MS }, (context) => {
  const befundOhneZeile = { ...GRUEN_PRUEFLISTE, weglassen: ["weg:S7"], befunde: { "weg:T2": "der Weg endet nicht im Speicher" } };
  const lauf = plane(context, { "pruefer-planung|## Wegprüfung|S1": [befundOhneZeile], "pruefer-planung|## Befunde": [befundOhneZeile] });
  exit(lauf, EXIT_GRUEN);
  const wegbefund = `Weg T2: der Weg endet nicht im Speicher (Fundstelle: ${FUNDSTELLE})`;
  const [zuschnitt] = aufrufe(lauf, "planer", "## Zuschnitt");
  for (const zeile of ["Weg S1, S7, T2: weg:S7: fehlt in der Prüfliste", wegbefund]) assert.ok(offenePunkte(zuschnitt).includes(`- ${zeile}`), zuschnitt.eingabe);
  const { offen } = planungsBericht(lauf).wegpruefungen.find(({ nummern }) => nummern[0] === "S1");
  assert.ok(offen.includes(wegbefund), JSON.stringify(offen));
});

function gruppenPruefung(lauf, nummer) {
  return aufrufe(lauf, "pruefer-planung", "## Prüfung").find(({ eingabe }) => eingabe.includes("### Erkundungsbericht deiner Gruppe") && eingabe.includes(`#### ${nummer} (`));
}

function abgelegt({ wurzel }, name) {
  return JSON.parse(readFileSync(join(wurzel, ORDNER, "planung", name), "utf8"));
}

test("plane: die Gruppenprüfer und der übergreifende Prüfer laufen gleichzeitig und ihre Befunde gehen in einer Rücksendung an den Planer", { timeout: LAUF_FRIST_MS }, (context) => {
  const langsam = { ...GRUEN_PRUEFLISTE, warte: WARTEN_MS, befunde: { "nie-saetze:a1": "a1 nennt keinen Nie-Satz", "allein-gruen:a2": "a2 braucht den Code aus a1" } };
  const teilliste = { auftraege: [auftragAus(schnittliste(), "a1", { ziel: "Ziel a1 mit Nie-Satz" }), auftragAus(schnittliste(), "a2", A2_KORRIGIERT)] };
  const antworten = [{ schluessel: "nie-saetze:a1", antwort: "korrigiert: a1 nennt den Nie-Satz" }, ...A2_ANTWORT];
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(langsam), "planer|## Befunde": [alsJson({ teilliste, antworten })] });
  exit(lauf, EXIT_GRUEN);
  const pruefungen = aufrufe(lauf, "pruefer-planung", "## Prüfung");
  assert.equal(pruefungen.length, GRUPPEN.length + UEBERGREIFENDER_PRUEFER);
  const spaetesterStart = Math.max(...pruefungen.map(({ start }) => start));
  const fruehestesEnde = Math.min(...pruefungen.map(({ ende }) => ende));
  assert.ok(spaetesterStart < fruehestesEnde, `Prüfer laufen nicht gleichzeitig: ${spaetesterStart} ≥ ${fruehestesEnde}`);
  const [ruecksendung, ...weitere] = aufrufe(lauf, "planer", "## Befunde");
  assert.equal(weitere.length, 0);
  for (const schluessel of ["nie-saetze:a1", "allein-gruen:a2"]) assert.ok(ruecksendung.eingabe.includes(`${schluessel}: `), ruecksendung.eingabe);
  const zeilen = pruefungen.flatMap(prueflisteZeilen);
  assert.deepEqual(zeilen.toSorted(), abgelegt(lauf, "pruefliste.json").map(({ schluessel }) => schluessel).toSorted());
  assert.deepEqual(abgelegt(lauf, "pruefliste-aufteilung.json").map(({ gruppe }) => gruppe), [...GRUPPEN.keys(), null]);
  const uebergreifend = pruefungen.find((eintrag) => prueflisteZeilen(eintrag).includes("gegenfrage:alle"));
  for (const teil of ["### Erkundungsberichte (verdichtet)", "### Dateikarte", `weg: eingang ${ROUTE} hinterlege 2–4`]) assert.ok(uebergreifend.eingabe.includes(teil), teil);
  assert.equal(uebergreifend.eingabe.includes('"nummern": {'), false);
});

function prueflisteZeilen({ eingabe }) {
  const [, zeilen] = eingabe.split("### Zeilen deiner Prüfliste");
  return zeilen.split("\n").filter((zeile) => zeile.startsWith("- ")).map((zeile) => zeile.slice(2));
}

function zeilenDes(id) {
  return ["nie-saetze", "allein-gruen", "nicht-zusammengelegt"].map((regel) => `${regel}:${id}`);
}

test("plane: nach der Korrektur prüft ein frischer Prüfer genau die Nachprüf-Schlüssel", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(MIT_NUMMER)] });
  exit(lauf, EXIT_GRUEN);
  const pruefungen = aufrufe(lauf, "pruefer-planung", "## Prüfung");
  const [nachpruefung, ...weitere] = aufrufe(lauf, "pruefer-planung", "## Nachprüfung");
  assert.equal(weitere.length, 0);
  assert.equal(nachpruefung.resume, false);
  assert.equal(pruefungen.some(({ sitzung }) => sitzung === nachpruefung.sitzung), false);
  assert.deepEqual(prueflisteZeilen(nachpruefung), ["durchstich:a1", "weg:S2", "weg:S3", "weg:S6", "weg:S4", "weg:S5", "weg:B1", "weg:T1", "b-nummer:B1", ...zeilenDes("a2"), ...zeilenDes("a3"), ...zeilenDes("a14"), "gegenfrage:alle"]);
  assert.ok(nachpruefung.eingabe.includes("allein-gruen:a2: a2 braucht den Code aus a1 | korrigiert: a2 liest den Code aus a1"));
  assert.equal(planungsBericht(lauf).nachpruefungen[0].sitzung, nachpruefung.sitzung);
});

test("plane: ein zurückgewiesener Befund, den die Nachprüfung bestätigt, endet mit Exit 4 und beiden Texten im Bericht", { timeout: LAUF_FRIST_MS }, (context) => {
  const antwort = `trifft nicht zu, weil a2 den Code selbst erzeugt (${ROUTE}:5)`;
  const bestaetigt = "a2 liest den Code aus a1, den a2 nicht erzeugt";
  const lauf = plane(context, {
    "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND),
    "planer|## Befunde": [antwortMit(schnittliste(), [{ schluessel: "allein-gruen:a2", antwort }])],
    "pruefer-planung|## Nachprüfung": [{ ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a2": bestaetigt } }],
  });
  exit(lauf, EXIT_BEFUNDE);
  const { grund, befunde } = planungsBericht(lauf);
  assert.match(grund, /wiederkehrend/u);
  assert.deepEqual(befunde.zurueckgewiesen, [{ schluessel: "allein-gruen:a2", befund: "a2 braucht den Code aus a1", antwort }]);
  assert.deepEqual(befunde.offen, [`allein-gruen:a2: ${bestaetigt} (Fundstelle: ${FUNDSTELLE})`]);
  assert.equal(existsSync(phaseDatei(lauf)), false);
});

test("plane: ein neuer Befund der Nachprüfung geht an den Planer zurück und endet nach der zweiten Nachprüfung grün", { timeout: LAUF_FRIST_MS }, (context) => {
  const zwei = { ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a2": "a2 braucht den Code aus a1", "nie-saetze:a3": "a3 nennt keinen Nie-Satz" } };
  const ersteAntworten = [...A2_ANTWORT, { schluessel: "nie-saetze:a3", antwort: "korrigiert: a3 gibt S5 an a14 ab" }];
  const a14Korrigiert = { ...MIT_NUMMER, auftraege: MIT_NUMMER.auftraege.map((eintrag) => (eintrag.id === "a14" ? { ...eintrag, ziel: "Ziel a14 ohne Anruf" } : eintrag)) };
  const lauf = plane(context, {
    "pruefer-planung|## Prüfung": jePruefer(zwei),
    "planer|## Befunde": [antwortMit(MIT_NUMMER, ersteAntworten), antwortMit(a14Korrigiert, [{ schluessel: "allein-gruen:a14", antwort: "korrigiert: a14 ruft nicht an" }])],
    "pruefer-planung|## Nachprüfung": [{ ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a14": "a14 braucht einen Anruf aus a3" } }, GRUEN_PRUEFLISTE],
  });
  exit(lauf, EXIT_GRUEN);
  const beleg = planungsBericht(lauf);
  const [erste, zweite] = aufrufe(lauf, "pruefer-planung", "## Nachprüfung");
  assert.deepEqual(beleg.nachpruefungen.map(({ runde, sitzung, befunde }) => [runde, sitzung, befunde]), [[1, erste.sitzung, 1], [2, zweite.sitzung, 0]]);
  assert.notEqual(erste.sitzung, zweite.sitzung);
  const pruefung = beleg.schleifen.find(({ art }) => art === "pruefung");
  assert.deepEqual(pruefung.runden.map(({ zahl }) => zahl), [2, 1]);
  assert.equal(existsSync(phaseDatei(lauf)), true);
});

test("plane: ein Nachprüfer, der eine Datei ändert, bricht mit Exit 1 ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "pruefer-planung|## Prüfung": jePruefer(A2_BEFUND), "planer|## Befunde": [antwortMit(MIT_NUMMER)], "pruefer-planung|## Nachprüfung": [{ ...GRUEN_PRUEFLISTE, schreibe: ROUTE }] });
  exit(lauf, EXIT_ABBRUCH);
  assert.equal(planungsBericht(lauf).grund, `pruefer-planung haben ${ROUTE} geändert`);
});

test("plane: ein Entwurf ohne gemeinsamen Namen geht einmal an seinen Schreiber zurück", { timeout: LAUF_FRIST_MS }, (context) => {
  const ohneNamen = alsJson({ entwurf: "Grundlage: design.md, Lösung\nliest den Status\nFehlerfälle: keine" });
  const lauf = plane(context, { [`entwurf|## Entwurf|${HINWEIS}`]: [ohneNamen], "entwurf|## Befunde": [ENTWURF_HINWEIS] });
  exit(lauf, EXIT_GRUEN);
  const rueckgaben = aufrufe(lauf, "entwurf", "## Befunde");
  assert.equal(rueckgaben.length, 1);
  assert.ok(rueckgaben[0].eingabe.includes("gemeinsamer Name bestaetigt fehlt wörtlich"));
});

test("plane: eine Antwort ohne JSON-Block zweimal endet mit Exit 1", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "planer|## Gliederung": ["Ich gliedere gleich."], "planer|## Befunde": ["Immer noch kein JSON."] });
  exit(lauf, EXIT_ABBRUCH);
  assert.ok(aufrufe(lauf, "planer", "## Befunde")[0].eingabe.includes("Antwort ohne JSON-Block"));
  assert.equal(planungsBericht(lauf).exit, EXIT_ABBRUCH);
  assert.equal(planungsBericht(lauf).grund, "planer hat zweimal ohne JSON-Block geantwortet");
});

test("plane: ein abgestürzter Agent endet mit Exit 1 und der Meldung Absturz, ohne Rücksendung an ihn", { timeout: LAUF_FRIST_MS }, (context) => {
  const absturz = { absturz: { exit: ABSTURZ_EXIT, fehler: `erste Zeile\n${ABSTURZ_FEHLER}\n` } };
  const lauf = plane(context, { "planer|## Gliederung": [absturz], "planer|## Befunde": [alsJson({ gruppen: GRUPPEN })] });
  exit(lauf, EXIT_ABBRUCH);
  const grund = planungsBericht(lauf).grund;
  assert.ok(grund.startsWith(`planer ist abgestürzt (Exit ${ABSTURZ_EXIT})`), grund);
  assert.ok(grund.includes(ABSTURZ_FEHLER), grund);
  assert.equal(aufrufe(lauf, "planer", "## Gliederung").length, 1);
  assert.equal(aufrufe(lauf, "planer", "## Befunde").length, 0);
});

test("plane: stürzt der Agent erst nach der Rücksendung ab, meldet die Planung den Absturz statt zweimal ohne JSON-Block", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "planer|## Gliederung": ["Ich gliedere gleich."], "planer|## Befunde": [{ absturz: { exit: ABSTURZ_EXIT, fehler: ABSTURZ_FEHLER } }] });
  exit(lauf, EXIT_ABBRUCH);
  assert.equal(planungsBericht(lauf).grund, `planer ist abgestürzt (Exit ${ABSTURZ_EXIT}):\n${ABSTURZ_FEHLER}`);
  assert.equal(aufrufe(lauf, "planer", "## Befunde").length, 1);
});

test("plane: ein Nutzungslimit setzt dieselbe Sitzung mit derselben Nachricht fort", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "planer|## Gliederung": [{ limit: true }, alsJson({ gruppen: GRUPPEN })] });
  exit(lauf, EXIT_GRUEN);
  const [erster, zweiter] = aufrufe(lauf, "planer", "## Gliederung");
  assert.equal(erster.resume, false);
  assert.equal(zweiter.resume, true);
  assert.equal(zweiter.sitzung, erster.sitzung);
  assert.equal(zweiter.eingabe, erster.eingabe);
});

test("plane: ein Agent, der eine Datei ändert, bricht mit Exit 1 ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "erkunder|## Erkundung|S2": [{ text: bericht(GRUPPEN[1].nummern), schreibe: ROUTE }] });
  exit(lauf, EXIT_ABBRUCH);
  assert.equal(planungsBericht(lauf).grund, `erkunder haben ${ROUTE} geändert`);
  assert.equal(aufrufe(lauf, "planer", "## Zuschnitt").length, 0);
});

test("plane: eine geänderte pitch.md bricht mit Exit 1 ab", { timeout: LAUF_FRIST_MS }, (context) => {
  const lauf = plane(context, { "planer|## Gliederung": [{ text: alsJson({ gruppen: GRUPPEN }), schreibe: `${ORDNER}/pitch.md` }] });
  exit(lauf, EXIT_ABBRUCH);
  assert.equal(planungsBericht(lauf).grund, `planer haben ${ORDNER}/pitch.md geändert`);
});

test("plane: ein vorhandener Ordner planung endet mit Exit 2 und ändert nichts", { timeout: LAUF_FRIST_MS }, (context) => {
  const wurzel = planOrdner(context);
  mkdirSync(join(wurzel, ORDNER, "planung"));
  const lauf = runIn(wurzel, process.execPath, [AUFTRAG, "plane", ORDNER]);
  assert.equal(lauf.status, EXIT_AUFRUF);
  assert.deepEqual(readdirSync(join(wurzel, ORDNER, "planung")), []);
  assert.equal(existsSync(join(wurzel, ".fortschritt")), false);
});

test("plane: ein falscher Aufruf endet mit Exit 2", (context) => {
  const wurzel = planOrdner(context);
  assert.equal(runIn(wurzel, process.execPath, [AUFTRAG, "plane"]).status, EXIT_AUFRUF);
  assert.equal(runIn(wurzel, process.execPath, [AUFTRAG, "plane", ORDNER, "zwei"]).status, EXIT_AUFRUF);
  assert.equal(runIn(wurzel, process.execPath, [AUFTRAG, "plane", "plaene/gibt-es-nicht"]).status, EXIT_AUFRUF);
});

test("plane: eine Owner-Entscheidung im Bericht ohne Eintrag in ownerAufgaben endet mit Exit 4 und nennt den Befund", { timeout: LAUF_FRIST_MS }, (context) => {
  const mitOwner = bericht(GRUPPEN[0].nummern, { S1: { ownerEntscheidung: { text: "Der Owner entscheidet die Frist", fundstelle: "pitch.md, ## Problem" } } });
  const schnitt = alsJson({ schnitt: schnittliste(), antworten: [] });
  const lauf = plane(context, { "erkunder|## Erkundung|S1": [mitOwner], "planer|## Befunde": [schnitt] });
  exit(lauf, EXIT_BEFUNDE);
  assert.ok(planungsBericht(lauf).befunde.offen.some((befund) => befund.includes("ist laut Erkundung Sache eines Owners und fehlt in ownerAufgaben")));
  assert.equal(existsSync(phaseDatei(lauf)), false);
});

test("plane: „Pitch ändern“ geht einmal an den Planer zurück und endet danach mit Exit 4", { timeout: LAUF_FRIST_MS }, (context) => {
  const pitch = "Pitch ändern: Soll S3 entfallen? (pitch.md, ## Problem)\nEmpfehlung: nein";
  const lauf = plane(context, { "planer|## Gliederung": [pitch], "planer|## Befunde": [pitch] });
  exit(lauf, EXIT_BEFUNDE);
  assert.equal(aufrufe(lauf, "planer", "## Befunde").length, 1);
  assert.equal(existsSync(phaseDatei(lauf)), false);
});

test("plane: planung.json enthält Ausweg, falsche Angabe, zurückgewiesenen Befund mit beiden Texten und Altfunktion-Umbau je Datei", { timeout: LAUF_FRIST_MS }, (context) => {
  const ausweg = "nicht gefunden, weil keine Datei den Stil vorgibt";
  const falsch = { nummer: "S1", datei: ROUTE, grund: "die Route speichert nichts selbst", fundstelle: `${ROUTE}:10` };
  const altfunktionen = [{ datei: HINWEIS, funktion: "setzeHinweis", von: 6, bis: 9 }];
  const prueferText = "a2 braucht den Code aus a1";
  const antwort = `trifft nicht zu, weil a2 nur die Bestätigung prüft (${ROUTE}:5)`;
  const lauf = plane(context, {
    "erkunder|## Erkundung|S4": [bericht(GRUPPEN[2].nummern, { S5: { vorbild: ausweg } })],
    "planer|## Zuschnitt": [alsJson({ schnitt: schnittliste({ umbau: { altfunktionen }, erster: { falscheAngaben: [falsch] } }) })],
    "pruefer-planung|## Prüfung": jePruefer({ ...GRUEN_PRUEFLISTE, befunde: { "allein-gruen:a2": prueferText } }),
    "planer|## Befunde": [alsJson({ schnitt: schnittliste({ umbau: { altfunktionen }, erster: { falscheAngaben: [falsch] } }), antworten: [{ schluessel: "allein-gruen:a2", antwort }] })],
  });
  exit(lauf, EXIT_GRUEN);
  const beleg = planungsBericht(lauf);
  assert.ok(beleg.annahmen.includes(`Annahme S5: ${ausweg}`));
  assert.ok(beleg.annahmen.some((annahme) => annahme.includes(`Widerspruch zur Erkundung S1 ${ROUTE}: ${falsch.grund}`)));
  assert.deepEqual(beleg.befunde.zurueckgewiesen, [{ schluessel: "allein-gruen:a2", befund: prueferText, antwort }]);
  assert.deepEqual(beleg.arten, { funktionen: 3, umbauten: 0, altfunktionUmbauten: 1, altfunktionUmbautenJeDatei: { [HINWEIS]: 1 } });
  assert.ok(gruppenPruefung(lauf, "S1").eingabe.includes("- falsche-angabe:a1:S1:src/routes/api-onboard.js"));
  assert.ok(gruppenPruefung(lauf, "S5").eingabe.includes("- ausweg:S5:vorbild"));
});

test("plane: die Fortsetzungen nennen Quote und Urteil aus einem festen Protokoll", (context) => {
  const zeilen = [
    { type: "user", timestamp: "2026-10-13T10:00:00.000Z", message: { content: "## Gliederung" } },
    { type: "assistant", timestamp: "2026-10-13T10:01:00.000Z", message: { id: "a", usage: { input_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 990 } } },
    { type: "user", timestamp: "2026-10-13T10:05:00.000Z", message: { content: [{ type: "text", text: "## Zuschnitt" }] } },
    { type: "assistant", timestamp: "2026-10-13T10:06:00.000Z", message: { id: "b", usage: { input_tokens: 5, cache_read_input_tokens: 950, cache_creation_input_tokens: 2000, cache_creation: { ephemeral_1h_input_tokens: 2000, ephemeral_5m_input_tokens: 0 } } } },
    { type: "user", timestamp: "2026-10-13T10:06:30.000Z", message: { content: [{ type: "tool_result", tool_use_id: "w", content: "x" }] } },
    { type: "assistant", timestamp: "2026-10-13T10:07:00.000Z", message: { id: "c", usage: { input_tokens: 5, cache_read_input_tokens: 2955, cache_creation_input_tokens: 40 } } },
    { type: "user", timestamp: "2026-10-13T12:07:00.000Z", message: { content: "## Befunde" } },
    { type: "assistant", timestamp: "2026-10-13T12:08:00.000Z", message: { id: "d", usage: { input_tokens: 3000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
  ];
  const ort = probeDirectory(context, { "planer.jsonl": `${zeilen.map((zeile) => JSON.stringify(zeile)).join("\n")}\n` });
  assert.deepEqual(fortsetzungen(join(ort, "planer.jsonl")), [
    { pauseS: 300, kontextVorher: 1000, cacheRead: 950, cacheWrite: 2000, cacheWrite1h: 2000, cacheWrite5m: 0, input: 5, quote: 0.95, urteil: "wirkt" },
    { pauseS: 7260, kontextVorher: 3000, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, cacheWrite5m: 0, input: 3000, quote: 0, urteil: "wirkt nicht" },
  ]);
});
