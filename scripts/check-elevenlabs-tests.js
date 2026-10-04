#!/usr/bin/env node
// Vor-dem-Hochladen-Gate mit drei Pruefungen ueber elevenlabs/:
//
// (1) REGISTRY-KOPPLUNG: hochgeladen wird nicht, was in einem Ordner liegt,
// sondern was in elevenlabs/tests.json steht - pushTests oeffnet den
// config-Pfad jeder Registry-Zeile unveraendert, also relativ zum
// Arbeitsverzeichnis elevenlabs/ (elevenlabs/tests/README.md, Abschnitt
// "Format von tests.json"). Der Abgleich laeuft deshalb BEIDSEITIG: eine
// Definition ohne Registry-Zeile wird nie hochgeladen (sie sieht geprueft aus
// und laeuft nie), eine Registry-Zeile ohne Datei bricht den Push am fehlenden
// Pfad ab. Fail-closed gilt je Ablageort, nicht nur global: ein leerer
// test_configs/-Ordner ist ein Fund, auch wenn anderswo eine Streu-Definition
// liegt. elevenlabs/tests/ ist seit dem Umzug kein Ablageort mehr - eine
// Definition dort ist ein Fund, der die Datei namentlich nennt.
//
// (2) PLATZHALTER: die Testdefinitionen (Abnahmekriterien A1-A10) duerfen keine
// <AUSFUELLEN: ...>-Platzhalter tragen, sobald sie hochgeladen werden. Grund:
// A3 ist ein verify_absence-Test - stuende dort noch eine Platzhalter-
// Werkzeugkennung, waere die Abwesenheit GARANTIERT erfuellt, das
// Veto-Kriterium bestuende unabhaengig vom Agentenverhalten. Ein Katalog, der
// immer gruen ist, misst nichts.
//
// (3) VOKABULAR: JEDE einzelne Testdefinition muss jede dynamic-variable der
// Agentenkonfiguration setzen, und keine, die diese nicht kennt (siehe
// checkVariableVocabulary unten).
//
// Pruefung (2) und (3) laufen ueber die VEREINIGUNG aus den Ablageorten UND den
// vorhandenen Registry-Pfaden, nicht ueber die Verzeichnis-Listen allein:
// hochgeladen wird, was in tests.json steht - auch eine Zeile, deren Pfad an
// beiden Ablageorten vorbeizeigt (z.B. agent_configs/streu.json). Liefe die
// Inhaltspruefung nur ueber die Verzeichnisse, wuerde genau diese Datei
// ungeprueft gepusht.
//
// Der Vorlagen-Ordner templates/ DIREKT unter einem Ablageort ist ausgenommen:
// Vorlagen duerfen Platzhalter tragen. Die Ausnahme gilt nur fuer diesen einen
// Ort und nur, solange die Vorlage UNREGISTRIERT ist - ein templates/-Ordner in
// beliebiger Tiefe waere sonst ein Versteck fuer ungepruefte Definitionen, und
// eine registrierte Vorlage wird gepusht wie jede Testdefinition.
//
// Reine, seiteneffektfreie Pruef-Funktion; der CLI-Teil (exit/console) sitzt
// hinter dem main-Guard. Nur Node-Builtins, kein Dependency, kein Build-Step.
// Aufruf:  node scripts/check-elevenlabs-tests.js   (prueft, exit 0/1)
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// elevenlabs/ IST das Projekt-Wurzelverzeichnis der CLI: agent_configs/,
// test_configs/ und die Registry tests.json liegen dort nebeneinander
// (woertliches Baumdiagramm in elevenlabs/tests/README.md, Abschnitt "Ablage").
// Aus diesem Verzeichnis heraus werden die CLI-Aufrufe abgesetzt, deshalb sind
// die config-Pfade der Registry relativ dazu zu lesen.
const PROJECT_DIR_REL = "elevenlabs";
const TEST_CONFIGS_DIR_NAME = "test_configs";
// Der Ort, an dem die Definitionen frueher lagen. Kein gueltiger Ablageort
// mehr - dort stehen nur noch die Notiz README.md und templates/.
const LEGACY_DIR_NAME = "tests";
const TEST_CONFIGS_DIR_REL = `${PROJECT_DIR_REL}/${TEST_CONFIGS_DIR_NAME}`;
const LEGACY_DIR_REL = `${PROJECT_DIR_REL}/${LEGACY_DIR_NAME}`;
const REGISTRY_REL = `${PROJECT_DIR_REL}/tests.json`;
const REGISTRY_KEY = "tests";
const REGISTRY_CONFIG_KEY = "config";
const AGENT_CONFIG_REL = `${PROJECT_DIR_REL}/agent_configs/outbound-agent.template.json`;
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
// Die config-Pfade der Registry sind mit / geschrieben (README, Abschnitt
// "Format von tests.json") - sie werden segmentweise gelesen, nie ueber join
// normalisiert, bevor sie geprueft sind.
const PATH_SEPARATOR = "/";
const PARENT_DIR_SEGMENT = "..";
const CURRENT_DIR_SEGMENT = ".";
const LOG_PREFIX = "[check-elevenlabs-tests]";

