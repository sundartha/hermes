#!/usr/bin/env node
// Aufraeum-Gate fuer den pre-commit-Hook: eslint-suppressions.json friert pro
// Datei UND Regel nur eine ANZAHL ein, keine Einzel-Fundstellen. Wird in einer
// Bestandsdatei ein alter Verstoss behoben und an anderer Stelle ein neuer
// derselben Regel eingebaut, bleibt die Zahl gleich - der neue Verstoss wird
// still geschluckt (siehe CLAUDE.md). Gegenmassnahme: eine vorgemerkte Datei,
// die noch Eintraege traegt, wird abgelehnt. Wer sie anfasst, raeumt vorher auf.
//
// DREI STUFEN (die zweite und dritte sind Verfeinerungen vom 2026-08-15, s.u.):
//   1. findSuppressedStagedFiles - welche vorgemerkte Datei traegt ueberhaupt
//      Eintraege und ist nicht auf der Altlast-Liste? (reine Auswahl)
//   2. findChangedFindings - hat sich an ihren UNGEFILTERTEN Lint-Befunden
//      durch die Aenderung etwas bewegt? Nur dann wird sie abgelehnt.
//   3. findPinMismatches - fuer eine Datei, die die Altlast-Liste ENTSCHULDIGT:
//      deckt sich ihr gepinnter findings-Wert noch mit der TATSAECHLICHEN,
//      ungefilterten Befundmenge der vorgemerkten Fassung? Weicht er ab
//      (mehr oder weniger), entschuldigt der Eintrag nichts mehr.
// Alle drei Stufen sind seiteneffektfrei und haengen an injizierten Nahten; der
// CLI-Teil (argv/git/eslint/exit) sitzt dahinter. Testbarkeit auf einer
// Attrappe statt der echten, ueber 600 Dateien grossen Unterdrueckungsdatei.
// Aufruf: node scripts/check-staged-suppressions.js <datei1> <datei2> ...
//         (Pfade repo-root-relativ, wie sie "git diff --name-only" liefert)
//
// ALTLAST-LISTE (eslint-legacy-exceptions.json, neben der Unterdrueckungsdatei):
// der EINZIGE Ausweg, wenn eine Bestandsdatei angefasst werden muss, deren
// Aufraeumen ein eigener Umbau waere. "git commit --no-verify" ist verboten -
// eine stille Umgehung macht das ganze Gate wertlos. Die Liste bildet
// Dateipfad -> { reason, date, findings } ab: reason nennt, warum die Datei
// noch nicht geraeumt ist, date (YYYY-MM-DD) wann die Ausnahme entstand,
// findings ist der PIN - die ungefilterte Befundmenge (Regel-Schluessel ->
// Anzahl, siehe Stufe 2/3) GENAU dieser Dateifassung. Fehlt eines der drei
// Felder oder ist es leer/kaputt, entschuldigt der Eintrag nichts - die Liste
// ist eine bewusste Ausnahme, kein Abstellgleis. Auf die Liste gehoert nur
// ECHTE Schuld; ist die Unterdrueckung eine Fehlklassifikation der Regel, wird
// die REGEL korrigiert (siehe .fortschritt.md, D9-D11).
//
// MECHANISCHE AENDERUNGEN (Eigentuemer-Entscheidung 2026-08-15): Stufe 1 allein
// ist zu grob - sie lehnt auch eine Umbenennung ab, die nichts verschlimmert,
// und macht damit das Aufraeumen fremder Schuld zum Preis jeder Beruehrung.
// Genau daraus entstehen neue Altlast-Eintraege. Deshalb Stufe 2: sind die
// UNGEFILTERTEN Lint-Befunde der Datei vor und nach der Aenderung identisch,
// ist BELEGT (nicht behauptet), dass die Aenderung mechanisch war - sie darf
// ohne Aufraeumen durch. Bewegt sich auch nur ein Befund, greift "wer anfasst,
// raeumt auf" wie bisher. Die Ratsche wird dadurch nicht schwaecher: neue,
// mehr oder andere Verstoesse fuehren unveraendert zur Ablehnung.
//
// DER PIN HAELT DEN WERT FEST (Eigentuemer-Entscheidung 2026-08-15): eine
// Altlast-Datei entschuldigt bisher PAUSCHAL, unabhaengig davon, wie viele
// Verstoesse sie traegt - eine ausgenommene Datei kann unbemerkt schlechter
// werden. Stufe 3 schliesst das: der Eintrag entschuldigt nur GENAU die
// gepinnte Befundmenge. Mehr Befunde sind ein neuer Verstoss und muessten
// sonst durchrutschen; weniger Befunde sind ein zu hoch stehender Pin - genau
// der Spielraum, in dem spaeter ein neuer Verstoss unbemerkt Platz faende
// (dieselbe Begruendung wie bei tallyDifferences oben). Beide Richtungen
// brechen den Eintrag. Wiederverwendet wird dieselbe Maschinerie wie Stufe 2:
// dieselbe ungefilterte Befund-Ermittlung (makeUnfilteredLinter mit leerer
// Unterdrueckungsdatei) und dieselbe Vergleichsfunktion (tallyDifferences).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SUPPRESSIONS_REL = "eslint-suppressions.json";
const LEGACY_EXCEPTIONS_REL = "eslint-legacy-exceptions.json";
// Leere Unterdrueckungsdatei (dieselbe, an der "npm run lint:strict" haengt):
// der Vergleich braucht die UNGEFILTERTE Sicht. Mit der echten Datei waere die
// Befundmenge einer Bestandsdatei per Konstruktion leer - dann saehe jede
// Aenderung mechanisch aus, und das Gate liesse alles durch.
const EMPTY_SUPPRESSIONS_REL = "eslint-suppressions.empty.json";
const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const PRUNE_COMMAND = "npx eslint --prune-suppressions";
const NO_VERIFY_COMMAND = "git commit --no-verify";
const LOG_PREFIX = "[check-staged-suppressions]";
// process.argv[0]=node, [1]=Skriptpfad - die eigentlichen Argumente beginnen danach.
const CLI_ARGS_OFFSET = 2;

function isNonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Kalenderdatum im Format YYYY-MM-DD. Date.parse faengt zusaetzlich, was zwar
// zur Form passt, aber kein Tag im Kalender ist (etwa 2026-02-31).
function isCalendarDate(value) {
  if (!isNonEmptyText(value) || !CALENDAR_DATE_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

// Der Pin: ein nicht-leeres Objekt, jede Anzahl eine positive ganze Zahl. Genau
// die Form, die findingTally() unten erzeugt (Schluessel -> Anzahl).
function isWellFormedFindings(findings) {
  if (findings === null || typeof findings !== "object" || Array.isArray(findings)) return false;
  const counts = Object.values(findings);
  if (counts.length === 0) return false;
  return counts.every(isPositiveInteger);
}

// Entschuldigt dieser Altlast-Eintrag die Datei? Nur mit Grund UND Datum UND
// einem wohlgeformten Pin - ein halb gefuehrter Eintrag ist ein Abstellgleis
// und zaehlt nicht. Ob der Pin noch zur TATSAECHLICHEN Befundmenge passt,
// prueft diese Funktion nicht (das braucht eslint, ist also nicht rein) -
// dafuer siehe Stufe 3, findPinMismatches.
function excusesLegacy(entry) {
  if (!entry) return false;
  return (
    isNonEmptyText(entry.reason) && isCalendarDate(entry.date) && isWellFormedFindings(entry.findings)
  );
}

// Welche der vorgemerkten Dateien tragen noch Eintraege in den
// Unterdrueckungen? suppressions: geparstes eslint-suppressions.json
// (Datei -> Regelname -> { count }). legacyExceptions: geparste Altlast-Liste
// (Datei -> { reason, date, findings }), siehe Kopfkommentar. Liefert pro
// Treffer die Datei und ihre Regeln samt Anzahl, in der Reihenfolge der Regeln
// aus der Vorlage.
export function findSuppressedStagedFiles({
  stagedFiles,
  suppressions,
  legacyExceptions = {},
}) {
  const offenders = [];
  for (const file of stagedFiles) {
    if (excusesLegacy(legacyExceptions[file])) continue;
    const rulesForFile = suppressions[file];
    if (!rulesForFile) continue;
    const ruleCounts = Object.entries(rulesForFile).map(([rule, entry]) => ({
      rule,
      count: entry.count,
    }));
    if (ruleCounts.length > 0) offenders.push({ file, ruleCounts });
  }
  return offenders;
}

// ---- Stufe 2: hat sich an den Befunden ueberhaupt etwas bewegt? -------------

// Ein Befund wird ueber Regel + Meldung identifiziert, OHNE Zeile und Spalte:
// eine eingefuegte Zeile verschiebt jede Fundstelle darunter und wuerde eine
// rein mechanische Aenderung sonst als Verschlechterung ausweisen, waehrend die
// Meldung die Identitaet des Befundes traegt (welches Symbol, welche Schwelle,
// welche Zahl). Verglichen wird als MULTIMENGE (Schluessel -> Anzahl): zweimal
// derselbe Befund ist nicht dasselbe wie einmal.
const FINDING_KEY_SEPARATOR = " :: ";
const MAX_REPORTED_DIFFERENCES = 3;

export function findingTally(messages) {
  const tally = new Map();
  for (const message of messages) {
    const key = `${message.ruleId}${FINDING_KEY_SEPARATOR}${message.message}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  return tally;
}

// Was hat sich zwischen zwei Befundmengen bewegt? Beide Richtungen zaehlen.
// Ein Befund WENIGER ist zwar eine Verbesserung, laesst aber die eingefrorene
// Anzahl in eslint-suppressions.json zu hoch stehen - genau der Spielraum, in
// dem spaeter ein neuer Verstoss unbemerkt Platz faende. Wer Verstoesse behebt,
// zieht die Datei mit --prune-suppressions nach; dann ist die Menge wieder
// gleich. Nur IDENTITAET ist der Freifahrtschein.
export function tallyDifferences(before, after) {
  const differences = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const countBefore = before.get(key) ?? 0;
    const countAfter = after.get(key) ?? 0;
    if (countBefore !== countAfter) {
      differences.push({ key, countBefore, countAfter });
    }
  }
  return differences;
}

// Getrennt wird nur am ERSTEN Vorkommen: eine Regel-ID enthaelt das Trennzeichen
// nie, eine Meldung koennte es enthalten - sonst waere der Bericht abgeschnitten.
function describeDifference({ key, countBefore, countAfter }) {
  const separatorIndex = key.indexOf(FINDING_KEY_SEPARATOR);
  const rule = key.slice(0, separatorIndex);
  const message = key.slice(separatorIndex + FINDING_KEY_SEPARATOR.length);
  return `${countBefore} -> ${countAfter}  ${rule}: ${message}`;
}

function describeDifferences(differences) {
  const shown = differences
    .slice(0, MAX_REPORTED_DIFFERENCES)
    .map((difference) => `Befunde bewegt: ${describeDifference(difference)}`);
  const hidden = differences.length - shown.length;
  return hidden > 0 ? [...shown, `... und ${hidden} weitere`] : shown;
}

// Warum geht diese Datei NICHT als mechanisch durch - oder null, wenn sie es
// tut. Der Fehlerfall faellt bewusst hierher: laesst sich eine Datei nicht
// linten (Syntaxfehler, unbekannte Endung, kein Stand in HEAD), gibt es keinen
// Beleg fuer "mechanisch" - fail-closed abgelehnt statt durchgewunken.
async function reasonsToReject(file, readFindings) {
  let differences;
  try {
    const { before, after } = await readFindings(file);
    differences = tallyDifferences(findingTally(before), findingTally(after));
  } catch (err) {
    return [`nicht pruefbar (fail-closed): ${err.message}`];
  }
  return differences.length === 0 ? null : describeDifferences(differences);
}

// Von den Kandidaten der Stufe 1 bleiben die uebrig, deren Befundmenge sich
// bewegt hat. readFindings ist die Naht: Datei -> { before, after }, jeweils
// die Liste der eslint-Meldungen. Wer sie liefert (git+eslint oder eine
// Attrappe), entscheidet der Aufrufer.
export async function findChangedFindings({ candidates, readFindings }) {
  const offenders = [];
  for (const candidate of candidates) {
    const reasons = await reasonsToReject(candidate.file, readFindings);
    if (reasons) offenders.push({ ...candidate, reasons });
  }
  return offenders;
}

// ---- Stufe 3: gilt der Pin noch? --------------------------------------------

// Der Pin aus dem Altlast-Eintrag, in derselben Multimengen-Form wie
// findingTally() sie erzeugt - damit tallyDifferences beide Seiten vergleichen
// kann, ohne einen zweiten Vergleich zu brauchen.
function tallyFromFindings(findings) {
  return new Map(Object.entries(findings));
}

// Umkehrung: aus einer gemessenen Multimenge den findings-Block fuer die
// Altlast-Liste bauen - sortiert, damit die Ausgabe reproduzierbar ist und der
// Entwickler sie unveraendert einsetzen kann.
function findingsFromTally(tally) {
  const findings = {};
  for (const key of [...tally.keys()].sort()) findings[key] = tally.get(key);
  return findings;
}

// Bleibt der Pin einer entschuldigten Datei zur TATSAECHLICHEN, ungefilterten
// Befundmenge ihrer vorgemerkten (staged) Fassung deckungsgleich? Geprueft
// werden nur Dateien mit strukturell gueltigem Altlast-Eintrag (excusesLegacy);
// ohne gueltigen Pin gibt es nichts zu vergleichen - dieser Fall zaehlt schon
// als Stufe-1-Kandidat. readStagedFindings ist die Naht: Datei -> ungefilterte
// eslint-Meldungen ihrer vorgemerkten Fassung (dieselbe Quelle wie Stufe 2,
// siehe makeUnfilteredLinter). Beide Richtungen brechen den Eintrag - siehe
// Kopfkommentar "DER PIN HAELT DEN WERT FEST".
export async function findPinMismatches({ stagedFiles, legacyExceptions, readStagedFindings }) {
  const offenders = [];
  for (const file of stagedFiles) {
    const entry = legacyExceptions[file];
    if (!excusesLegacy(entry)) continue;
    const pin = tallyFromFindings(entry.findings);
    let actual;
    try {
      actual = findingTally(await readStagedFindings(file));
    } catch (err) {
      offenders.push({ file, reasons: [`nicht pruefbar (fail-closed): ${err.message}`] });
      continue;
    }
    const differences = tallyDifferences(pin, actual);
    if (differences.length === 0) continue;
    offenders.push({
      file,
      reasons: describeDifferences(differences),
      correctedFindings: findingsFromTally(actual),
    });
  }
  return offenders;
}

function formatOffender({ file, ruleCounts, reasons = [] }) {
  const rulesText = ruleCounts
    .map(({ rule, count }) => `${rule}: ${count}`)
    .join(", ");
  const reasonLines = reasons.map((reason) => `\n     ${reason}`).join("");
  return `  ${file} -> ${rulesText}${reasonLines}`;
}

// Der Ausweg gehoert in den Bericht, nicht nur in den Kopfkommentar: wer
// blockiert wird, liest diesen Text und sonst nichts. Fehlt der zweite Weg,
// greift er zum naechstliegenden Mittel - am 2026-08-13 ist genau so ein
// Commit still an der Ratsche vorbeigelaufen. Kurz halten, das liest jemand
// im Terminal.
//
// Der zweite Weg steht bewusst mit seinem Preis da: ohne die Freigabe-Zeile
// liest ihn ein blockierter Agent als Selbstbedienung und traegt sich ein,
// statt aufzuraeumen (Eigentuemer-Entscheidung 2026-08-13, .fortschritt.md D11).
const WAY_OUT_LINES = [
  "Eine Aenderung, die die Befundmenge NICHT bewegt, geht ohne Aufraeumen durch -",
  "hier ist sie bewegt (Zeilen oben).",
  `Aufraeumen (Normalfall): Verstoesse beheben, danach: ${PRUNE_COMMAND}`,
  `Waere das Aufraeumen ein eigener Umbau: die Datei in ${LEGACY_EXCEPTIONS_REL}`,
  "eintragen, mit reason (warum sie liegen bleibt) und date (YYYY-MM-DD).",
  "Dieser Eintrag braucht die Freigabe des Eigentuemers - kein Bau-Agent setzt",
  "einen, um weiterzukommen. Der Grund muss sagen, WARUM das Aufraeumen",
  "gefaehrlich waere, nicht dass es Arbeit ist.",
  `"${NO_VERIFY_COMMAND}" ist keine Option.`,
];

function logLine(text) {
  console.error(`${LOG_PREFIX} ${text}`);
}

function printReport(offenders) {
  console.error("");
  logLine("Commit abgebrochen: folgende vorgemerkte Dateien tragen");
  logLine(`noch Eintraege in ${SUPPRESSIONS_REL} UND ihre Lint-Befunde`);
  logLine("haben sich durch die Aenderung bewegt:");
  for (const offender of offenders) console.error(formatOffender(offender));
  console.error("");
  for (const line of WAY_OUT_LINES) logLine(line);
}

// Der Pin-Bericht (Stufe 3). Der korrigierte findings-Block wird fertig als
// JSON ausgegeben - nicht als Anleitung: der neue Wert soll bewusst uebernommen
// werden, nicht von Hand nachgetippt oder erraten.
const CORRECTED_FINDINGS_JSON_INDENT = 2;
const CORRECTED_FINDINGS_LINE_PREFIX = "       ";

function formatCorrectedFindings(correctedFindings) {
  const json = JSON.stringify(correctedFindings, null, CORRECTED_FINDINGS_JSON_INDENT);
  const lines = json.split("\n");
  const indentedLines = lines.map((line) => `${CORRECTED_FINDINGS_LINE_PREFIX}${line}`);
  return indentedLines.join("\n");
}

function formatPinOffender({ file, reasons = [], correctedFindings }) {
  const reasonLines = reasons.map((reason) => `\n     ${reason}`).join("");
  const correctedBlock = correctedFindings
    ? `\n     Korrigierter findings-Block fuer ${LEGACY_EXCEPTIONS_REL}:\n${formatCorrectedFindings(correctedFindings)}`
    : "";
  return `  ${file}${reasonLines}${correctedBlock}`;
}

const PIN_WAY_OUT_LINES = [
  "Ein Altlast-Eintrag entschuldigt nur GENAU die gepinnte Befundmenge - sie hat",
  "sich bewegt (Zeilen oben). Weniger Befunde brechen genauso wie mehr: ein zu",
  "hoch stehender Pin ist der Spielraum, in dem spaeter ein neuer Verstoss",
  "unbemerkt Platz faende.",
  `Ersetze den findings-Block dieser Datei in ${LEGACY_EXCEPTIONS_REL} durch den`,
  "oben ausgegebenen, fertigen JSON-Block.",
  `"${NO_VERIFY_COMMAND}" ist keine Option.`,
];

function printPinMismatchReport(offenders) {
  console.error("");
  logLine("Commit abgebrochen: folgende Dateien auf der Altlast-Liste tragen");
  logLine("einen Pin, der nicht mehr zur tatsaechlichen, ungefilterten");
  logLine("Befundmenge ihrer vorgemerkten Fassung passt:");
  for (const offender of offenders) console.error(formatPinOffender(offender));
  console.error("");
  for (const line of PIN_WAY_OUT_LINES) logLine(line);
}

function readRepoFile(relativePath) {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

// Einlesen der Altlast-Liste. Der Leser haengt an einem Parameter, damit der
// Pfad "Liste wird geladen" ohne Dateisystem pruefbar ist. Fehlt die Datei
// oder ist sie kaputt, wirft das Einlesen - der CLI-Teil bricht dann
// fail-closed ab, statt stillschweigend ohne Liste weiterzulaufen.
export function loadLegacyExceptions(readText = readRepoFile) {
  return JSON.parse(readText(LEGACY_EXCEPTIONS_REL));
}

// Gelesen wird der INHALT aus git, nicht der Arbeitsbaum: "HEAD:<pfad>" ist der
// Stand VOR der Aenderung, ":<pfad>" der vorgemerkte Stand NACH ihr. Der
// Arbeitsbaum kann von beidem abweichen - wer ihn lintet, misst das Falsche.
const HEAD_CONTENT_PREFIX = "HEAD:";
const STAGED_CONTENT_PREFIX = ":";
// 32 MiB: eine Quelldatei bleibt weit darunter, der Node-Standard (1 MiB) nicht
// zwingend. Ein Ueberlauf wuerde werfen und fail-closed ablehnen.
const GIT_SHOW_MAX_BUFFER_BYTES = 33554432;

function readGitContent(revisionAndPath) {
  return execFileSync("git", ["show", revisionAndPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: GIT_SHOW_MAX_BUFFER_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Die Naht, an der eslint ins Gate kommt (exportiert fuer den Test): liefert
// eine Funktion (code, datei) -> Meldungen, UNGEFILTERT. eslint wird erst hier
// geladen (dynamischer Import): der Import kostet rund eine Sekunde, und die
// haeufigste Hook-Runde hat gar keinen Kandidaten.
export async function makeUnfilteredLinter() {
  const { ESLint } = await import("eslint");
  const eslint = new ESLint({
    cwd: REPO_ROOT,
    suppressionsLocation: resolve(REPO_ROOT, EMPTY_SUPPRESSIONS_REL),
  });
  return async function lintContent(code, file) {
    const results = await eslint.lintText(code, {
      filePath: file,
      warnIgnored: false,
    });
    if (results.length !== 1) {
      throw new Error(`eslint hat ${file} nicht gelintet (ignoriert oder unbekannte Endung)`);
    }
    // suppressedMessages zaehlt mit: was ein Marker versteckt, bliebe sonst
    // unsichtbar und koennte einen neuen Verstoss als mechanisch tarnen.
    const [result] = results;
    const messages = [...result.messages, ...(result.suppressedMessages ?? [])];
    const parseError = messages.find((message) => message.fatal);
    if (parseError) {
      throw new Error(`eslint kann ${file} nicht lesen: ${parseError.message}`);
    }
    return messages;
  };
}

async function makeGitFindingsReader() {
  const lintContent = await makeUnfilteredLinter();
  return async function readFindings(file) {
    const headCode = readGitContent(`${HEAD_CONTENT_PREFIX}${file}`);
    const stagedCode = readGitContent(`${STAGED_CONTENT_PREFIX}${file}`);
    return {
      before: await lintContent(headCode, file),
      after: await lintContent(stagedCode, file),
    };
  };
}

// Wie makeGitFindingsReader, aber nur die vorgemerkte Fassung: die Pin-Pruefung
// (Stufe 3) vergleicht gegen den Pin selbst, nicht gegen HEAD.
async function makeStagedFindingsReader() {
  const lintContent = await makeUnfilteredLinter();
  return async function readStagedFindings(file) {
    const stagedCode = readGitContent(`${STAGED_CONTENT_PREFIX}${file}`);
    return lintContent(stagedCode, file);
  };
}

async function runCli() {
  const stagedFiles = process.argv.slice(CLI_ARGS_OFFSET);
  if (stagedFiles.length === 0) return 0;
  const suppressions = JSON.parse(readRepoFile(SUPPRESSIONS_REL));
  const legacyExceptions = loadLegacyExceptions();
  const candidates = findSuppressedStagedFiles({ stagedFiles, suppressions, legacyExceptions });
  const pinCandidates = stagedFiles.filter((file) => excusesLegacy(legacyExceptions[file]));
  if (candidates.length === 0 && pinCandidates.length === 0) return 0;

  const changedOffenders =
    candidates.length === 0
      ? []
      : await findChangedFindings({ candidates, readFindings: await makeGitFindingsReader() });
  const pinOffenders =
    pinCandidates.length === 0
      ? []
      : await findPinMismatches({
          stagedFiles: pinCandidates,
          legacyExceptions,
          readStagedFindings: await makeStagedFindingsReader(),
        });

  if (changedOffenders.length === 0 && pinOffenders.length === 0) return 0;
  if (changedOffenders.length > 0) printReport(changedOffenders);
  if (pinOffenders.length > 0) printPinMismatchReport(pinOffenders);
  return 1;
}

const isMain =
  fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (isMain) {
  try {
    process.exit(await runCli());
  } catch (err) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ${err.message}`);
    process.exit(1);
  }
}
