#!/usr/bin/env node
// Vor-dem-Hochladen-Gate mit zwei Pruefungen ueber elevenlabs/:
//
// (1) PLATZHALTER: die Testdefinitionen unter elevenlabs/tests/ (Abnahme-
// kriterien A1-A10) duerfen keine <AUSFUELLEN: ...>-Platzhalter mehr tragen,
// sobald sie hochgeladen werden. Grund: A3 ist ein verify_absence-Test -
// stuende dort noch eine Platzhalter-Werkzeugkennung, waere die Abwesenheit
// GARANTIERT erfuellt, das Veto-Kriterium bestuende unabhaengig vom
// Agentenverhalten. Ein Katalog, der immer gruen ist, misst nichts.
//
// (2) VOKABULAR: Agentenkonfiguration und Testdefinitionen muessen dieselben
// dynamic-variable-Namen benutzen (siehe checkVariableVocabulary unten).
//
// elevenlabs/tests/templates/ ist ausgenommen: Vorlagen fuer neue
// Testdefinitionen duerfen Platzhalter tragen, sie sind keine Abnahmekriterien.
//
// Reine, seiteneffektfreie Pruef-Funktion; der CLI-Teil (exit/console) sitzt
// hinter dem main-Guard. Nur Node-Builtins, kein Dependency, kein Build-Step.
// Aufruf:  node scripts/check-elevenlabs-tests.js   (prueft, exit 0/1)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TEST_DIR_REL = "elevenlabs/tests";
const AGENT_CONFIG_REL = "elevenlabs/agent_configs/outbound-agent.template.json";
const TEMPLATES_DIR_NAME = "templates";
const JSON_EXT = ".json";
const PLACEHOLDER_PATTERN = /<AUSFUELLEN:[^>]*>/g;
// ElevenLabs' dynamic-variable-Syntax: "double curly braces {{variable_name}}"
// (https://elevenlabs.io/docs/conversational-ai/customization/personalization/dynamic-variables,
// woertlich zitiert in outbound-agent.template.json, _platzhalter_konvention).
const VARIABLE_PATTERN = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;
const DYNAMIC_VARIABLES_KEY = "dynamic_variables";
// Schluessel-Praefix der reinen Entwickler-Doku in diesen JSON-Dateien -
// woertlich in outbound-agent.template.json: "kein Teil des ElevenLabs-API-
// Schemas". Solche Bloecke ERKLAEREN die Konvention und enthalten deshalb
// Beispiel-Tokens ({{variablen_name}}, {{sprache}}), die keine echten
// Variablen sind; sie werden beim Vokabular-Abgleich uebersprungen.
const DOC_KEY_PREFIX = "_";
const PATH_ROOT = "$";
const LOG_PREFIX = "[check-elevenlabs-tests]";

// Listet alle .json-Dateien unterhalb von absDir (rel. zu rootDir), rekursiv,
// ausser unterhalb eines Verzeichnisses namens TEMPLATES_DIR_NAME - dort
// duerfen Platzhalter stehen (Vorlagen, keine Abnahmekriterien).
function listJsonFiles(absDir, rootDir) {
  const found = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const absPath = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === TEMPLATES_DIR_NAME) continue;
      found.push(...listJsonFiles(absPath, rootDir));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(JSON_EXT)) {
      found.push(relative(rootDir, absPath));
    }
  }
  return found;
}

// Durchsucht einen geparsten JSON-Wert rekursiv nach Platzhaltern und traegt
// jeden Fund mit seinem Feldpfad (JSONPath-artig, $.a.b[0]) in findings ein.
function walkForPlaceholders(value, path, findings) {
  if (typeof value === "string") {
    for (const match of value.matchAll(PLACEHOLDER_PATTERN)) {
      findings.push({ path, marker: match[0] });
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      walkForPlaceholders(item, `${path}[${index}]`, findings);
    });
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walkForPlaceholders(child, `${path}.${key}`, findings);
    }
  }
}