// Der EINE Doku-Schluessel-Test fuer BEIDE Pruefungen. Frueher sprang nur der
// Vokabular-Abgleich ueber diese Bloecke; die Platzhalter-Pruefung stieg hinein
// und meldete Prosa wie "Alle <AUSFUELLEN: ...>-Werte vor dem Push ersetzen" als
// echten Fund - ein Gate, das deshalb nie gruen werden kann, misst nichts.
function isDocKey(key) {
  return key.startsWith(DOC_KEY_PREFIX);
}

// Listet alle .json-Dateien unterhalb von absDir (rel. zu rootDir), rekursiv,
// ausser unterhalb von skipDirAbs (dem einen Vorlagen-Ordner, s.
// listDefinitionFiles).
function listJsonFiles(absDir, rootDir, skipDirAbs) {
  const found = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    const absPath = join(absDir, entry.name);
    if (entry.isDirectory()) {
      if (absPath === skipDirAbs) continue;
      found.push(...listJsonFiles(absPath, rootDir, skipDirAbs));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(JSON_EXT)) {
      found.push(relative(rootDir, absPath));
    }
  }
  return found;
}

// Die Testdefinitionen EINES Ablageorts, ohne den Vorlagen-Ordner DIREKT
// darunter (<Ablageort>/templates/). Ausgenommen ist genau dieser eine Pfad,
// nicht jeder Ordner dieses Namens in beliebiger Tiefe: sonst genuegte ein
// Zwischenordner (test_configs/beliebig/templates/), damit eine Definition
// weder auf Platzhalter noch auf ihre Registry-Zeile geprueft wird - ein
// Versteck, das wie eine Vorlage aussieht. Ein fehlendes Verzeichnis liefert
// eine leere Liste; ob Leere ein Fund ist, entscheidet der Aufrufer je Ort -
// der produktive Ort darf nicht leer sein, der alte MUSS es sein.
function listDefinitionFiles(rootDir, dirRel) {
  const dirAbs = join(rootDir, dirRel);
  if (!existsSync(dirAbs)) return [];
  return listJsonFiles(dirAbs, rootDir, join(dirAbs, TEMPLATES_DIR_NAME));
}

// Namen der Eintraege eines Verzeichnisses; ein nicht lesbares Verzeichnis
// liefert keine Namen (fail-closed: nichts gilt dort als vorhanden).
function directoryEntryNames(dirAbs) {
  try {
    return readdirSync(dirAbs);
  } catch {
    return [];
  }
}

