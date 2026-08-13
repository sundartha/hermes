#!/usr/bin/env node
// Vor-dem-Hochladen-Gate: die ElevenLabs-Testdefinitionen unter elevenlabs/tests/
// (Abnahmekriterien A1-A10) duerfen keine <AUSFUELLEN: ...>-Platzhalter mehr
// tragen, sobald sie hochgeladen werden. Grund: A3 ist ein verify_absence-Test -
// stuende dort noch eine Platzhalter-Werkzeugkennung, waere die Abwesenheit
// GARANTIERT erfuellt, das Veto-Kriterium bestuende unabhaengig vom
// Agentenverhalten. Ein Katalog, der immer gruen ist, misst nichts.
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
const TEMPLATES_DIR_NAME = "templates";
const JSON_EXT = ".json";
const PLACEHOLDER_PATTERN = /<AUSFUELLEN:[^>]*>/g;
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

// Prueft alle .json-Testdefinitionen unter elevenlabs/tests/ (ausser
// templates/) auf verbliebene <AUSFUELLEN: ...>-Platzhalter. Wirft nie an den
// Aufrufer weiter -- jedes erwartbare Problem (Platzhalter, kaputtes JSON,
// fehlendes Verzeichnis) wird zu einem Findings-Eintrag (fail-closed).
// ok = keine Funde.
export function checkElevenlabsTests({ rootDir = REPO_ROOT } = {}) {
  const testDirAbs = join(rootDir, TEST_DIR_REL);
  if (!existsSync(testDirAbs)) {
    return {
      ok: false,
      findings: [`Verzeichnis fehlt (fail-closed): ${TEST_DIR_REL}`],
    };
  }

  const findings = [];
  for (const relFile of listJsonFiles(testDirAbs, rootDir)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(join(rootDir, relFile), "utf8"));
    } catch (err) {
      findings.push(`${relFile}: nicht als JSON lesbar (${err.message})`);
      continue;
    }
    const placeholders = [];
    walkForPlaceholders(parsed, PATH_ROOT, placeholders);
    for (const { path, marker } of placeholders) {
      findings.push(`${relFile}: ${path} - Platzhalter gefunden (${marker})`);
    }
  }

  return { ok: findings.length === 0, findings };
}

// --- CLI (von der Logik getrennt, hinter main-Guard) ---
function runCli() {
  const { ok, findings } = checkElevenlabsTests({});
  if (ok) {
    console.log(
      `${LOG_PREFIX} OK - keine Platzhalter in ${TEST_DIR_REL}/ (ausser ${TEMPLATES_DIR_NAME}/).`,
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
