import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { UMBAU_AUSWEG } from "../../tools/auftrag/format.mjs";
import { nummernImOrdner } from "../../tools/auftrag/planung/nummern.mjs";
import { auftragAusSchnitt, entwurfFuer } from "../../tools/auftrag/planung/zusammensetzen.mjs";
import { mitErsatzWerkzeugen } from "./ersatz-werkzeuge.js";
import { NACHRICHTEN_MODUS, NOTFRIST_MS, nachrichtenImTranskript } from "./nachrichten-ersatz.js";
import { REPO_ROOT, isolatedEnvironment, probeDirectory, probeRepository } from "./probe-repo.js";

const SKILL = join(REPO_ROOT, ".claude/skills/pitch");
const KOPIEN = { "beispiel.md": "pitch.md", "design-beispiel.md": "design.md", "sicherheit-beispiel.md": "sicherheit.md" };
const TEAM_DATEIEN = [".claude/agents/planer.md", ".claude/agents/erkunder.md", ".claude/agents/pruefer-planung.md", ".claude/agents/entwurf.md", ".claude/skills/pitch/phase-vorlage.md"];
export const KENNUNG = "P-001-eigene-nummer";
export const ORDNER = `plaene/${KENNUNG}`;
export const ROUTE = "src/routes/api-onboard.js";
export const HINWEIS = "src/callee-is-owner.js";
export const BESTEHENDER_TEST = "test/anrufe/anrufreserve.test.js";
export const INDIREKTER_TEST = "test/anrufe/indirekt.test.js";
const DATEIKARTE = "### Dateikarte\n\n```json\n";
export const FUNDSTELLE = `${ROUTE}:1`;
export const LOESUNG = "## Lösung";
export const LAUF_FRIST_MS = 240_000;
const AUSFUEHRBAR = 0o755;
const ALTFUNKTIONEN_ZEILE = /^## Altfunktionen\n.*$/mu;
export { BIS_ZUM_ABBRUCH, MIT_DEM_ERGEBNIS } from "./nachrichten-ersatz.js";
const TAKT_MS = 20;

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
export const HINTERLEGEN_NUMMERN = ["S1", "S7", "T2"];
export const GRUPPEN = [
  { nummern: [...HINTERLEGEN_NUMMERN, "S2", "S3", "S6", "T1"], eingang: "POST /api/self-service/private-number und /confirm", ueberschriften: [LOESUNG], fragen: ["Wo wird die Nummer gespeichert?"] },
  { nummern: ["S4", "S5", "B1"], eingang: "place_call", ueberschriften: ["## Fehlerfälle"], fragen: [] },
];
const ANRUF_NUMMERN = new Set(GRUPPEN[1].nummern);

const ERSATZ_CLAUDE = `#!${process.execPath}
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
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
const zug = (name) => "zug-" + name.replace(/[^A-Za-z0-9]/g, "_") + "-";
for (;;) { try { mkdirSync(join(ort, zug(schluessel) + stelle)); break; } catch { stelle += 1; } }
writeFileSync(join(ort, zug(schluessel) + stelle, "waechter"), String(process.ppid));
const start = Date.now();
const eintrag = folge[stelle];
const art = typeof eintrag === "object" && eintrag !== null ? eintrag : { text: eintrag };
if (art.warte) await new Promise((fertig) => setTimeout(fertig, art.warte));
if (art.schreibe) writeFileSync(join(process.cwd(), art.schreibe), "geändert\\n");
appendFileSync(join(ort, "protokoll.jsonl"), JSON.stringify({ agent, sitzung: resume ?? wert("--session-id"), resume: resume !== undefined, ueberschrift, eingabe, start, ende: Date.now() }) + "\\n");
let zurueckgehalten = null;
const melde = (zeile) => {
  const ausgabe = JSON.stringify(zeile) + "\\n";
  if (zurueckgehalten === null) process.stdout.write(ausgabe);
  else zurueckgehalten += ausgabe;
};
if (eintrag === undefined) { process.stderr.write("keine weitere Antwort für " + schluessel); process.exit(1); }
if (art.absturz) { process.stderr.write(art.absturz.fehler); process.exit(art.absturz.exit); }
if (art.limit) {
  melde({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: Math.ceil(Date.now() / 1000) + 1 } });
  melde({ type: "result", is_error: true, result: "limit reached" });
  process.exit(1);
}
for (let runde = 0; art.stillstand && runde < 3; runde += 1) {
  melde({ type: "assistant", message: { content: [{ type: "tool_use", id: "wiederholt", name: "Bash", input: { command: "ls" } }] } });
  melde({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "wiederholt", content: "gleich" }] } });
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
const tokenDatei = join(ort, "token.json");
const tokenWerte = existsSync(tokenDatei) ? JSON.parse(readFileSync(tokenDatei, "utf8")) : null;
const tokenWert = tokenWerte?.[agent + "|" + ueberschrift + "|" + merkmal] ?? tokenWerte?.[agent + "|" + ueberschrift] ?? tokenWerte?.[agent];
${NACHRICHTEN_MODUS}
const transkript = () => transkriptDatei(process.env.CLAUDE_CONFIG_DIR, resume ?? wert("--session-id"));
const beendet = (datei) => { try { process.kill(Number(readFileSync(datei, "utf8")), 0); return false; } catch (fehler) { return fehler.code === "ESRCH"; } };
const waechterVon = (anderer) => readdirSync(ort).filter((name) => name.startsWith(zug(anderer))).map((name) => join(ort, name, "waechter"));
const nachDemEndeVon = async (anderer) => {
  for (const frist = Date.now() + ${NOTFRIST_MS}; Date.now() < frist; await pause(${TAKT_MS})) {
    const waechter = waechterVon(anderer);
    if (waechter.length > 0 && waechter.every((datei) => existsSync(datei) && beendet(datei))) return;
  }
};
if (Array.isArray(tokenWert)) {
  await schreibeNachrichten(tokenWert, { kennung: schluessel + "-" + stelle, transkript, melde, text, mitDemErgebnis: () => { zurueckgehalten = ""; }, warteAuf: nachDemEndeVon });
} else {
  if (tokenWerte !== null) appendFileSync(transkript(), JSON.stringify({ type: "assistant", message: { id: schluessel + "-" + stelle, usage: { input_tokens: tokenWert ?? 0 } } }) + "\\n");
  melde({ type: "assistant", message: { id: "m" + start, content: [{ type: "text", text }], usage: { input_tokens: 1 } } });
}
melde({ type: "result", result: text });
if (zurueckgehalten !== null) process.stdout.write(zurueckgehalten);
`;