// Case-sensitiver Existenz-Test: laeuft die Segmente des Pfads ab und vergleicht
// jedes exakt gegen die readdir-Ausgabe seines Verzeichnisses. existsSync taugt
// dafuer nicht - auf macOS ist das Dateisystem case-insensitiv, dort gilt
// test_configs/A1.json als vorhanden, waehrend der Push auf dem case-sensitiven
// Linux-CI an genau diesem Pfad abbricht. Ein Gate, dessen Diagnose von der
// Plattform des Pruefenden abhaengt, nennt die Ursache nie.
function existsCaseSensitive(baseAbs, relPath) {
  const segments = relPath
    .split(PATH_SEPARATOR)
    .filter((segment) => segment !== "" && segment !== CURRENT_DIR_SEGMENT);
  if (segments.length === 0) return false;
  let dirAbs = baseAbs;
  for (const segment of segments) {
    if (!directoryEntryNames(dirAbs).includes(segment)) return false;
    dirAbs = join(dirAbs, segment);
  }
  return true;
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

// Ein Registry-Problem, das den Abgleich unmoeglich macht: keine brauchbaren
// Pfade, dafuer ein Fund. Fail-closed - ohne lesbare Registry laedt die CLI
// nichts hoch, das Gate darf diesen Zustand nicht als Vollzug melden.
function registryError(message) {
  return { paths: [], findings: [message] };
}

// Ein config-Pfad ist relativ zum Arbeitsverzeichnis elevenlabs/ zu lesen (die
// CLI oeffnet ihn unveraendert). Ein absoluter Pfad zeigt an der Ablage vorbei,
// ein ..-Segment aus dem Projektverzeichnis heraus. Beides muss VOR jedem
// join() erkannt werden: join("elevenlabs", "/test_configs/a.json") ergibt
// "elevenlabs/test_configs/a.json" - der Pfad saehe damit registriert UND
// vorhanden aus, waehrend die CLI ihn absolut oeffnet und scheitert.
function unsafePathReason(configPath) {
  if (isAbsolute(configPath)) {
    return "absoluter Pfad";
  }
  if (configPath.split(PATH_SEPARATOR).includes(PARENT_DIR_SEGMENT)) {
    return `Ausbruch aus ${PROJECT_DIR_REL}/ (${PARENT_DIR_SEGMENT})`;
  }
  return null;
}

// Repo-relative Schreibweise eines config-Pfads: so, wie die Verzeichnis-Listen
// ihre Dateien nennen - der gemeinsame Nenner beider Seiten des Abgleichs.
function toRepoRel(configPath) {
  return join(PROJECT_DIR_REL, configPath);
}

// Prueft EINE Registry-Zeile und liefert entweder den brauchbaren Pfad oder
// einen Fund. Ein doppelter Pfad ist einer: die CLI laeuft die Registry ab und
// legt denselben Test zweimal in ElevenLabs an - zwei Testkennungen fuer ein
// Abnahmekriterium, deren Ergebnisse auseinanderlaufen koennen.
function inspectRegistryEntry(entry, index, seenPaths) {
  const configPath = entry?.[REGISTRY_CONFIG_KEY];
  if (typeof configPath !== "string" || configPath === "") {
    return {
      finding: `${REGISTRY_REL}: ${REGISTRY_KEY}[${index}] ohne "${REGISTRY_CONFIG_KEY}"-Pfad - diese Zeile kann die CLI nicht oeffnen`,
    };
  }
  const unsafeReason = unsafePathReason(configPath);
  if (unsafeReason) {
    return {
      finding: `${REGISTRY_REL}: ${configPath} - ${unsafeReason}; die CLI oeffnet den Pfad unveraendert relativ zu ${PROJECT_DIR_REL}/ und findet die Datei nicht`,
    };
  }
  if (seenPaths.has(toRepoRel(configPath))) {
    return {
      finding: `${REGISTRY_REL}: ${configPath} - schon in einer frueheren ${REGISTRY_KEY}-Zeile; der Push legt diese Testdefinition doppelt in ElevenLabs an`,
    };
  }
  return { path: configPath };
}

// Trennt die brauchbaren config-Pfade von kaputten Zeilen. Eine Zeile, die die
// CLI nicht oeffnen kann oder die doppelt steht, ist ein Fund und zaehlt NICHT
// als Registrierung - sonst deckte ein kaputter Pfad die Datei, auf die er
// zeigen sollte, gegen die Kopplungspruefung ab.
function registryConfigPaths(entries) {
  const paths = [];
  const findings = [];
  const seenPaths = new Set();
  entries.forEach((entry, index) => {
    const { path, finding } = inspectRegistryEntry(entry, index, seenPaths);
    if (finding) findings.push(finding);
    if (path === undefined) return;
    seenPaths.add(toRepoRel(path));
    paths.push(path);
  });
  return { paths, findings };
}

// Liest die config-Pfade aus elevenlabs/tests.json. Zusatzfelder einer Zeile
// (id, type) schreibt die CLI nach dem Push selbst zurueck (README, Abschnitt
// "Format von tests.json": testDef.id = newTestId) - sie werden gelesen und
// ignoriert, nie beanstandet: ein Gate, das an den eigenen Werkzeugspuren
// zerbricht, wird beim ersten Push rot und danach abgeschaltet.
function readRegistry(rootDir) {
  if (!existsSync(join(rootDir, REGISTRY_REL))) {
    return registryError(
      `Datei fehlt (fail-closed): ${REGISTRY_REL} - ohne Registry laedt die CLI keine einzige Testdefinition hoch`,
    );
  }
  const { parsed, error } = readJsonFile(rootDir, REGISTRY_REL);
  if (error) return registryError(error);

  const entries = parsed?.[REGISTRY_KEY];
  if (!Array.isArray(entries)) {
    return registryError(
      `${REGISTRY_REL}: kein Feld "${REGISTRY_KEY}" mit einer Liste von Registry-Zeilen (fail-closed)`,
    );
  }
  return registryConfigPaths(entries);
}

// Warum der Pfad nicht auf eine Datei zeigt. Findet ihn erst der
// case-insensitive existsSync, ist die Gross-/Kleinschreibung die Ursache - die
// nennt der Fund im Klartext, sonst raetselt die macOS-Seite ueber einen
// Push-Abbruch, den nur der Linux-CI sieht.
function missingFileReason(rootDir, configPath) {
  if (existsSync(join(rootDir, PROJECT_DIR_REL, configPath))) {
    return "Registry-Zeile mit abweichender Gross-/Kleinschreibung; die Datei gibt es nur anders geschrieben, auf einem case-sensitiven Dateisystem (Linux-CI) bricht der Push hier ab";
  }
  return "Registry-Zeile ohne Datei; der Push bricht am fehlenden Pfad ab";
}

// Registry-Zeile ohne Datei: der Push bricht genau an diesem Pfad ab. Der Fund
// nennt ihn so, wie er in der Registry steht.
function missingFileFindings(rootDir, registryPaths) {
  const projectAbs = join(rootDir, PROJECT_DIR_REL);
  return registryPaths
    .filter((configPath) => !existsCaseSensitive(projectAbs, configPath))
    .map(
      (configPath) =>
        `${REGISTRY_REL}: ${configPath} - ${missingFileReason(rootDir, configPath)}`,
    );
}

// Die vorhandenen Registry-Pfade in repo-relativer Schreibweise - die zweite
// Haelfte der Vereinigung, ueber die der Inhalt geprueft wird (s. Kopfnotiz).
// Fehlende Pfade bleiben draussen: sie sind bereits ein eigener Fund
// (missingFileFindings), ein zweiter Lesefehler dazu erklaert nichts.
function registryFilesToInspect(rootDir, registryPaths) {
  const projectAbs = join(rootDir, PROJECT_DIR_REL);
  return registryPaths
    .filter((configPath) => existsCaseSensitive(projectAbs, configPath))
    .map(toRepoRel);
}

// Definition ohne Registry-Zeile: sie liegt am richtigen Ort, wird aber nie
// hochgeladen - sie sieht geprueft aus und laeuft nie, ihr Abnahmekriterium
// bleibt ungemessen.
function unregisteredFindings(definitionFiles, registryPaths) {
  const registered = new Set(registryPaths.map(toRepoRel));
  return definitionFiles
    .filter((relFile) => !registered.has(relFile))
    .map(
      (relFile) =>
        `${relFile}: keine Zeile in ${REGISTRY_REL} - diese Testdefinition wird nie hochgeladen`,
    );
}

// Der alte Ort ist kein Ablageort mehr: aus elevenlabs/ heraus zeigt sein Pfad
// an test_configs/ vorbei, und dort sucht die CLI ihre Definitionen. Der Fund
// nennt die Datei namentlich - wer sie ablegt, soll ohne Nachschlagen wissen,
// welche gemeint ist.
function legacyLocationFindings(legacyFiles) {
  return legacyFiles.map(
    (relFile) =>
      `${relFile}: liegt unter ${LEGACY_DIR_REL}/ - kein Ablageort mehr; nach ${TEST_CONFIGS_DIR_REL}/ verschieben und die Zeile in ${REGISTRY_REL} nachziehen`,
  );
}

// Fail-closed je Ablageort: fehlt der produktive Ort oder ist er leer, hat das
// Gate nichts gemessen und die CLI wuerde nichts hochladen. Eine Streu-Datei
// anderswo darf diesen Zustand nicht zudecken.
function emptyLocationFindings(definitionFiles) {
  if (definitionFiles.length > 0) return [];
  return [
    `Keine Testdefinition unter ${TEST_CONFIGS_DIR_REL}/ (fail-closed) - es wuerde nichts hochgeladen`,
  ];
}

function placeholderFindings(relFile, parsed) {
  const placeholders = [];
  walkForPlaceholders(parsed, PATH_ROOT, placeholders);
  return placeholders.map(
    ({ path, marker }) =>
      `${relFile}: ${path} - Platzhalter gefunden (${marker})`,
  );
}

// Liest jede zu pruefende Datei genau einmal: Platzhalter melden, Vokabular fuer
// den spaeteren Abgleich einsammeln. Kaputtes JSON ist ein Fund, kein Absturz.
function inspectDefinitions(rootDir, relFiles) {
  const findings = [];
  const vocabularyByFile = new Map();
  for (const relFile of relFiles) {
    const { parsed, error } = readJsonFile(rootDir, relFile);
    if (error) {
      findings.push(error);
      continue;
    }
    findings.push(...placeholderFindings(relFile, parsed));
    vocabularyByFile.set(relFile, collectVariables(parsed));
  }
  return { findings, vocabularyByFile };
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
      if (declared.has(name) || name.startsWith("system__")) continue;
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

// Koppelt Ablage und Registry (elevenlabs/tests.json) und prueft danach den
// Inhalt jeder gefundenen Testdefinition - Platzhalter und Vokabular. Wirft nie
// an den Aufrufer weiter: jedes erwartbare Problem (fehlende Registry-Zeile,
// Zeile ohne Datei, Definition am toten Altpfad, leerer Ablageort, Platzhalter,
// Vokabular-Abweichung, kaputtes JSON, fehlende Datei) wird zu einem
// Findings-Eintrag (fail-closed). ok = keine Funde.
export function checkElevenlabsTests({ rootDir = REPO_ROOT } = {}) {
  const definitionFiles = listDefinitionFiles(rootDir, TEST_CONFIGS_DIR_REL);
  const legacyFiles = listDefinitionFiles(rootDir, LEGACY_DIR_REL);
  const registry = readRegistry(rootDir);
  // Der Inhalt wird ueber die VEREINIGUNG beider Seiten geprueft (Kopfnotiz):
  // beide Ablageorte - eine Definition am Altpfad ist schon wegen ihres Orts
  // ein Fund, aber ihre Platzhalter sollen dabei nicht ungenannt bleiben - PLUS
  // jeden vorhandenen Registry-Pfad, denn genau die werden hochgeladen, auch
  // wenn sie an beiden Ablageorten vorbeizeigen.
  const filesToInspect = new Set([
    ...definitionFiles,
    ...legacyFiles,
    ...registryFilesToInspect(rootDir, registry.paths),
  ]);
  const { findings: contentFindings, vocabularyByFile } = inspectDefinitions(
    rootDir,
    filesToInspect,
  );

  const findings = [
    ...emptyLocationFindings(definitionFiles),
    ...legacyLocationFindings(legacyFiles),
    ...registry.findings,
    ...missingFileFindings(rootDir, registry.paths),
    ...unregisteredFindings(definitionFiles, registry.paths),
    ...contentFindings,
    ...checkVariableVocabulary(rootDir, vocabularyByFile),
  ];

  return { ok: findings.length === 0, findings };
}

// --- CLI (von der Logik getrennt, hinter main-Guard) ---
function runCli() {
  const { ok, findings } = checkElevenlabsTests({});
  if (ok) {
    console.log(
      `${LOG_PREFIX} OK - jede Testdefinition in ${TEST_CONFIGS_DIR_REL}/ (ausser ${TEMPLATES_DIR_NAME}/) steht in ${REGISTRY_REL} und umgekehrt, keine Platzhalter, ${LEGACY_DIR_REL}/ ohne Definition, Vokabular deckt sich mit ${AGENT_CONFIG_REL}.`,
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
