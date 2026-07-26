// GAP-08 des i18n-Launch-Testkatalogs (tasks/i18n-tests/11-luecken-und-e2e.md, Welle W2,
// Block B4). SOLL-Test (rot vor Fix, R2 der kanonischen Liste): es soll GENAU EINE,
// ueber die Umgebung korrigierbare Quelle fuer den USD/EUR-Kurs geben. Gemessen sind es
// ZWEI - der LLM-Kostenpfad rechnet mit einem nackten Literal, der Provider-Kostenpfad
// mit einem eigenen, env-setzbaren Mikro-Satz. Ein falscher Kurs bewegt auf BEIDEN Achsen
// echtes Geld (Budget-Gate + Kostenkorrektur), laesst sich heute aber nur auf einer davon
// ohne Deploy richtigstellen.
//
// KEIN Import von src/config.js fuer die Werte: providerToBucketRateMicro ist env-setzbar,
// ein In-Prozess-Import wertete die lokale .env aus und die Polaritaet dieses Tests haenge
// am Arbeitsplatz (Lehre test-base-env-drift). Gelesen wird der ausgelieferte QUELLTEXT -
// Muster test/env-docs-spend-cap-coherence.test.js (readCodeFallback).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONFIG_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "src",
  "config.js",
);
const CONFIG_SOURCE = fs.readFileSync(CONFIG_PATH, "utf8");
// Mikro-Einheiten je ganzer Einheit: PROVIDER_TO_BUCKET_RATE_MICRO=920000 meint den Kurs 0,92.
const MICRO_PER_UNIT = 1_000_000;
const NUMBER_PATTERN = "(-?\\d+(?:\\.\\d+)?)";

// Der nackte Literalwert einer config-Eigenschaft ("name: 0.93,"). Wirft mit Kontext (P8),
// wenn das Symbol verschwindet - ein stilles Gruen waere hier gefaehrlicher als ein Fehler.
function readLiteral(propertyName) {
  const m = CONFIG_SOURCE.match(new RegExp(`^\\s*${propertyName}:\\s*${NUMBER_PATTERN}\\s*,`, "m"));
  if (!m) throw new Error(`Literalwert fuer '${propertyName}' nicht in src/config.js gefunden`);
  return Number(m[1]);
}

// Der numEnv-Fallback einer Env-Variablen (Muster readCodeFallback). [^)] statt . matcht
// ueber Zeilenumbrueche - config.js bricht die numEnv-Optionen auf mehrere Zeilen um.
function readEnvFallback(envName) {
  const m = CONFIG_SOURCE.match(
    new RegExp(`numEnv\\("${envName}",[^)]*?fallback:\\s*${NUMBER_PATTERN}`),
  );
  if (!m) throw new Error(`numEnv-Fallback fuer '${envName}' nicht in src/config.js gefunden`);
  return Number(m[1]);
}

// Wird die Eigenschaft ueberhaupt aus process.env gespeist (numEnv) oder steht dort eine
// feste Zahl im Quelltext?
function isEnvBacked(propertyName) {
  return new RegExp(`${propertyName}:\\s*numEnv\\(`).test(CONFIG_SOURCE);
}

test("GAP-08 (SOLL, rot): der USD/EUR-Kurs ist ueber die Umgebung korrigierbar", () => {
  assert.equal(
    isEnvBacked("usdToEur"),
    true,
    "config.llm.usdToEur ist ein nacktes Literal - ein falscher Kurs braucht heute einen Deploy, " +
      "waehrend die Provider-Achse (PROVIDER_TO_BUCKET_RATE_MICRO) sofort nachziehbar ist",
  );
});

test("GAP-08 (SOLL, rot): beide Kosten-Achsen rechnen mit DEMSELBEN Kurs", () => {
  assert.equal(
    readLiteral("usdToEur"),
    readEnvFallback("PROVIDER_TO_BUCKET_RATE_MICRO") / MICRO_PER_UNIT,
    "LLM-Achse (usdToEur) und Provider-Achse (providerToBucketRateMicro) tragen zwei " +
      "verschiedene Kurse - dieselben USD ergeben je nach Kostenpfad einen anderen EUR-Betrag",
  );
});