export const UEBER_ZWISCHENDATEI = {
  "test/anrufe/zwischen.js": `import { nimmAnruf } from "../../${HINWEIS}";\n\nexport const zwischen = nimmAnruf;\n`,
  [INDIREKTER_TEST]: 'import { zwischen } from "./zwischen.js";\n\nzwischen("x");\n',
};

export function hinweisInDerDateikarte(eingabe) {
  const [, ab] = eingabe.split(DATEIKARTE);
  assert.ok(ab, `die Nachricht enthält keine Dateikarte:\n${eingabe}`);
  const { testsGesamt, tests } = JSON.parse(ab.split("\n```")[0]).find(({ datei }) => datei === HINWEIS);
  return { testsGesamt, tests };
}

export function mitUmbauZeilen(pitch, namen) {
  return pitch.replace(ALTFUNKTIONEN_ZEILE, `## Altfunktionen\n${namen.map((name) => `- Umbau: \`${name}\``).join("\n")}`);
}

export function geaenderteDateien(dateien) {
  return `\n## Geänderte Dateien\n\n${dateien.map((datei) => `- \`${datei}\``).join("\n")}\n`;
}

export function mitGeaendertenDateien(wurzel, dateien) {
  appendFileSync(join(wurzel, ORDNER, "pitch.md"), geaenderteDateien(dateien));
}

export function alsJson(wert) {
  return `Antwort.\n\n\`\`\`json\n${JSON.stringify(wert, null, 2)}\n\`\`\``;
}

export function stelle(rolle, datei, ort) {
  return { rolle, datei, ...ort };
}

