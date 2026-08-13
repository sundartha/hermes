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
// (2) VOKABULAR: JEDE einzelne Testdefinition muss jede dynamic-variable der
// Agentenkonfiguration setzen, und keine, die diese nicht kennt (siehe
// checkVariableVocabulary unten).
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

// Der EINE Doku-Schluessel-Test fuer BEIDE Pruefungen. Frueher sprang nur der
// Vokabular-Abgleich ueber diese Bloecke; die Platzhalter-Pruefung stieg hinein
// und meldete Prosa wie "Alle <AUSFUELLEN: ...>-Werte vor dem Push ersetzen" als
// echten Fund - ein Gate, das deshalb nie gruen werden kann, misst nichts.
function isDocKey(key) {
  return key.startsWith(DOC_KEY_PREFIX);
}

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
// Doku-Schluessel (isDocKey) bleiben aussen vor: sie sind kein Teil des
// ElevenLabs-Schemas, nichts darin wird je hochgeladen oder ausgefuellt.
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
      if (isDocKey(key)) continue;
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

// Laeuft die Eintraege eines Objekts ab: Doku-Schluessel (isDocKey)
// ueberspringen, unter dynamic_variables zusaetzlich die Schluessel als
// deklarierte Variablen aufnehmen, sonst normal weiter absteigen.
function walkObjectForVariables(objectValue, acc) {
  for (const [key, child] of Object.entries(objectValue)) {
    if (isDocKey(key)) continue;
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

// Benutzt ueberhaupt eine Testdefinition Variablen? Entscheidet allein, ob eine
// fehlende Agentenkonfiguration ein Fund ist (s. checkVariableVocabulary).
function anyVariableUsed(vocabularyByFile) {
  for (const { declared, referenced } of vocabularyByFile.values()) {
    if (declared.size > 0 || referenced.size > 0) return true;
  }
  return false;
}

// Richtung 1: DECKUNG PRO TESTDEFINITION, nicht ueber alle Dateien zusammen.
// Beim Testlauf rendert ElevenLabs den Prompt mit den dynamic_variables genau
// DIESER Definition (elevenlabs/tests/README.md, Feldtabelle: "dynamic_variables
// | Map string->any, alle drei Typen", Quelle
// https://elevenlabs.io/docs/api-reference/tests/create). Fehlt eine Variable
// dort, faehrt dieser Lauf mit leerem Wert - was Nachbardateien setzen, deckt
// das nicht. Und nur SETZEN deckt: eine blosse {{name}}-Erwaehnung im
// Erwartungstext befuellt nichts.
function uncoveredVariableFindings(configVariables, vocabularyByFile) {
  const findings = [];
  for (const [relFile, { declared }] of vocabularyByFile) {
    for (const name of configVariables) {
      if (declared.has(name)) continue;
      findings.push(
        `${relFile}: {{${name}}} - Variable der Agentenkonfiguration, die diese Testdefinition nicht setzt (${DYNAMIC_VARIABLES_KEY}); dieser Testlauf rendert sie leer`,
      );
    }
  }
  return findings;
}

// Richtung 2: tote Variable - die Testdefinition setzt oder erwaehnt einen
// Namen, den die Agentenkonfiguration nirgends als {{name}} referenziert (Beleg
// s. VARIABLE_PATTERN). Er befuellt nichts, egal auf welcher Seite er steht.
function unknownVariableFindings(configVariables, vocabularyByFile) {
  const findings = [];
  for (const [relFile, { declared, referenced }] of vocabularyByFile) {
    for (const name of new Set([...declared, ...referenced])) {
      if (configVariables.has(name)) continue;
      findings.push(
        `${relFile}: {{${name}}} - Variable der Testdefinition, die die Agentenkonfiguration nicht kennt (${AGENT_CONFIG_REL})`,
      );
    }
  }
  return findings;
}

// Gleicht das Platzhalter-Vokabular beider Seiten ab, in BEIDE Richtungen (s.
// uncoveredVariableFindings / unknownVariableFindings). Findings nennen Datei
// und Variablennamen im Klartext, damit sie ohne Nachschlagen behebbar sind.
function checkVariableVocabulary(rootDir, vocabularyByFile) {
  // Fehlt die Agentenkonfiguration, gibt es keine Gegenseite fuer den Abgleich.
  // Das ist genau dann ein Fund, wenn die Testdefinitionen ueberhaupt Variablen
  // benutzen: dann waere die Pruefung still ausgefallen, statt zu messen. Ohne
  // Variablen auf der Testseite gibt es schlicht nichts zu vergleichen - dann
  // schweigt der Abgleich, statt eine Abweichung zu behaupten.
  if (!existsSync(join(rootDir, AGENT_CONFIG_REL))) {
    if (!anyVariableUsed(vocabularyByFile)) return [];
    return [
      `Datei fehlt (fail-closed): ${AGENT_CONFIG_REL} - Vokabular-Abgleich nicht moeglich`,
    ];
  }
  const { parsed, error } = readJsonFile(rootDir, AGENT_CONFIG_REL);
  if (error) return [error];

  const configVariables = collectVariables(parsed).referenced;
  return [
    ...uncoveredVariableFindings(configVariables, vocabularyByFile),
    ...unknownVariableFindings(configVariables, vocabularyByFile),
  ];
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
  const vocabularyByFile = new Map();
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
    vocabularyByFile.set(relFile, collectVariables(parsed));
  }

  findings.push(...checkVariableVocabulary(rootDir, vocabularyByFile));

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