// Liefert die Schluessel eines dynamic_variables-Objekts (Map string->any laut
// elevenlabs/tests/README.md, Feldtabelle). Alles andere hat keine Schluessel,
// die eine Variable deklarieren -- dann leer.
function declaredVariableNames(value) {
  const isPlainObject =
    value !== null && typeof value === "object" && !Array.isArray(value);
  return isPlainObject ? Object.keys(value) : [];
}

// Laeuft die Eintraege eines Objekts ab: Doku-Schluessel (DOC_KEY_PREFIX)
// ueberspringen, unter dynamic_variables zusaetzlich die Schluessel als
// deklarierte Variablen aufnehmen, sonst normal weiter absteigen.
function walkObjectForVariables(objectValue, acc) {
  for (const [key, child] of Object.entries(objectValue)) {
    if (key.startsWith(DOC_KEY_PREFIX)) continue;
    if (key === DYNAMIC_VARIABLES_KEY) {
      for (const name of declaredVariableNames(child)) acc.declared.add(name);
    }
    walkForVariables(child, acc);
  }
}

// Sammelt rekursiv die Variablennamen eines geparsten JSON-Werts, getrennt nach
// Art: referenced = Vorkommen von {{name}} in Strings, declared = Schluessel
// eines dynamic_variables-Objekts.
function walkForVariables(value, acc) {
  if (typeof value === "string") {
    for (const match of value.matchAll(VARIABLE_PATTERN)) {
      acc.referenced.add(match[1]);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkForVariables(item, acc);
    return;
  }
  if (value === null || typeof value !== "object") return;
  walkObjectForVariables(value, acc);
}

function collectVariables(parsed) {
  const acc = { referenced: new Set(), declared: new Set() };
  walkForVariables(parsed, acc);
  return acc;
}

// Liest und parst eine JSON-Datei; wirft nie weiter, sondern liefert entweder
// { parsed } oder { error } als fertigen Findings-Text (fail-closed).
function readJsonFile(rootDir, relFile) {
  try {
    return { parsed: JSON.parse(readFileSync(join(rootDir, relFile), "utf8")) };
  } catch (err) {
    return { error: `${relFile}: nicht als JSON lesbar (${err.message})` };
  }
}

// Vereinigt die Variablennamen aller Testdefinitionen zu einer Menge: fuer den
// Abgleich zaehlt, ob IRGENDEIN Test die Variable kennt, nicht welcher.
function unionOfVariableNames(testVariablesByFile) {
  const names = new Set();
  for (const fileNames of testVariablesByFile.values()) {
    for (const name of fileNames) names.add(name);
  }
  return names;
}

// Gleicht das Platzhalter-Vokabular beider Seiten ab, in BEIDE Richtungen.
//
// Wo die Platzhalter stehen, ist belegt, nicht geraten: die Agentenkonfiguration
// REFERENZIERT sie als {{name}} in prompt/first_message (Beleg s.
// VARIABLE_PATTERN), eine Testdefinition SETZT sie im Schema-Feld
// dynamic_variables (elevenlabs/tests/README.md, Feldtabelle: "dynamic_variables
// | Map string->any, alle drei Typen", Quelle
// https://elevenlabs.io/docs/api-reference/tests/create) und darf sie zusaetzlich
// im Erwartungstext als {{name}} erwaehnen (so macht es a6 fuer owner_name).
// Testseitig zaehlen deshalb beide Arten als "kennt die Variable".
//
// Beide Abweichungen sind ein Befund:
//   - Konfiguration kennt sie, kein Test setzt sie -> im Testlauf bleibt der
//     Platzhalter unersetzt, der Test misst einen anderen Text als Produktion.
//   - Test kennt sie, Konfiguration nicht -> tote Variable, die nichts befuellt.
function checkVariableVocabulary(rootDir, testVariablesByFile) {
  const testVariables = unionOfVariableNames(testVariablesByFile);

  // Fehlt die Agentenkonfiguration, gibt es keine Gegenseite fuer den Abgleich.
  // Das ist genau dann ein Fund, wenn die Testdefinitionen ueberhaupt Variablen
  // benutzen: dann waere die Pruefung still ausgefallen, statt zu messen. Ohne
  // Variablen auf der Testseite gibt es schlicht nichts zu vergleichen - dann
  // schweigt der Abgleich, statt eine Abweichung zu behaupten.
  if (!existsSync(join(rootDir, AGENT_CONFIG_REL))) {
    if (testVariables.size === 0) return [];
    return [
      `Datei fehlt (fail-closed): ${AGENT_CONFIG_REL} - Vokabular-Abgleich nicht moeglich`,
    ];
  }
  const { parsed, error } = readJsonFile(rootDir, AGENT_CONFIG_REL);
  if (error) return [error];

  return vocabularyDiffFindings(
    collectVariables(parsed).referenced,
    testVariablesByFile,
  );
}

// Die beiden Richtungen des Abgleichs als Findings-Texte (Datei + Variablenname
// im Klartext, damit der Fund ohne Nachschlagen behebbar ist).
function vocabularyDiffFindings(configVariables, testVariablesByFile) {
  const testVariables = unionOfVariableNames(testVariablesByFile);
  const findings = [];
  for (const name of configVariables) {
    if (testVariables.has(name)) continue;
    findings.push(
      `${AGENT_CONFIG_REL}: {{${name}}} - Variable der Agentenkonfiguration, die keine Testdefinition setzt (${DYNAMIC_VARIABLES_KEY}) oder benutzt`,
    );
  }
  for (const [relFile, names] of testVariablesByFile) {
    for (const name of names) {
      if (configVariables.has(name)) continue;
      findings.push(
        `${relFile}: {{${name}}} - Variable der Testdefinition, die die Agentenkonfiguration nicht kennt (${AGENT_CONFIG_REL})`,
      );
    }
  }
  return findings;
}

// Prueft alle .json-Testdefinitionen unter elevenlabs/tests/ (ausser
// templates/) auf verbliebene <AUSFUELLEN: ...>-Platzhalter und gleicht danach
// ihr Platzhalter-Vokabular gegen die Agentenkonfiguration ab. Wirft nie an den
// Aufrufer weiter -- jedes erwartbare Problem (Platzhalter, Vokabular-
// Abweichung, kaputtes JSON, fehlende Datei/Verzeichnis) wird zu einem
// Findings-Eintrag (fail-closed). ok = keine Funde.
export function checkElevenlabsTests({ rootDir = REPO_ROOT } = {}) {
  const testDirAbs = join(rootDir, TEST_DIR_REL);
  if (!existsSync(testDirAbs)) {
    return {
      ok: false,
      findings: [`Verzeichnis fehlt (fail-closed): ${TEST_DIR_REL}`],
    };
  }

  const findings = [];
  const testVariablesByFile = new Map();
  for (const relFile of listJsonFiles(testDirAbs, rootDir)) {
    const { parsed, error } = readJsonFile(rootDir, relFile);
    if (error) {
      findings.push(error);
      continue;
    }
    const placeholders = [];
    walkForPlaceholders(parsed, PATH_ROOT, placeholders);
    for (const { path, marker } of placeholders) {
      findings.push(`${relFile}: ${path} - Platzhalter gefunden (${marker})`);
    }
    const { referenced, declared } = collectVariables(parsed);
    testVariablesByFile.set(relFile, new Set([...declared, ...referenced]));
  }

  findings.push(...checkVariableVocabulary(rootDir, testVariablesByFile));

  return { ok: findings.length === 0, findings };
}

// --- CLI (von der Logik getrennt, hinter main-Guard) ---
function runCli() {
  const { ok, findings } = checkElevenlabsTests({});
  if (ok) {
    console.log(
      `${LOG_PREFIX} OK - keine Platzhalter in ${TEST_DIR_REL}/ (ausser ${TEMPLATES_DIR_NAME}/), Vokabular deckt sich mit ${AGENT_CONFIG_REL}.`,
    );
    return 0;
  }
  for (const finding of findings) console.error(`${LOG_PREFIX} ${finding}`);
  return 1;
}

const isMain =
  fileURLToPath(import.meta.url) === resolve(process.argv[1] || "");
if (isMain) {
  try {
    process.exit(runCli());
  } catch (err) {
    console.error(`${LOG_PREFIX} Fehler (fail-closed): ${err.message}`);
    process.exit(1);
  }
}