function angabenVon(nummer) {
  const anruf = ANRUF_NUMMERN.has(nummer);
  const eingang = anruf ? stelle("eingang", HINWEIS, { funktion: "nimmAnruf", von: 1, bis: 4 }) : stelle("eingang", ROUTE, HINTERLEGEN_NUMMERN.includes(nummer) ? { funktion: "hinterlege", von: 2, bis: 4 } : { funktion: "bestaetige", von: 5, bis: 7 });
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

export function angaben(nummer, ueberschrieben = {}) {
  const { rolle, ...rest } = angabenVon(nummer);
  return rolle === "wirkung" ? { ...rest, ...ueberschrieben } : rest;
}

export function bericht(nummern, ueberschrieben = {}, hinweise = []) {
  return alsJson({ nummern: Object.fromEntries(nummern.map((nummer) => [nummer, angaben(nummer, ueberschrieben[nummer])])), hinweise });
}

export function auftrag(id, bereich, { prueft, abnahme, abhaengigVon, ...zusatz }) {
  return { id, art: "funktion", ziel: `Ziel ${id}`, bereich, erwarteteDateien: [bereich, abnahme], vorbild: bereich, abnahme, erwarteterFehler: "bestaetigt", wasDarfNiePassieren: [], prueft, abhaengigVon, eingang: "erreicht", ...zusatz };
}

const UMBAU = { id: "a0", art: "umbau", ziel: "Zieh die Prüfung heraus", bereich: HINWEIS, abnahme: BESTEHENDER_TEST, vorbild: HINWEIS, prueft: UMBAU_AUSWEG, erwarteteDateien: [HINWEIS, BESTEHENDER_TEST], altfunktionen: [], abhaengigVon: [] };

export function schnittliste({ umbau = {}, erster = {}, ...oben } = {}) {
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

export const ENTWURF_TEXT = {
  [ROUTE]: "Grundlage: design.md, Lösung\nStatus `bestaetigt` setzen.\nFehlerfälle: SMS-Fehler: Status bleibt",
  [HINWEIS]: "Grundlage: design.md, Lösung\nliest bestaetigt\nFehlerfälle: keine",
};
export const ENTWURF_ROUTE = alsJson({ entwurf: ENTWURF_TEXT[ROUTE] });
export const ENTWURF_HINWEIS = alsJson({ entwurf: ENTWURF_TEXT[HINWEIS] });
export const GRUEN_PRUEFLISTE = { pruefliste: true, fundstelle: FUNDSTELLE };
const NACHFRAGEN_JE_FALL = 1;
export const WEGPRUEFUNGEN = GRUPPEN.length + NACHFRAGEN_JE_FALL;

function antworten(grund, ueberschrieben = {}) {
  return { ...grund, ...ueberschrieben };
}

export function planOrdner(context) {
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

function ohneUmbau(auftraege) {
  return auftraege.filter(({ id }) => id !== UMBAU.id).map((eintrag) => ({ ...eintrag, abhaengigVon: eintrag.abhaengigVon.filter(({ id }) => id !== UMBAU.id) }));
}

export function phaseFuer(wurzel, umbau) {
  const { soll } = nummernImOrdner(join(wurzel, ORDNER));
  const { auftraege } = schnittliste({ umbau });
  const eintraege = umbau === undefined ? ohneUmbau(auftraege) : auftraege;
  const entwurf = Object.fromEntries(Object.entries(ENTWURF_TEXT).map(([bereich, text]) => [bereich, entwurfFuer(text, eintraege.filter((eintrag) => eintrag.bereich === bereich))]));
  return { phase: KENNUNG, entwurf, auftraege: eintraege.map((eintrag) => auftragAusSchnitt(eintrag, soll, [])) };
}

export function plane(context, optionen) {
  const wurzel = planOrdner(context);
  const { argumente } = optionen;
  return planeIn(context, wurzel, { ...optionen, argumente: typeof argumente === "function" ? argumente(wurzel) : argumente });
}

function tokenUmgebung(ersatz, token) {
  if (token === undefined) return {};
  writeFileSync(join(ersatz, "token.json"), JSON.stringify(token));
  return { CLAUDE_CONFIG_DIR: join(ersatz, "konfiguration") };
}

export function planeIn(context, wurzel, { werkzeug, grund, ueberschrieben, argumente: aufruf, knotenArgumente = [], token, umgebung = {} }) {
  const ersatz = probeDirectory(context, { "antworten.json": JSON.stringify(antworten(grund, ueberschrieben)) });
  writeFileSync(join(ersatz, "claude.mjs"), ERSATZ_CLAUDE);
  chmodSync(join(ersatz, "claude.mjs"), AUSFUEHRBAR);
  const lauf = spawnSync(process.execPath, [...knotenArgumente, werkzeug, ...aufruf], { cwd: wurzel, encoding: "utf8", env: { ...isolatedEnvironment(), HERMES_CLAUDE: join(ersatz, "claude.mjs"), ...mitErsatzWerkzeugen(ersatz), ...tokenUmgebung(ersatz, token), ...umgebung }, timeout: LAUF_FRIST_MS });
  return { ...lauf, wurzel, ersatz };
}

function protokoll({ ersatz }) {
  const datei = join(ersatz, "protokoll.jsonl");
  return existsSync(datei) ? readFileSync(datei, "utf8").trim().split("\n").map((zeile) => JSON.parse(zeile)) : [];
}

export function nachrichtenJeAufruf({ ersatz, wurzel }, schluessel) {
  return nachrichtenImTranskript(join(ersatz, "konfiguration"), wurzel, schluessel);
}

export function aufrufe(lauf, agent, ueberschrift) {
  return protokoll(lauf).filter((eintrag) => eintrag.agent === agent && (ueberschrift === undefined || eintrag.ueberschrift === ueberschrift));
}

export function exit(lauf, erwartet) {
  assert.equal(lauf.status, erwartet, `${lauf.stdout}\n${lauf.stderr}`);
}
