// IP1 (PLAN-INBOUND-PARITAET, W2): der erste gesprochene Satz jedes Inbound-Anrufs traegt
// korrekte Umlaute - und eine Bestands-Begruessung in alter Schreibweise wird auf dem
// Anrufweg gehoben, sonst erreicht der Fix keinen einzigen Anruf.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  greetingForLanguage,
  greetingTemplatesFor,
  greetingWithCurrentOrthography,
  ALL_GREETING_TEMPLATES,
} from "../src/i18n/greeting-catalog.js";
import { hasInboundNotice } from "../src/i18n/inbound-notice.js";
import { SPOKEN_TRANSLITERATION_STEMS } from "./umlaut-stems-helper.js";
import { BASE_ENV, ROOT, seedState, tempDataDir } from "./helpers.js";

// Die historische Fassung wird AUS der heutigen abgeleitet ("für" -> "fuer"), nicht hier
// zweitgepflegt: so faellt ein Tippfehler im Karten-Schluessel auf, ohne den Satz ein
// drittes Mal im Repo zu haben.
const alteFassung = (vorlage) => vorlage.replaceAll("für", "fuer");
const SCRIPT = "scripts/greeting-orthografie-nachziehen.mjs";

// Erwartete Groessen des Katalogs (G25: benannt statt Magic Number) - IP1-G1 pinnt sie
// zusaetzlich zur Transliterations-Gegenprobe, damit ein Fix die Sprach-Union nicht
// versehentlich veraendert.
const ANZAHL_DE_VORLAGEN = 3;
const ANZAHL_ALLER_VORLAGEN = 9;

// ---- Ziel: der gesprochene Katalog ----
test("IP1-G1: jede DE-Begruessungsvorlage - keine Transliteration, echte Umlaute, Pflichtsatz", () => {
  const templates = greetingTemplatesFor("de");
  assert.equal(templates.length, ANZAHL_DE_VORLAGEN, "Anzahl waehlbarer DE-Vorlagen veraendert");
  for (const [index, vorlage] of templates.entries()) {
    assert.equal(
      vorlage.match(SPOKEN_TRANSLITERATION_STEMS),
      null,
      `Vorlage ${index}: Transliteration in: ${vorlage}`,
    );
    assert.match(vorlage, /[äöü]/u, `Vorlage ${index}: kein Umlaut - Wortlaut versehentlich entfernt?`);
    // Riegel gegen Pre-Mortem P3: die Korrektur darf den Pflichtsatz nicht antasten.
    assert.ok(hasInboundNotice(vorlage), `Vorlage ${index}: Pflichtsatz verloren`);
  }
  assert.equal(
    ALL_GREETING_TEMPLATES.length,
    ANZAHL_ALLER_VORLAGEN,
    "Sprach-Union veraendert (FR/EN beruehrt?)",
  );
});

// ---- Ziel: die At-Rest-Falle ----
test("IP1-M1: eine gespeicherte Begruessung in alter Schreibweise wird auf die heutige gehoben", () => {
  for (const vorlage of greetingTemplatesFor("de")) {
    assert.equal(greetingWithCurrentOrthography(alteFassung(vorlage)), vorlage);
    assert.equal(greetingForLanguage(alteFassung(vorlage), "de"), vorlage);
  }
});

test("IP1-M2: Abgrenzung - frei gesetzter Text, null und undefined bleiben unveraendert", () => {
  const freitext = "Mein eigener Text mit KI- und Transkriptionshinweis";
  assert.equal(greetingWithCurrentOrthography(freitext), freitext);
  assert.equal(greetingForLanguage(freitext, "de"), freitext);
  assert.equal(greetingWithCurrentOrthography(null), null);
  assert.equal(greetingWithCurrentOrthography(undefined), undefined);
  // T5/G3: ein at-rest-Wert, der einen Object.prototype-Namen traegt, darf keine Funktion
  // zurueckliefern (der Renderpfad wuerde darauf replaceAll aufrufen).
  assert.equal(greetingWithCurrentOrthography("toString"), "toString");
  assert.equal(greetingWithCurrentOrthography("constructor"), "constructor");
});

