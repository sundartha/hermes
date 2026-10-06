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
const MICRO_PER_UNIT = 1_000_000;
const NUMBER_PATTERN = "(-?\\d+(?:\\.\\d+)?)";

function readLiteral(propertyName) {
  const m = CONFIG_SOURCE.match(new RegExp(`^\\s*${propertyName}:\\s*${NUMBER_PATTERN}\\s*,`, "m"));
  if (!m) throw new Error(`Literalwert fuer '${propertyName}' nicht in src/config.js gefunden`);
  return Number(m[1]);
}

function readEnvFallback(envName) {
  const m = CONFIG_SOURCE.match(
    new RegExp(`numEnv\\("${envName}",[^)]*?fallback:\\s*${NUMBER_PATTERN}`),
  );
  if (!m) throw new Error(`numEnv-Fallback fuer '${envName}' nicht in src/config.js gefunden`);
  return Number(m[1]);
}

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