test("IP1-M3: die historischen Fassungen sind KEINE waehlbaren Vorlagen", () => {
  for (const vorlage of greetingTemplatesFor("de")) {
    const alt = alteFassung(vorlage);
    if (alt === vorlage) continue; // Vorlage ohne historische Fassung
    assert.ok(!greetingTemplatesFor("de").includes(alt), "Karten-Schluessel ist waehlbar geworden");
    assert.ok(!ALL_GREETING_TEMPLATES.includes(alt), "Karten-Schluessel in der Sprach-Union");
  }
});

test("IP1-M4: alte DE-Fassung auf einem EN-Tenant faellt auf die EN-Standardvorlage (Reihenfolge)", () => {
  // Pinnt, dass normalisiert wird, BEVOR gegen die Vorlagenlisten geprueft wird. Ohne das
  // gaelte der Wert als Admin-Freitext und ein EN-Anrufer hoerte Deutsch.
  assert.equal(
    greetingForLanguage(alteFassung(greetingTemplatesFor("de")[0]), "en"),
    greetingTemplatesFor("en")[0],
  );
});

// ---- Ziel: der Nachzieh-Lauf ----
// Spawn ueber BASE_ENV + tempDataDir (EIN Env-Weg, Lehre test-base-env-drift; NODE_ENV=test
// haelt dotenv/.env aus dem Kind heraus, src/config.js). Kein zweiter Server-Startweg -
// startServer/startServerExpectExit fahren beide fest src/server.js.
function runNachzug(dataDir, args = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, ...BASE_ENV, NODE_ENV: "test", DATA_DIR: dataDir },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("exit", (code) => resolve({ code, output }));
  });
}
// Trockenlauf schreibt NICHT -> die Flat-Form des Seeds (settings.greeting direkt am
// Top-Level, VOR der In-Memory-Migration auf die owner-keyed Map) bleibt auf der Platte
// stehen; --apply loest ueber store.save() die Migration aus, danach liegt settings als
// Map vor (Muster migrateSettingsToMap, src/store/json.js). Diese Fallunterscheidung
// prueft nur das TEST-Fixture, nicht Produktionsverhalten.
const ERSTER_TENANT_INDEX = 0;
const greetingAtRest = (dataDir) => {
  const storeFile = JSON.parse(fs.readFileSync(path.join(dataDir, "store.json"), "utf8"));
  const { settings } = storeFile;
  return typeof settings.greeting === "string"
    ? settings.greeting
    : Object.values(settings)[ERSTER_TENANT_INDEX].greeting;
};

test("IP1-N1: Trockenlauf nennt die Zahl betroffener Mandanten und schreibt nichts", async () => {
  // UMHUELLTE alte Fassung seeden - so steht sie at rest (defaults.js seedet umhuellt, und
  // die Boot-Migration store/greeting-notice-migration.js umhuellt eine markerlose Zeile
  // beim Laden; eine NACKTE alte Fassung bekaeme hier den EN-Pflichtsatz, weil dieser Seed
  // keine Sprache setzt -> Weltdefault en).
  const alt = alteFassung(greetingTemplatesFor("de")[0]);
  const dir = tempDataDir(seedState({ settings: { greeting: alt, language: "de" } }));
  const result = await runNachzug(dir);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /mode=DRY-RUN/);
  assert.match(result.output, /betroffen=1/);
  assert.equal(greetingAtRest(dir), alt, "Trockenlauf hat geschrieben");
});

test("IP1-N2: --apply zieht nach und ist idempotent (zweiter Lauf: betroffen=0)", async () => {
  const alt = alteFassung(greetingTemplatesFor("de")[0]);
  const dir = tempDataDir(seedState({ settings: { greeting: alt, language: "de" } }));
  const erst = await runNachzug(dir, ["--apply"]);
  assert.equal(erst.code, 0, erst.output);
  assert.equal(greetingAtRest(dir), greetingTemplatesFor("de")[0]);
  const zweit = await runNachzug(dir, ["--apply"]);
  assert.equal(zweit.code, 0, zweit.output);
  assert.match(zweit.output, /betroffen=0/);
  assert.equal(greetingAtRest(dir), greetingTemplatesFor("de")[0]);
});

test("IP1-N3: ein frei gesetzter Text wird auch mit --apply nicht angefasst", async () => {
  const freitext = "Mein eigener Text mit KI- und Transkriptionshinweis";
  const dir = tempDataDir(seedState({ settings: { greeting: freitext, language: "de" } }));
  const result = await runNachzug(dir, ["--apply"]);
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /betroffen=0/);
  assert.equal(greetingAtRest(dir), freitext);
});
